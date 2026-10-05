package com.aethersense.feedback

import android.content.Context
import android.os.CombinedVibration
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.VibratorManager
import android.util.Log
import com.aethersense.config.SonarConfig
import com.aethersense.model.ThreatLevel

/**
 * Loop 4 — Haptic danger ladder (Feature 2).
 *
 * The waveform is re-issued only when the haptic level changes, so the repeating pattern
 * keeps its cadence instead of being restarted every 100 ms DSP frame.
 */
class HapticEngine(context: Context) {
    private val vm = context.getSystemService(VibratorManager::class.java)
    private val vibrator = vm.defaultVibrator
    private val attrs = VibrationAttributes.Builder()
        .setUsage(VibrationAttributes.USAGE_ALARM) // keeps working with screen off / silent mode
        .build()
    private val ladder = HapticLadder()

    @Volatile var currentLevel: ThreatLevel = ThreatLevel.CLEAR
        private set
    /** DSP-frame-completion → vibrate() call latency of the most recent level change (ms). */
    @Volatile var lastSwitchLatencyMs: Double = 0.0
        private set

    /** Called once per DSP frame. */
    fun onFrame(threat: ThreatLevel, distanceM: Double, frameDoneNanos: Long) {
        val level = ladder.update(threat, distanceM)
        if (level != currentLevel) apply(level, frameDoneNanos)
    }

    fun impact() { ladder.forceImpact(); apply(ThreatLevel.IMPACT, System.nanoTime()) }

    fun clearImpact() { ladder.reset(); apply(ThreatLevel.CLEAR, System.nanoTime()) }

    fun stop() { vibrator.cancel(); currentLevel = ThreatLevel.CLEAR; ladder.reset() }

    private fun apply(level: ThreatLevel, frameDoneNanos: Long) {
        currentLevel = level
        val p = patternFor(level)
        if (p == null) {
            vibrator.cancel()
        } else {
            val amps = amplitudesFor(level, p.size)
            val effect = if (vibrator.hasAmplitudeControl()) VibrationEffect.createWaveform(p, amps, 0)
            else VibrationEffect.createWaveform(p, 0)
            vibrator.vibrate(effect, attrs)
        }
        lastSwitchLatencyMs = (System.nanoTime() - frameDoneNanos) / 1e6
        Log.d(TAG, "haptic=$level latency=${"%.2f".format(lastSwitchLatencyMs)}ms")
    }

    companion object {
        private const val TAG = "AetherHaptic"

        /** Timings (ms) as [off, on, off, on, ...], repeated from index 0. Null = no vibration. */
        fun patternFor(level: ThreatLevel): LongArray? = when (level) {
            ThreatLevel.CLEAR -> null
            ThreatLevel.CAUTION -> longArrayOf(0, 50, 400)
            ThreatLevel.WARNING -> longArrayOf(0, 70, 200)
            ThreatLevel.HAZARD -> longArrayOf(0, 100, 80)
            ThreatLevel.UNCERTAIN -> longArrayOf(0, 30, 60, 30, 1000) // soft double-tap
            ThreatLevel.IMPACT -> longArrayOf(0, 1000)                 // continuous max
        }

        fun amplitudesFor(level: ThreatLevel, size: Int): IntArray {
            val on = when (level) {
                ThreatLevel.UNCERTAIN -> 90
                ThreatLevel.CAUTION -> 160
                ThreatLevel.WARNING -> 210
                else -> 255
            }
            return IntArray(size) { if (it % 2 == 1) on else 0 }
        }
    }
}

/**
 * Pure state logic for the ladder: escalation is immediate; de-escalation needs the distance to
 * clear the zone boundary by [hysteresisM] for [deescalateFrames] consecutive frames.
 */
class HapticLadder(
    private val hysteresisM: Double = SonarConfig.HAPTIC_HYSTERESIS_M,
    private val deescalateFrames: Int = 2,
) {
    var level = ThreatLevel.CLEAR
        private set
    private var pendingLower = 0

    fun update(threat: ThreatLevel, distanceM: Double): ThreatLevel {
        if (level == ThreatLevel.IMPACT) return level
        val target = when (threat) {
            ThreatLevel.UNCERTAIN, ThreatLevel.IMPACT -> threat
            ThreatLevel.CLEAR -> ThreatLevel.CLEAR
            else -> ThreatLevel.fromDistance(distanceM)
        }
        if (severity(target) >= severity(level) || target == ThreatLevel.UNCERTAIN || level == ThreatLevel.UNCERTAIN) {
            level = target; pendingLower = 0; return level
        }
        // Candidate is less severe: require margin beyond the boundary (except for CLEAR from no detection).
        val clearedMargin = threat == ThreatLevel.CLEAR ||
            ThreatLevel.fromDistance(distanceM - hysteresisM) == target
        if (clearedMargin && ++pendingLower >= deescalateFrames) { level = target; pendingLower = 0 }
        return level
    }

    fun forceImpact() { level = ThreatLevel.IMPACT }
    fun reset() { level = ThreatLevel.CLEAR; pendingLower = 0 }

    private fun severity(t: ThreatLevel) = when (t) {
        ThreatLevel.CLEAR -> 0; ThreatLevel.UNCERTAIN -> 1; ThreatLevel.CAUTION -> 2
        ThreatLevel.WARNING -> 3; ThreatLevel.HAZARD -> 4; ThreatLevel.IMPACT -> 5
    }
}
