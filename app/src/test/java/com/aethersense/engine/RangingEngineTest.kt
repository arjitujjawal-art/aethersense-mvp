package com.aethersense.engine

import com.aethersense.audio.RingBuffer
import com.aethersense.config.SonarConfig
import com.aethersense.dsp.BandpassFilter
import com.aethersense.dsp.ChirpGenerator
import com.aethersense.dsp.MatchedFilter
import com.aethersense.model.SystemStatus
import com.aethersense.model.ThreatLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random
import kotlin.math.abs
import kotlin.math.sin

/**
 * Gates 2 & 3 (offline part): a simulated speaker→room→mic channel.
 * Each PRI contains a strong direct-path chirp (unknown system latency) plus an attenuated echo.
 */
class RangingEngineTest {
    private val gen = ChirpGenerator()
    private val fs = SonarConfig.SAMPLE_RATE

    /** Builds [frames] PRIs of mic audio. echoM < 0 → no echo. */
    private fun simulate(
        frames: Int, latency: Int, echoM: Double, echoAmp: Float = 0.04f, noise: Float = 0.003f,
        direct: Float = 0.6f, hum: Boolean = true, seed: Long = 1, extraEchoM: Double = -1.0,
    ): FloatArray {
        val total = frames * SonarConfig.PRI_SAMPLES + latency + 4000
        val x = FloatArray(total)
        val rnd = Random(seed)
        val c = gen.chirp
        val echoLag = if (echoM > 0) (echoM * 2 - SonarConfig.SPEAKER_MIC_SPACING_M) * fs / SonarConfig.SPEED_OF_SOUND else 0.0
        val extraLag = if (extraEchoM > 0) (extraEchoM * 2 - SonarConfig.SPEAKER_MIC_SPACING_M) * fs / SonarConfig.SPEED_OF_SOUND else 0.0
        for (f in 0 until frames) {
            val base = f * SonarConfig.PRI_SAMPLES + latency
            for (i in c.indices) {
                x[base + i] += direct * c[i]
                if (echoM > 0) addFrac(x, base + echoLag, i, -echoAmp * c[i])
                if (extraEchoM > 0) addFrac(x, base + extraLag, i, echoAmp * c[i])
            }
        }
        for (i in x.indices) {
            x[i] += (rnd.nextGaussian() * noise).toFloat()
            if (hum) x[i] += (0.2 * sin(2 * Math.PI * 200 * i / fs) + 0.05 * sin(2 * Math.PI * 1000 * i / fs)).toFloat()
        }
        return x
    }

    private fun addFrac(x: FloatArray, start: Double, i: Int, v: Float) {
        val p = start + i; val k = p.toInt(); val a = (p - k).toFloat()
        if (k + 1 < x.size) { x[k] += v * (1 - a); x[k + 1] += v * a }
    }

    /** Feeds audio through BPF + ring in 2048-sample blocks (like SonarRecorder) and runs the engine. */
    private fun run(audio: FloatArray, onFrame: (RangingEngine.FrameResult) -> Unit): RangingEngine {
        val ring = RingBuffer(SonarConfig.RING_BUFFER_SIZE)
        val engine = RangingEngine(ring, gen)
        val bpf = BandpassFilter()
        val block = FloatArray(SonarConfig.RECORD_READ_SIZE)
        var pos = 0
        while (pos < audio.size) {
            val n = minOf(block.size, audio.size - pos)
            System.arraycopy(audio, pos, block, 0, n)
            bpf.process(block, n)
            ring.write(block, n)
            pos += n
            while (true) { val r = engine.process() ?: break; onFrame(r) }
        }
        return engine
    }

    @Test fun gate2_directPathPeaksSpacedByPri() {
        val audio = simulate(frames = 30, latency = 1234, echoM = -1.0)
        val directs = mutableListOf<Long>()
        run(audio) { if (it.directAbs >= 0) directs += it.directAbs }
        val diffs = directs.zipWithNext { a, b -> b - a }.filter { it != 0L }
        println("Gate2: direct-path spacing = ${diffs.distinct()}")
        assertTrue(diffs.size >= 20)
        diffs.forEach { assertEquals(4800.0, it.toDouble(), 1.0) }
    }

    @Test fun gate3_rangeAtOneMetre() {
        val audio = simulate(frames = 30, latency = 777, echoM = 1.0)
        val ds = mutableListOf<Double>()
        run(audio) { if (it.detected) ds += it.distanceM }
        println("Gate3: 1.00 m -> ${ds.takeLast(5).map { "%.3f".format(it) }}")
        assertTrue("detections=${ds.size}", ds.size >= 20)
        ds.forEach { assertTrue("d=$it", it in 0.98..1.02) }
    }

    @Test fun acceptance_sweep_05_to_18m() {
        for (d in listOf(0.5, 0.75, 1.0, 1.25, 1.5, 1.8, 2.2)) {
            // Echo amplitude falls ~1/d² (spherical spreading, both ways).
            val amp = (0.04 / (d * d)).toFloat().coerceAtLeast(0.008f)
            val audio = simulate(frames = 20, latency = 500 + (d * 100).toInt(), echoM = d, echoAmp = amp, seed = d.toBits())
            val ds = mutableListOf<Double>()
            val threats = mutableSetOf<ThreatLevel>()
            run(audio) { if (it.detected) { ds += it.distanceM; threats += it.threat } }
            val mean = ds.average()
            println("Sweep: true=${"%.2f".format(d)} m  est=${"%.3f".format(mean)} m  n=${ds.size} threat=$threats")
            assertTrue("d=$d detections=${ds.size}", ds.size >= 12)
            assertEquals(d, mean, 0.03)
            assertEquals(setOf(ThreatLevel.fromDistance(d)), threats)
        }
    }

    @Test fun noTarget_isSearchingAndClear() {
        val audio = simulate(frames = 20, latency = 300, echoM = -1.0)
        var detections = 0; var last: SystemStatus? = null; var lastThreat: ThreatLevel? = null
        run(audio) { if (it.detected) detections++; last = it.status; lastThreat = it.threat }
        assertEquals(0, detections)
        assertEquals(SystemStatus.SEARCHING, last)
        assertEquals(ThreatLevel.CLEAR, lastThreat)
    }

    @Test fun targetInsideBlankingZone_isIgnored() {
        val audio = simulate(frames = 20, latency = 300, echoM = 0.12, echoAmp = 0.3f)
        var detections = 0
        run(audio) { if (it.detected && it.distanceM < 0.3) detections++ }
        assertEquals(0, detections)
    }

    @Test fun noDirectPath_isUncertain() {
        val audio = simulate(frames = 10, latency = 300, echoM = -1.0, direct = 0f)
        var last: RangingEngine.FrameResult? = null
        var sawUncertain = false
        run(audio) { last = it; if (it.threat == ThreatLevel.UNCERTAIN) sawUncertain = true }
        assertTrue(sawUncertain)
        assertFalse(last!!.detected)
    }

    @Test fun twoEqualEchoes_isCluttered() {
        val audio = simulate(frames = 20, latency = 300, echoM = 0.8, echoAmp = 0.05f, extraEchoM = 1.9)
        var uncertain = 0
        run(audio) {
            println("twoEqualEchoes: det=${it.detected} clut=${it.cluttered} psr=${"%.1f".format(it.psr)} threat=${it.threat} d=${"%.2f".format(it.distanceM)}")
            if (it.threat == ThreatLevel.UNCERTAIN) uncertain++
        }
        assertTrue("uncertain frames=$uncertain", uncertain >= 10)
    }

    @Test fun calibrationRemovesStaticClutter() {
        // A static reflector (e.g. table edge) at 0.6 m is captured in the baseline and suppressed.
        val audio = simulate(frames = 40, latency = 300, echoM = 0.6)
        val ring = RingBuffer(SonarConfig.RING_BUFFER_SIZE)
        val engine = RangingEngine(ring, gen)
        engine.startCalibration(10)
        val bpf = BandpassFilter(); val block = FloatArray(2048); var pos = 0
        var late = 0
        var frames = 0
        while (pos < audio.size) {
            val n = minOf(2048, audio.size - pos); System.arraycopy(audio, pos, block, 0, n)
            bpf.process(block, n); ring.write(block, n); pos += n
            while (true) { val r = engine.process() ?: break; frames++; if (frames > 15 && r.detected) late++ }
        }
        assertTrue(engine.baselineEnabled)
        assertEquals(0, late)
    }

    @Test fun dspLatencyIsSmall() {
        val audio = simulate(frames = 30, latency = 300, echoM = 1.0)
        val lat = mutableListOf<Double>()
        run(audio) { lat += it.dspLatencyMs }
        val p50 = lat.sorted()[lat.size / 2]
        println("DSP latency (JVM) p50=${"%.2f".format(p50)} ms max=${"%.2f".format(lat.max())} ms")
        assertTrue(p50 < 20.0)
    }

    @Test fun matchedFilterNormalisedToUnity() {
        val mf = MatchedFilter(gen.chirp)
        val x = FloatArray(3000).also { for (i in gen.chirp.indices) it[500 + i] = 0.25f * gen.chirp[i] }
        val r = FloatArray(2000); mf.correlate(x, 2000, r)
        assertEquals(1f, abs(r[500]), 1e-3f)
    }
}
