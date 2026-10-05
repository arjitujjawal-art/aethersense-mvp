package com.aethersense.dsp

import com.aethersense.config.SonarConfig
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Loop 1 — Linear FM chirp synthesizer.
 *
 * s(n) = w(n) * sin(2π (f0 t + (f1 - f0)/(2T) t²)),  t = n / Fs
 * w(n) = Tukey window (cosine taper on both ends) to eliminate audible clicks.
 */
class ChirpGenerator(
    val sampleRate: Int = SonarConfig.SAMPLE_RATE,
    val f0: Double = SonarConfig.F0_HZ,
    val f1: Double = SonarConfig.F1_HZ,
    val numSamples: Int = SonarConfig.CHIRP_SAMPLES,
    val priSamples: Int = SonarConfig.PRI_SAMPLES,
    val tukeyAlpha: Double = SonarConfig.TUKEY_ALPHA,
    val amplitude: Float = SonarConfig.CHIRP_AMPLITUDE,
) {
    /** Windowed chirp (sine phase), scaled by [amplitude]. Played through speaker. */
    val chirp: FloatArray = synthesizeSin()

    /** In-phase (cosine) and quadrature (sine) templates for analytic matched filtering. */
    val chirpCos: FloatArray = synthesizeCos()
    val chirpSin: FloatArray = synthesizeSin(scale = 1.0f) // unit amplitude template

    /** One full PRI: chirp followed by silence. Looped by [com.aethersense.audio.SonarPlayer]. */
    val frame: FloatArray = FloatArray(priSamples).also { chirp.copyInto(it) }

    /** Σ s[m]² — denominator term of the normalized cross-correlation. */
    val templateEnergy: Double = chirpSin.fold(0.0) { acc, v -> acc + v.toDouble() * v }
    val templateNorm: Double = sqrt(templateEnergy)

    /**
     * Precomputed normalized analytical autocorrelation envelope of the chirp:
     * autoCorrEnvelope[k] for k in 0 until numSamples.
     * At k=0, value is 1.0f. Used for direct-path chassis crosstalk cancellation.
     */
    val autoCorrEnvelope: FloatArray = computeAutoCorrEnvelope()

    private fun synthesizeSin(scale: Float = amplitude): FloatArray {
        val t = numSamples.toDouble() / sampleRate
        val k = (f1 - f0) / (2.0 * t)
        return FloatArray(numSamples) { n ->
            val tn = n.toDouble() / sampleRate
            val phase = 2.0 * PI * (f0 * tn + k * tn * tn)
            (scale * tukey(n, numSamples, tukeyAlpha) * sin(phase)).toFloat()
        }
    }

    private fun synthesizeCos(): FloatArray {
        val t = numSamples.toDouble() / sampleRate
        val k = (f1 - f0) / (2.0 * t)
        return FloatArray(numSamples) { n ->
            val tn = n.toDouble() / sampleRate
            val phase = 2.0 * PI * (f0 * tn + k * tn * tn)
            (tukey(n, numSamples, tukeyAlpha) * cos(phase)).toFloat()
        }
    }

    private fun computeAutoCorrEnvelope(): FloatArray {
        val out = FloatArray(numSamples)
        var maxVal = 0.0
        for (k in 0 until numSamples) {
            var dotCos = 0.0
            var dotSin = 0.0
            for (m in 0 until (numSamples - k)) {
                val s = chirpSin[m].toDouble()
                dotCos += s * chirpCos[m + k]
                dotSin += s * chirpSin[m + k]
            }
            val mag = sqrt(dotCos * dotCos + dotSin * dotSin)
            if (k == 0) maxVal = mag
            out[k] = if (maxVal > 0) (mag / maxVal).toFloat() else 0f
        }
        return out
    }

    companion object {
        /** Tukey (tapered cosine) window. alpha = fraction of the window inside the tapers (total). */
        fun tukey(n: Int, size: Int, alpha: Double): Double {
            if (alpha <= 0.0) return 1.0
            val m = (size - 1).toDouble()
            val x = n / m
            val half = alpha / 2.0
            return when {
                x < half -> 0.5 * (1 - cos(2 * PI * x / alpha))
                x > 1 - half -> 0.5 * (1 - cos(2 * PI * (1 - x) / alpha))
                else -> 1.0
            }
        }
    }
}
