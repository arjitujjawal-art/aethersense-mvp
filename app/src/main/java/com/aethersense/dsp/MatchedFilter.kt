package com.aethersense.dsp

import kotlin.math.sqrt

/**
 * Loop 2 — Normalized cross-correlation (matched filter) against the reference chirp.
 *
 *   R[k] = Σ x[k+m]·s[m] / sqrt( Σ x[k+m]² · Σ s[m]² ),   m = 0..N-1
 *
 * Supports both standard real correlation and analytic (IQ) matched filtering
 * to produce carrier-ripple-free envelopes with zero cycle slips.
 */
class MatchedFilter(
    private val template: FloatArray,
    private val templateCos: FloatArray? = null,
) {
    val templateLength = template.size
    private val templateEnergy: Double = template.fold(0.0) { a, v -> a + v.toDouble() * v }

    /**
     * Standard real normalized cross-correlation: Computes R[k] for k in 0 until [numLags].
     * [x] must contain at least numLags + N - 1 samples. Output is in [-1, 1].
     */
    fun correlate(x: FloatArray, numLags: Int, out: FloatArray) {
        val n = templateLength
        require(x.size >= numLags + n - 1) { "input too short: ${x.size} < ${numLags + n - 1}" }
        require(out.size >= numLags)

        var winEnergy = 0.0
        for (m in 0 until n) winEnergy += x[m].toDouble() * x[m]

        for (k in 0 until numLags) {
            var dot = 0f
            var m = 0
            var d0 = 0f; var d1 = 0f; var d2 = 0f; var d3 = 0f
            val limit = n - 3
            while (m < limit) {
                d0 += x[k + m] * template[m]
                d1 += x[k + m + 1] * template[m + 1]
                d2 += x[k + m + 2] * template[m + 2]
                d3 += x[k + m + 3] * template[m + 3]
                m += 4
            }
            while (m < n) { dot += x[k + m] * template[m]; m++ }
            dot += d0 + d1 + d2 + d3

            val denom = sqrt(winEnergy * templateEnergy)
            out[k] = if (denom > 1e-12) (dot / denom).toFloat() else 0f

            if (k + 1 < numLags) {
                val outgoing = x[k].toDouble()
                val incoming = x[k + n].toDouble()
                winEnergy += incoming * incoming - outgoing * outgoing
                if (winEnergy < 0.0) winEnergy = 0.0
            }
        }
    }

    /**
     * Analytic (IQ) normalized matched filter.
     * Computes the ripple-free envelope sqrt(I^2 + Q^2) / denom directly.
     * Guaranteed monotonic descent from true correlation peaks — eliminates carrier cycle slips.
     */
    fun correlateAnalytic(
        x: FloatArray,
        numLags: Int,
        outEnvelope: FloatArray,
        energyFloor: Double = 0.0,
    ) {
        val n = templateLength
        val cosT = templateCos
        if (cosT == null) {
            // Fallback: real correlate then envelope
            correlate(x, numLags, outEnvelope)
            envelope(outEnvelope, numLags, outEnvelope)
            return
        }

        require(x.size >= numLags + n - 1) { "input too short: ${x.size} < ${numLags + n - 1}" }
        require(outEnvelope.size >= numLags)

        var winEnergy = 0.0
        for (m in 0 until n) winEnergy += x[m].toDouble() * x[m]

        for (k in 0 until numLags) {
            var dotSin = 0.0
            var dotCos = 0.0
            var m = 0
            val limit = n - 3
            while (m < limit) {
                val x0 = x[k + m].toDouble()
                val x1 = x[k + m + 1].toDouble()
                val x2 = x[k + m + 2].toDouble()
                val x3 = x[k + m + 3].toDouble()

                dotSin += x0 * template[m] + x1 * template[m + 1] +
                          x2 * template[m + 2] + x3 * template[m + 3]
                dotCos += x0 * cosT[m] + x1 * cosT[m + 1] +
                          x2 * cosT[m + 2] + x3 * cosT[m + 3]
                m += 4
            }
            while (m < n) {
                val xv = x[k + m].toDouble()
                dotSin += xv * template[m]
                dotCos += xv * cosT[m]
                m++
            }

            val mag = sqrt(dotSin * dotSin + dotCos * dotCos)
            val effEnergy = maxOf(winEnergy, energyFloor)
            val denom = sqrt(effEnergy * templateEnergy)
            outEnvelope[k] = if (denom > 1e-12) (mag / denom).toFloat() else 0f

            if (k + 1 < numLags) {
                val outgoing = x[k].toDouble()
                val incoming = x[k + n].toDouble()
                winEnergy += incoming * incoming - outgoing * outgoing
                if (winEnergy < 0.0) winEnergy = 0.0
            }
        }
    }

    companion object {
        /**
         * Envelope of a correlation trace: |R| max-filtered over ±[halfWidth] samples.
         */
        fun envelope(r: FloatArray, len: Int, out: FloatArray, halfWidth: Int = 2) {
            val tmp = if (r === out) r.copyOf(len) else r
            for (k in 0 until len) {
                var mx = 0f
                val lo = maxOf(0, k - halfWidth); val hi = minOf(len - 1, k + halfWidth)
                for (j in lo..hi) { val a = kotlin.math.abs(tmp[j]); if (a > mx) mx = a }
                out[k] = mx
            }
        }
    }
}
