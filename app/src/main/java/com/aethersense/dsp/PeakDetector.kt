package com.aethersense.dsp

import com.aethersense.config.SonarConfig
import kotlin.math.sqrt

/**
 * Loop 3 — Direct-path blanking, noise-floor estimation and target extraction.
 *
 * Operates on a correlation envelope whose index 0 is the direct-path (speaker→mic) arrival,
 * i.e. index == round-trip lag in samples.
 *
 * PSR is defined as in correlation-filter literature (Bolme et al., MOSSE):
 *     PSR = (peak − μ_sidelobe) / σ_sidelobe
 * so the PRD's two conditions "PSR ≥ 4.5" and "peak > μ + 4.5σ" are the same test.
 */
class PeakDetector(
    private val blankSamples: Int = SonarConfig.BLANK_SAMPLES,
    private val minLag: Int = SonarConfig.metersToLag(SonarConfig.MIN_RANGE_M),
    private val maxLag: Int = SonarConfig.metersToLag(SonarConfig.MAX_RANGE_M),
    private val noiseEndLag: Int = SonarConfig.metersToLag(SonarConfig.CURVE_MAX_RANGE_M),
    private val psrMin: Double = SonarConfig.PSR_MIN,
    private val uncertainPsrMin: Double = SonarConfig.UNCERTAIN_PSR_MIN,
    private val minPeakValue: Float = 0.010f,
    /** Half-width of the compressed-pulse main lobe (≈ Fs / B = 24 samples for a 2 kHz sweep). */
    private val mainLobeHalfWidth: Int = 24,
) {
    class Result {
        var detected = false
        var uncertain = false
        var cluttered = false
        var peakLag = -1.0          // sub-sample (parabolic) lag
        var peakValue = 0f
        var psr = 0.0
        var noiseMean = 0.0
        var noiseStd = 0.0
        var threshold = 0.0
        var secondPeakLag = -1
        fun distanceM(): Double = if (peakLag < 0) -1.0 else SonarConfig.rangeFromRelativeLag(peakLag)
    }

    /** Zeros env[0..blankSamples] in-place (direct path + chassis crosstalk). */
    fun blank(env: FloatArray) {
        for (i in 0..minOf(blankSamples, env.size - 1)) env[i] = 0f
    }

    fun detect(env: FloatArray, len: Int, out: Result): Result {
        blank(env)
        val hiValid = minOf(maxLag, len - 2)
        val hiNoise = minOf(noiseEndLag, len - 1)
        out.detected = false; out.uncertain = false; out.cluttered = false
        out.peakLag = -1.0; out.peakValue = 0f; out.psr = 0.0; out.secondPeakLag = -1

        // 1. Strongest candidate inside the valid detection envelope.
        var pk = -1; var pv = 0f
        for (i in maxOf(minLag, 1)..hiValid) if (env[i] > pv) { pv = env[i]; pk = i }
        if (pk < 0) return out

        // 2. Sidelobe statistics (exclude main lobe around the candidate and the blanked zone).
        var sum = 0.0; var sumSq = 0.0; var count = 0
        for (i in blankSamples + 1..hiNoise) {
            if (i >= pk - mainLobeHalfWidth && i <= pk + mainLobeHalfWidth) continue
            val v = env[i].toDouble(); sum += v; sumSq += v * v; count++
        }
        if (count < 8) return out
        val mu = sum / count
        val sigma = sqrt(maxOf(sumSq / count - mu * mu, 1e-18))
        out.noiseMean = mu; out.noiseStd = sigma
        out.threshold = mu + psrMin * sigma
        out.psr = (pv - mu) / sigma
        out.peakValue = pv

        // 3. Sub-sample refinement (parabolic fit on the envelope).
        val y0 = env[pk - 1].toDouble(); val y1 = pv.toDouble(); val y2 = env[pk + 1].toDouble()
        val d = y0 - 2 * y1 + y2
        val delta = if (d < 0) (0.5 * (y0 - y2) / d).coerceIn(-0.5, 0.5) else 0.0
        out.peakLag = pk + delta

        // 4. Clutter check: another strong, separate peak of comparable height.
        var sv = 0f; var sk = -1
        for (i in maxOf(minLag, 1)..hiValid) {
            if (i >= pk - 2 * mainLobeHalfWidth && i <= pk + 2 * mainLobeHalfWidth) continue
            if (env[i] > sv) { sv = env[i]; sk = i }
        }
        out.secondPeakLag = sk
        out.detected = out.psr >= psrMin && pv >= minPeakValue
        out.cluttered = out.detected && sk >= 0 && sv >= 0.60f * pv
        out.uncertain = out.cluttered || (pv >= minPeakValue && out.psr >= uncertainPsrMin && out.psr < psrMin)
        return out
    }
}
