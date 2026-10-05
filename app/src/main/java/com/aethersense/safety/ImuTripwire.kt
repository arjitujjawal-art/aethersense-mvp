package com.aethersense.safety

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.util.Log
import com.aethersense.config.SonarConfig
import kotlin.math.sqrt

/**
 * Loop 4 — IMU impact tripwire (Feature 3). Android wrapper around [DropImpactDetector].
 * Runs on its own high-priority HandlerThread so DSP load can never delay detection.
 */
class ImuTripwire(context: Context, private val onImpact: (thresholdCrossNanos: Long) -> Unit) : SensorEventListener {
    private val sm = context.getSystemService(SensorManager::class.java)
    private val accel: Sensor? = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private var thread: HandlerThread? = null
    val detector = DropImpactDetector()

    @Volatile var magnitude: Double = SensorManager.GRAVITY_EARTH.toDouble()
        private set
    @Volatile var measuredRateHz: Double = 0.0
        private set
    private var rateCount = 0
    private var rateWindowStart = 0L

    fun start() {
        val s = accel ?: run { Log.e(TAG, "No accelerometer"); return }
        val t = HandlerThread("ImuTripwire", Process.THREAD_PRIORITY_URGENT_DISPLAY).also { it.start() }
        thread = t
        sm.registerListener(this, s, SensorManager.SENSOR_DELAY_FASTEST, Handler(t.looper))
        Log.i(TAG, "Accelerometer registered: ${s.name}, minDelay=${s.minDelay}us")
    }

    fun stop() {
        sm.unregisterListener(this)
        thread?.quitSafely(); thread = null
    }

    fun rearm() = detector.reset()

    override fun onSensorChanged(e: SensorEvent) {
        val ax = e.values[0]; val ay = e.values[1]; val az = e.values[2]
        val mag = sqrt((ax * ax + ay * ay + az * az).toDouble())
        magnitude = mag
        // Sample-rate measurement (PRD requires > 100 Hz).
        if (rateWindowStart == 0L) rateWindowStart = e.timestamp
        rateCount++
        if (e.timestamp - rateWindowStart >= 1_000_000_000L) {
            measuredRateHz = rateCount * 1e9 / (e.timestamp - rateWindowStart)
            rateCount = 0; rateWindowStart = e.timestamp
        }
        if (detector.onSample(e.timestamp, mag)) {
            Log.w(TAG, "IMPACT detected |a|=${"%.1f".format(mag)} m/s² (free-fall ${detector.lastFreeFallMs} ms)")
            onImpact(e.timestamp)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    companion object { private const val TAG = "AetherImpact" }
}

/**
 * Pure two-phase drop/impact state machine:
 *   ARMED → FREE_FALL (|a| < 2.5 m/s² for ≥ 120 ms) → AWAIT_IMPACT (≤ 200 ms) → IMPACT (|a| > 30 m/s²)
 * IMPACT is latched until [reset].
 */
class DropImpactDetector(
    private val freeFallThreshold: Double = SonarConfig.FREE_FALL_THRESHOLD,
    private val freeFallMinNs: Long = SonarConfig.FREE_FALL_MIN_NS,
    private val impactThreshold: Double = SonarConfig.IMPACT_THRESHOLD,
    private val impactWindowNs: Long = SonarConfig.IMPACT_WINDOW_NS,
) {
    enum class State { ARMED, FREE_FALL, AWAIT_IMPACT, IMPACT }

    @Volatile var state = State.ARMED
        private set
    private var freeFallStart = 0L
    private var freeFallEnd = 0L
    var lastFreeFallMs = 0L
        private set

    /** @return true exactly once, on the sample that completes the impact condition. */
    fun onSample(tNs: Long, mag: Double): Boolean {
        when (state) {
            State.IMPACT -> return false
            State.ARMED -> if (mag < freeFallThreshold) { freeFallStart = tNs; freeFallEnd = tNs; state = State.FREE_FALL }
            State.FREE_FALL -> {
                if (mag < freeFallThreshold) {
                    freeFallEnd = tNs
                } else if (freeFallEnd - freeFallStart >= freeFallMinNs) {
                    lastFreeFallMs = (freeFallEnd - freeFallStart) / 1_000_000
                    state = State.AWAIT_IMPACT
                    return checkImpact(tNs, mag) // the sample ending free-fall may itself be the shock
                } else {
                    state = State.ARMED
                }
            }
            State.AWAIT_IMPACT -> return checkImpact(tNs, mag)
        }
        return false
    }

    private fun checkImpact(tNs: Long, mag: Double): Boolean {
        if (tNs - freeFallEnd > impactWindowNs) {
            state = State.ARMED
            // This sample might start a new free-fall.
            if (mag < freeFallThreshold) { freeFallStart = tNs; freeFallEnd = tNs; state = State.FREE_FALL }
            return false
        }
        if (mag > impactThreshold) { state = State.IMPACT; return true }
        return false
    }

    fun reset() { state = State.ARMED; freeFallStart = 0; freeFallEnd = 0 }
}
