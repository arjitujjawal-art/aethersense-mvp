package com.aethersense.dsp

import com.aethersense.config.SonarConfig
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * 4th-order Butterworth high-pass @ [lowHz] cascaded with 4th-order Butterworth low-pass @ [highHz]
 * (four biquads, Direct Form I). Stateful: call [process] on consecutive blocks.
 */
class BandpassFilter(
    sampleRate: Int = SonarConfig.SAMPLE_RATE,
    lowHz: Double = SonarConfig.BPF_LOW_HZ,
    highHz: Double = SonarConfig.BPF_HIGH_HZ,
) {
    private class Biquad(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {
        var x1 = 0.0; var x2 = 0.0; var y1 = 0.0; var y2 = 0.0
        fun step(x: Double): Double {
            val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y
            return y
        }
        fun reset() { x1 = 0.0; x2 = 0.0; y1 = 0.0; y2 = 0.0 }
    }

    // Q values of the two 2nd-order sections of a 4th-order Butterworth.
    private val butterQ = doubleArrayOf(0.5411961, 1.3065630)

    private val stages: Array<Biquad> = arrayOf(
        highPass(sampleRate, lowHz, butterQ[0]), highPass(sampleRate, lowHz, butterQ[1]),
        lowPass(sampleRate, highHz, butterQ[0]), lowPass(sampleRate, highHz, butterQ[1]),
    )

    fun process(buf: FloatArray, len: Int = buf.size) {
        for (i in 0 until len) {
            var v = buf[i].toDouble()
            for (s in stages) v = s.step(v)
            buf[i] = v.toFloat()
        }
    }

    fun reset() = stages.forEach { it.reset() }

    private fun highPass(fs: Int, f: Double, q: Double): Biquad {
        val w = 2 * PI * f / fs; val c = cos(w); val alpha = sin(w) / (2 * q); val a0 = 1 + alpha
        return Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - alpha) / a0)
    }

    private fun lowPass(fs: Int, f: Double, q: Double): Biquad {
        val w = 2 * PI * f / fs; val c = cos(w); val alpha = sin(w) / (2 * q); val a0 = 1 + alpha
        return Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - alpha) / a0)
    }
}
