package com.aethersense.safety

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Loop 4 verification: IMU Impact Safety Tripwire (Feature 3).
 *
 * Trigger Conditions:
 *  1. Free-fall condition: ||a|| < 2.5 m/s² (<0.25g) lasting for >= 120 ms.
 *  2. Followed within 200 ms by an impact shock: ||a|| > 30.0 m/s² (>3.0g).
 */
class ImuTripwireTest {
    private val detector = DropImpactDetector()

    @Test
    fun completeDropSequenceTriggersImpact() {
        val dtNs = 10_000_000L // 100 Hz = 10 ms per sample
        var t = 1_000_000_000L

        // Phase 1: Normal stationary gravity (9.8 m/s²)
        for (i in 0 until 10) {
            assertFalse(detector.onSample(t, 9.8))
            t += dtNs
        }
        assertEquals(DropImpactDetector.State.ARMED, detector.state)

        // Phase 2: Free-fall (1.0 m/s² < 2.5 m/s²) for 130 ms (13 samples > 120 ms)
        for (i in 0 until 13) {
            assertFalse(detector.onSample(t, 1.0))
            t += dtNs
        }
        assertEquals(DropImpactDetector.State.FREE_FALL, detector.state)

        // Phase 3: Transition out of free-fall into shock (50 ms later within 200 ms window)
        // Shock impact ||a|| = 38.0 m/s² > 30.0 m/s²
        val triggered = detector.onSample(t, 38.0)
        assertTrue("Impact must trigger", triggered)
        assertEquals(DropImpactDetector.State.IMPACT, detector.state)

        // Subsequent samples must not re-trigger while latched in IMPACT
        assertFalse(detector.onSample(t + dtNs, 40.0))
        assertEquals(DropImpactDetector.State.IMPACT, detector.state)

        // Reset re-arms
        detector.reset()
        assertEquals(DropImpactDetector.State.ARMED, detector.state)
    }

    @Test
    fun shockWithoutFreeFallDoesNotTrigger() {
        val dtNs = 10_000_000L
        var t = 1_000_000_000L

        // Aggressive shake or bump (e.g. 35 m/s²) without free-fall
        for (i in 0 until 5) {
            assertFalse(detector.onSample(t, 35.0))
            t += dtNs
        }
        assertEquals(DropImpactDetector.State.ARMED, detector.state)
    }

    @Test
    fun freeFallTooShortDoesNotTrigger() {
        val dtNs = 10_000_000L
        var t = 1_000_000_000L

        // Free-fall for only 80 ms (8 samples < 120 ms)
        for (i in 0 until 8) {
            assertFalse(detector.onSample(t, 1.5))
            t += dtNs
        }
        // Jump back to gravity
        assertFalse(detector.onSample(t, 9.8))
        assertEquals(DropImpactDetector.State.ARMED, detector.state)

        // Subsequent shock should NOT trigger because free-fall was too brief
        t += dtNs
        assertFalse(detector.onSample(t, 35.0))
        assertEquals(DropImpactDetector.State.ARMED, detector.state)
    }

    @Test
    fun impactWindowExpiredDoesNotTrigger() {
        val dtNs = 10_000_000L
        var t = 1_000_000_000L

        // Valid free-fall for 140 ms
        for (i in 0 until 14) {
            assertFalse(detector.onSample(t, 1.0))
            t += dtNs
        }

        // Return to low acceleration (e.g. caught in pillow or soft motion) for 250 ms (> 200 ms window)
        for (i in 0 until 25) {
            assertFalse(detector.onSample(t, 5.0))
            t += dtNs
        }
        assertEquals(DropImpactDetector.State.ARMED, detector.state)

        // Shock arrives after window has expired
        assertFalse(detector.onSample(t, 45.0))
        assertEquals(DropImpactDetector.State.ARMED, detector.state)
    }
}
