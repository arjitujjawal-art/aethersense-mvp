package com.aethersense.model

import com.aethersense.config.SonarConfig

/**
 * Loop 5 — PRD Feature 4 Telemetry Payload.
 *
 * Direct serialization without reflection / Moshi / Jackson to avoid GC pressure
 * at 10 Hz on the DSP thread.
 */
data class TelemetryPayload(
    val timestamp: Long,
    val status: String,
    val targetDetected: Boolean,
    val distanceM: Double,
    val confidencePsr: Double,
    val threatLevel: String,
    val velocityMps: Double = 0.0,
    val accMagnitude: Double = 9.81,
    val isImpact: Boolean = false,
    val dspLatencyMs: Double = 0.0,
    val audioSampleRate: Int = SonarConfig.SAMPLE_RATE,
    val cloudBytesSec: Long = 0L,
    val audioSource: String = "UNPROCESSED",
    val underruns: Int = 0,
    val frameSeq: Long = 0L,
    val correlationCurve: FloatArray,
    val spectrumDb: FloatArray? = null,
) {
    fun toJson(): String {
        val sb = StringBuilder(2048)
        sb.append("{\"timestamp\":").append(timestamp)
        sb.append(",\"status\":\"").append(status).append("\"")

        // target
        sb.append(",\"target\":{")
        sb.append("\"detected\":").append(targetDetected)
        sb.append(",\"distance_m\":").append(if (distanceM > 0) String.format(java.util.Locale.US, "%.3f", distanceM) else "-1.0")
        sb.append(",\"confidence_psr\":").append(String.format(java.util.Locale.US, "%.2f", confidencePsr))
        sb.append(",\"threat_level\":\"").append(threatLevel).append("\"")
        sb.append(",\"velocity_mps\":").append(String.format(java.util.Locale.US, "%.2f", velocityMps))
        sb.append("}")

        // imu
        sb.append(",\"imu\":{")
        sb.append("\"acc_magnitude\":").append(String.format(java.util.Locale.US, "%.2f", accMagnitude))
        sb.append(",\"is_impact\":").append(isImpact)
        sb.append("}")

        // telemetry
        sb.append(",\"telemetry\":{")
        sb.append("\"dsp_latency_ms\":").append(String.format(java.util.Locale.US, "%.2f", dspLatencyMs))
        sb.append(",\"audio_sample_rate\":").append(audioSampleRate)
        sb.append(",\"cloud_bytes_sec\":").append(cloudBytesSec)
        sb.append(",\"audio_source\":\"").append(audioSource).append("\"")
        sb.append(",\"underruns\":").append(underruns)
        sb.append(",\"frame_seq\":").append(frameSeq)
        sb.append("}")

        // dsp
        sb.append(",\"dsp\":{")
        sb.append("\"correlation_curve\":[")
        for (i in correlationCurve.indices) {
            if (i > 0) sb.append(",")
            sb.append(String.format(java.util.Locale.US, "%.4f", correlationCurve[i]))
        }
        sb.append("]")

        if (spectrumDb != null && spectrumDb.isNotEmpty()) {
            sb.append(",\"spectrum\":[")
            for (i in spectrumDb.indices) {
                if (i > 0) sb.append(",")
                sb.append(String.format(java.util.Locale.US, "%.1f", spectrumDb[i]))
            }
            sb.append("]")
        }
        sb.append("}}")
        return sb.toString()
    }
}
