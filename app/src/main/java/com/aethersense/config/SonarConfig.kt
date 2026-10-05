package com.aethersense.config

/**
 * Single source of truth for every numeric constant in the AetherSense MVP PRD.
 * Values that deviate from the literal PRD text are annotated with the reason.
 */
object SonarConfig {
    // ---- Audio ----
    const val SAMPLE_RATE = 48_000
    const val RECORD_READ_SIZE = 2048            // ~42.6 ms per AudioRecord read (PRD)
    const val RING_BUFFER_SIZE = 16_384          // PRD said 4096; must hold > 1 PRI (4800) + search window

    // ---- Chirp (Feature 1) ----
    const val F0_HZ = 18_000.0
    const val F1_HZ = 20_000.0
    const val CHIRP_DURATION_S = 0.020
    const val CHIRP_SAMPLES = 960                // 20 ms @ 48 kHz
    const val PRI_SAMPLES = 4_800                // 100 ms -> 10 chirps/s
    const val TUKEY_ALPHA = 0.20                 // 10% cosine taper on each end (Loop 1 wording)
    const val CHIRP_AMPLITUDE = 0.8f

    // ---- Band-pass ----
    const val BPF_LOW_HZ = 17_500.0
    const val BPF_HIGH_HZ = 20_500.0

    // ---- Ranging ----
    const val SPEED_OF_SOUND = 343.0
    const val MIN_RANGE_M = 0.30
    const val MAX_RANGE_M = 2.50
    const val CURVE_MAX_RANGE_M = 3.0            // oscilloscope span
    const val CURVE_BINS = 100

    /** PRD said 48 samples (=0.17 m round-trip). 84 samples = 0.30 m, matching the valid envelope. */
    val BLANK_SAMPLES: Int = metersToLag(MIN_RANGE_M)
    val MAX_LAG: Int = metersToLag(CURVE_MAX_RANGE_M) + 4

    const val SIGMA_THRESHOLD = 4.5              // peak > mu + 4.5 sigma
    const val PSR_MIN = 4.5                      // PSR >= 4.5 (PRD Feature 1)
    const val UNCERTAIN_PSR_MIN = 3.0            // 3.0..4.5 -> UNCERTAIN state
    const val CLIP_LEVEL = 0.98f

    // ---- Haptic ladder (Feature 2) ----
    const val CAUTION_MAX_M = 2.0
    const val WARNING_MAX_M = 1.2
    const val HAZARD_MAX_M = 0.7
    const val HAPTIC_HYSTERESIS_M = 0.05

    // ---- IMU tripwire (Feature 3) ----
    const val FREE_FALL_THRESHOLD = 2.5          // m/s^2  (<0.25 g)
    const val FREE_FALL_MIN_NS = 120_000_000L    // 120 ms
    const val IMPACT_THRESHOLD = 30.0            // m/s^2  (>3.0 g)
    const val IMPACT_WINDOW_NS = 200_000_000L    // 200 ms

    // ---- Telemetry ----
    const val WS_HOST = "127.0.0.1"
    const val WS_PORT = 8080
    const val WS_PATH = "/telemetry"
    const val SPECTRUM_BINS = 64
    const val FFT_SIZE = 1024

    /**
     * Acoustic path between the bottom speaker and the primary mic. Because τ is measured from the
     * direct-path arrival, the true range is d = (c·τ + s) / 2. Tune per device during Gate 3.
     */
    const val SPEAKER_MIC_SPACING_M = 0.02

    fun metersToLag(m: Double): Int = Math.round(m * 2.0 * SAMPLE_RATE / SPEED_OF_SOUND).toInt()
    fun lagToMeters(lag: Double): Double = lag * SPEED_OF_SOUND / (2.0 * SAMPLE_RATE)

    /** Range from a direct-path-relative lag, including the speaker–mic spacing correction. */
    fun rangeFromRelativeLag(lag: Double): Double =
        (lag * SPEED_OF_SOUND / SAMPLE_RATE + SPEAKER_MIC_SPACING_M) / 2.0
}
