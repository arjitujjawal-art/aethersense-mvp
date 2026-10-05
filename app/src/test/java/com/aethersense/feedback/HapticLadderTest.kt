package com.aethersense.feedback

import com.aethersense.model.ThreatLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Loop 4 verification: Haptic ladder cadence and hysteresis.
 * Feature 2:
 *  - Clear / Out of Range (>2.0 m): No haptic feedback
 *  - Caution Zone (1.2 m to 2.0 m): Slow pulse (50 ms ON, 400 ms OFF)
 *  - Warning Zone (0.7 m to 1.2 m): Medium pulse (70 ms ON, 200 ms OFF)
 *  - Hazard Zone (<0.7 m): Rapid pulse (100 ms ON, 80 ms OFF)
 *  - Uncertain / Cluttered: Soft double-tap warning
 */
class HapticLadderTest {
    private val ladder = HapticLadder()

    @Test
    fun patternsMatchPrdFeature2() {
        assertNull(HapticEngine.patternFor(ThreatLevel.CLEAR))
        assertEquals(listOf(0L, 50L, 400L), HapticEngine.patternFor(ThreatLevel.CAUTION)!!.toList())
        assertEquals(listOf(0L, 70L, 200L), HapticEngine.patternFor(ThreatLevel.WARNING)!!.toList())
        assertEquals(listOf(0L, 100L, 80L), HapticEngine.patternFor(ThreatLevel.HAZARD)!!.toList())
        assertEquals(listOf(0L, 30L, 60L, 30L, 1000L), HapticEngine.patternFor(ThreatLevel.UNCERTAIN)!!.toList())
        assertEquals(listOf(0L, 1000L), HapticEngine.patternFor(ThreatLevel.IMPACT)!!.toList())
    }

    @Test
    fun threatMappingFromDistance() {
        assertEquals(ThreatLevel.CLEAR, ThreatLevel.fromDistance(2.5))
        assertEquals(ThreatLevel.CAUTION, ThreatLevel.fromDistance(1.8))
        assertEquals(ThreatLevel.WARNING, ThreatLevel.fromDistance(0.95))
        assertEquals(ThreatLevel.HAZARD, ThreatLevel.fromDistance(0.45))
        assertEquals(ThreatLevel.CLEAR, ThreatLevel.fromDistance(-1.0))
    }

    @Test
    fun immediateEscalation() {
        assertEquals(ThreatLevel.CLEAR, ladder.level)
        // Moving from clear directly to hazard must escalate immediately
        assertEquals(ThreatLevel.HAZARD, ladder.update(ThreatLevel.HAZARD, 0.5))
        assertEquals(ThreatLevel.HAZARD, ladder.level)
    }

    @Test
    fun debouncedDeescalationWithHysteresis() {
        // Escalate to HAZARD
        ladder.update(ThreatLevel.HAZARD, 0.5)
        assertEquals(ThreatLevel.HAZARD, ladder.level)

        // Move to 0.72 m (inside hysteresis margin 0.70 + 0.05 = 0.75): stays HAZARD
        ladder.update(ThreatLevel.WARNING, 0.72)
        assertEquals(ThreatLevel.HAZARD, ladder.level)

        // Move to 0.85 m (beyond margin): first frame stays HAZARD (debouncing)
        ladder.update(ThreatLevel.WARNING, 0.85)
        assertEquals(ThreatLevel.HAZARD, ladder.level)

        // Second frame beyond margin: de-escalates to WARNING
        ladder.update(ThreatLevel.WARNING, 0.85)
        assertEquals(ThreatLevel.WARNING, ladder.level)
    }

    @Test
    fun impactLatchesUntilReset() {
        ladder.forceImpact()
        assertEquals(ThreatLevel.IMPACT, ladder.level)
        ladder.update(ThreatLevel.CLEAR, 3.0)
        assertEquals(ThreatLevel.IMPACT, ladder.level)
        ladder.reset()
        assertEquals(ThreatLevel.CLEAR, ladder.level)
    }
}
