package com.aethersense.dsp

import com.aethersense.config.SonarConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.log10

/** Verification Gate 1 (offline part): chirp is clean, band-limited and click-free. */
class ChirpGeneratorTest {
    private val gen = ChirpGenerator()

    @Test fun lengthsMatchPrd() {
        assertEquals(960, gen.chirp.size)
        assertEquals(4800, gen.frame.size)
        for (i in 960 until 4800) assertEquals(0f, gen.frame[i], 0f)
    }

    @Test fun amplitudeBoundedAndEdgesTapered() {
        val peak = gen.chirp.maxOf { abs(it) }
        assertTrue("peak $peak", peak <= SonarConfig.CHIRP_AMPLITUDE + 1e-6f)
        assertTrue(peak > 0.7f)
        assertEquals(0f, gen.chirp.first(), 1e-6f)
        assertEquals(0f, gen.chirp.last(), 1e-3f)
        // Successive-sample jump at the frame wrap-around (chirp end → silence → next chirp start) is ~0.
        assertTrue(abs(gen.frame[0] - gen.frame[gen.frame.size - 1]) < 1e-3f)
    }

    @Test fun energyIsInsideUltrasonicBand() {
        val fft = Fft(1024)
        val padded = FloatArray(1024).also { gen.chirp.copyInto(it) }
        val mag = FloatArray(512)
        fft.magnitude(padded, 0, mag)
        val binHz = 48000.0 / 1024
        var inBand = 0.0; var total = 0.0; var audiblePeak = 0.0; var bandPeak = 0.0
        for (k in mag.indices) {
            val f = k * binHz; val p = mag[k].toDouble() * mag[k]
            total += p
            if (f in 17_500.0..20_500.0) { inBand += p; bandPeak = maxOf(bandPeak, mag[k].toDouble()) }
            if (f < 17_000.0) audiblePeak = maxOf(audiblePeak, mag[k].toDouble())
        }
        val frac = inBand / total
        val audibleDb = 20 * log10(audiblePeak / bandPeak)
        println("Gate1: in-band energy=${"%.4f".format(frac * 100)}%  audible leakage=${"%.1f".format(audibleDb)} dB")
        assertTrue("in-band fraction $frac", frac > 0.95)
        assertTrue("audible leakage $audibleDb dB", audibleDb < -40)
    }

    @Test fun autocorrelationPeakAtZero() {
        val mf = MatchedFilter(gen.chirp)
        val x = FloatArray(960 + 959 + 200).also { gen.chirp.copyInto(it, 100) }
        val r = FloatArray(1100)
        mf.correlate(x, 1100, r)
        var k = 0; for (i in r.indices) if (abs(r[i]) > abs(r[k])) k = i
        assertEquals(100, k)
        assertEquals(1.0f, r[100], 1e-3f)

        // Inspect sidelobes beyond blanking (lag > 84).
        val env = FloatArray(1100)
        MatchedFilter.envelope(r, 1100, env)
        var maxSidelobe = 0f
        var maxLag = 0
        for (lag in 84..700) {
            val v = env[100 + lag]
            if (v > maxSidelobe) { maxSidelobe = v; maxLag = lag }
        }
        val maxSidelobeDb = 20 * log10(maxSidelobe.toDouble())
        println("Max sidelobe at lag > 84: val=$maxSidelobe ($maxSidelobeDb dB) at lag=$maxLag")
    }
}
