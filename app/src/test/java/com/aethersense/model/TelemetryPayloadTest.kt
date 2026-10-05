package com.aethersense.model

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Loop 5 verification: Telemetry JSON formatting and schema conformance.
 */
class TelemetryPayloadTest {

    @Test
    fun jsonMatchesPrdFeature4Spec() {
        val curve = FloatArray(6) { (it + 1) * 0.1f }
        val payload = TelemetryPayload(
            timestamp = 1728100000123L,
            status = "TRACKING",
            targetDetected = true,
            distanceM = 1.24,
            confidencePsr = 6.8,
            threatLevel = "WARNING",
            velocityMps = -0.15,
            accMagnitude = 9.81,
            isImpact = false,
            dspLatencyMs = 14.2,
            audioSampleRate = 48000,
            cloudBytesSec = 0L,
            audioSource = "UNPROCESSED",
            underruns = 0,
            frameSeq = 42L,
            correlationCurve = curve,
        )

        val jsonStr = payload.toJson()
        val json = JSONObject(jsonStr)

        assertEquals(1728100000123L, json.getLong("timestamp"))
        assertEquals("TRACKING", json.getString("status"))

        val target = json.getJSONObject("target")
        assertTrue(target.getBoolean("detected"))
        assertEquals(1.24, target.getDouble("distance_m"), 0.001)
        assertEquals(6.8, target.getDouble("confidence_psr"), 0.01)
        assertEquals("WARNING", target.getString("threat_level"))

        val imu = json.getJSONObject("imu")
        assertEquals(9.81, imu.getDouble("acc_magnitude"), 0.01)
        assertFalse(imu.getBoolean("is_impact"))

        val telemetry = json.getJSONObject("telemetry")
        assertEquals(14.2, telemetry.getDouble("dsp_latency_ms"), 0.01)
        assertEquals(48000, telemetry.getInt("audio_sample_rate"))
        assertEquals(0L, telemetry.getLong("cloud_bytes_sec"))

        val dsp = json.getJSONObject("dsp")
        val curveArr = dsp.getJSONArray("correlation_curve")
        assertEquals(6, curveArr.length())
        assertEquals(0.1, curveArr.getDouble(0), 0.01)
        assertEquals(0.6, curveArr.getDouble(5), 0.01)
    }
}
