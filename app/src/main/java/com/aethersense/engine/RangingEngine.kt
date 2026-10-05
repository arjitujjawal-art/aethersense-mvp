package com.aethersense.engine

import com.aethersense.audio.RingBuffer
import com.aethersense.config.SonarConfig
import com.aethersense.dsp.ChirpGenerator
import com.aethersense.dsp.Fft
import com.aethersense.dsp.MatchedFilter
import com.aethersense.dsp.PeakDetector
import com.aethersense.model.SystemStatus
import com.aethersense.model.ThreatLevel
import kotlin.math.log10

/**
 * Loop 3 — Frame-synchronous ranging engine.
 *
 * Timing reference: τ = 0 is taken from the direct-path (speaker→mic) correlation peak,
 * which is tracked every frame within ±[searchMargin] samples.
 * Uses analytic (IQ) matched filtering to eliminate carrier cycle slips.
 * Applies direct-path autocorrelation cancellation to reveal targets even under strong
 * speaker-to-mic chassis crosstalk.
 */
class RangingEngine(
    private val ring: RingBuffer,
    template: FloatArray,
    templateCos: FloatArray? = null,
    private val autoCorrEnvelope: FloatArray? = null,
    private val pri: Int = SonarConfig.PRI_SAMPLES,
    private val searchMargin: Int = 32,
    private val directMin: Float = 0.05f,
    private val maxMisses: Int = 5,
) {
    constructor(ring: RingBuffer, gen: ChirpGenerator) : this(
        ring, gen.chirpSin, gen.chirpCos, gen.autoCorrEnvelope
    )

    private val filter = MatchedFilter(template, templateCos)
    private val n = template.size
    private val detector = PeakDetector()
    private val fft = Fft(SonarConfig.FFT_SIZE)

    private val maxLag = SonarConfig.MAX_LAG
    private val trackLags = 2 * searchMargin + maxLag
    private val acqLags = pri

    // Preallocated work buffers (no allocation in the hot path).
    private val xBuf = FloatArray(maxOf(acqLags, trackLags) + n + SonarConfig.FFT_SIZE)
    private val envBuf = FloatArray(maxOf(acqLags, trackLags))
    private val relEnv = FloatArray(maxLag + 2)
    private val relRaw = FloatArray(maxLag + 2)
    private val baseline = FloatArray(maxLag + 2)
    private val magBuf = FloatArray(SonarConfig.FFT_SIZE / 2)
    private val peak = PeakDetector.Result()
    private val history = DoubleArray(3)
    private var historyCount = 0

    // Lock state.
    private var locked = false
    private var directAbs = -1L
    private var misses = 0
    private var acqCursor = -1L

    // Optional static-clutter baseline (captured by [startCalibration]).
    @Volatile var baselineEnabled = false
    private var calibFramesLeft = 0
    private var calibCount = 0

    /** Set by the caller each frame when the recorder reports clipped samples. */
    @Volatile var inputClipping = false

    val result = FrameResult()

    class FrameResult {
        var seq = 0L
        var status = SystemStatus.ACQUIRING
        var detected = false
        var distanceM = -1.0
        var rawDistanceM = -1.0
        var velocityMps = 0.0
        var psr = 0.0
        var threat = ThreatLevel.CLEAR
        var directPathValue = 0f
        var directAbs = -1L
        var noiseMean = 0.0
        var threshold = 0.0
        var dspLatencyMs = 0.0
        var frameDoneNanos = 0L
        val curve = FloatArray(SonarConfig.CURVE_BINS)
        val spectrumDb = FloatArray(SonarConfig.SPECTRUM_BINS)
        var calibrating = false
        var cluttered = false
    }

    /** Absolute sample index that must be captured before the next [process] call can succeed. */
    fun nextRequiredIndex(): Long = if (!locked) {
        val start = if (acqCursor < 0) ring.oldestAvailable() else acqCursor
        start + acqLags + n
    } else directAbs + pri - searchMargin + trackLags + n

    fun startCalibration(frames: Int = 20) {
        baseline.fill(0f); calibCount = 0; calibFramesLeft = frames; baselineEnabled = false
    }

    fun reset() {
        locked = false; directAbs = -1; misses = 0; acqCursor = -1; historyCount = 0
    }

    /** @return the updated [result], or null if not enough audio has been captured yet. */
    fun process(): FrameResult? {
        if (ring.writeIndex < nextRequiredIndex()) return null
        val t0 = System.nanoTime()
        val ok = if (locked) track() else acquire()
        if (!ok) return null
        result.seq++
        val t1 = System.nanoTime()
        result.dspLatencyMs = (t1 - t0) / 1e6
        result.frameDoneNanos = t1
        return result
    }

    // ---------------------------------------------------------------- acquisition
    private fun acquire(): Boolean {
        if (acqCursor < ring.oldestAvailable()) acqCursor = ring.oldestAvailable()
        val len = acqLags + n - 1
        if (!ring.read(acqCursor, xBuf, len)) { acqCursor = -1; return false }
        filter.correlateAnalytic(xBuf, acqLags, envBuf)
        var k = 0; var v = 0f
        for (i in 0 until acqLags) if (envBuf[i] > v) { v = envBuf[i]; k = i }
        result.directPathValue = v
        clearOutputs()
        if (v >= directMin) {
            directAbs = acqCursor + k
            locked = true; misses = 0
            result.status = SystemStatus.ACQUIRING
        } else {
            acqCursor += pri
            result.status = SystemStatus.UNCERTAIN // no direct path: speaker/mic blocked or muted
            result.threat = ThreatLevel.UNCERTAIN
        }
        result.directAbs = directAbs
        return true
    }

    // ---------------------------------------------------------------- tracking
    private fun track(): Boolean {
        val expected = directAbs + pri
        val start = expected - searchMargin
        val len = trackLags + n - 1
        if (!ring.read(start, xBuf, len)) { reset(); return false } // fell behind → re-acquire
        filter.correlateAnalytic(xBuf, trackLags, envBuf)

        var k = searchMargin; var v = 0f
        for (i in 0..2 * searchMargin) if (envBuf[i] > v) { v = envBuf[i]; k = i }
        result.directPathValue = v
        if (v >= directMin) {
            misses = 0
        } else {
            k = searchMargin; misses++
            if (misses >= maxMisses) {
                reset(); clearOutputs()
                result.status = SystemStatus.UNCERTAIN
                result.threat = ThreatLevel.UNCERTAIN
                return true
            }
        }
        directAbs = start + k
        result.directAbs = directAbs

        // Direct-path relative envelope: relRaw[i] = envBuf[k + i].
        val avail = minOf(maxLag + 2, trackLags - k)
        for (i in 0 until avail) {
            val envVal = envBuf[k + i]
            val directSidelobe = if (autoCorrEnvelope != null && i < autoCorrEnvelope.size) {
                v * autoCorrEnvelope[i]
            } else 0f
            // Cancel the direct path and its sidelobes
            relRaw[i] = maxOf(0f, envVal - directSidelobe)
        }
        for (i in avail until relRaw.size) relRaw[i] = 0f

        handleBaseline()
        System.arraycopy(relRaw, 0, relEnv, 0, relRaw.size)
        detector.detect(relEnv, relEnv.size, peak)

        buildCurve()
        buildSpectrum(k)
        classify(v >= directMin)
        return true
    }

    private fun handleBaseline() {
        if (calibFramesLeft > 0) {
            for (i in relRaw.indices) baseline[i] += relRaw[i]
            calibCount++; calibFramesLeft--
            if (calibFramesLeft == 0) {
                for (i in baseline.indices) baseline[i] /= calibCount
                baselineEnabled = true
            }
        } else if (baselineEnabled) {
            for (i in relRaw.indices) relRaw[i] = maxOf(0f, relRaw[i] - baseline[i])
        }
        result.calibrating = calibFramesLeft > 0
    }

    private fun classify(directOk: Boolean) {
        result.psr = peak.psr
        result.noiseMean = peak.noiseMean
        result.threshold = peak.threshold
        result.cluttered = peak.cluttered
        result.rawDistanceM = peak.distanceM()

        val inRange = peak.detected && result.rawDistanceM in SonarConfig.MIN_RANGE_M..SonarConfig.MAX_RANGE_M
        val prev = result.distanceM
        if (inRange) {
            history[(historyCount % history.size)] = result.rawDistanceM
            historyCount++
            result.distanceM = median()
            result.velocityMps = if (prev > 0) 0.6 * result.velocityMps + 0.4 * (result.distanceM - prev) * 10.0 else 0.0
        } else {
            historyCount = 0
            result.distanceM = -1.0
            result.velocityMps = 0.0
        }
        result.detected = inRange

        val uncertain = !directOk || inputClipping || peak.uncertain
        result.threat = when {
            uncertain -> ThreatLevel.UNCERTAIN
            inRange -> ThreatLevel.fromDistance(result.distanceM)
            else -> ThreatLevel.CLEAR
        }
        result.status = when {
            result.calibrating -> SystemStatus.ACQUIRING
            uncertain -> SystemStatus.UNCERTAIN
            inRange -> SystemStatus.TRACKING
            else -> SystemStatus.SEARCHING
        }
    }

    private fun median(): Double {
        val c = minOf(historyCount, history.size)
        return when (c) {
            1 -> history[0]
            2 -> (history[0] + history[1]) / 2
            else -> {
                val a = history[0]; val b = history[1]; val d = history[2]
                maxOf(minOf(a, b), minOf(maxOf(a, b), d))
            }
        }
    }

    private fun buildCurve() {
        val bins = result.curve.size
        val lagsPerBin = SonarConfig.metersToLag(SonarConfig.CURVE_MAX_RANGE_M).toDouble() / bins
        for (b in 0 until bins) {
            val lo = (b * lagsPerBin).toInt(); val hi = minOf(((b + 1) * lagsPerBin).toInt(), relEnv.size)
            var m = 0f
            for (i in lo until hi) if (relEnv[i] > m) m = relEnv[i]
            result.curve[b] = m
        }
    }

    private fun buildSpectrum(k: Int) {
        val size = SonarConfig.FFT_SIZE
        if (k + size > xBuf.size) return
        fft.magnitude(xBuf, k, magBuf)
        val binHz = SonarConfig.SAMPLE_RATE.toDouble() / size
        val first = Math.ceil(SonarConfig.BPF_LOW_HZ / binHz).toInt()
        for (i in result.spectrumDb.indices) {
            val m = magBuf[(first + i).coerceAtMost(magBuf.size - 1)]
            result.spectrumDb[i] = (20 * log10(maxOf(m.toDouble(), 1e-9))).toFloat()
        }
    }

    private fun clearOutputs() {
        result.detected = false; result.distanceM = -1.0; result.rawDistanceM = -1.0
        result.velocityMps = 0.0; result.psr = 0.0; result.curve.fill(0f); result.cluttered = false
    }
}
