package com.aethersense.model

import com.aethersense.config.SonarConfig

enum class ThreatLevel {
    CLEAR, CAUTION, WARNING, HAZARD, UNCERTAIN, IMPACT;

    companion object {
        /** Feature 2 ladder: >2.0 clear, 1.2–2.0 caution, 0.7–1.2 warning, <0.7 hazard. */
        fun fromDistance(d: Double): ThreatLevel = when {
            d < 0 || d > SonarConfig.CAUTION_MAX_M -> CLEAR
            d > SonarConfig.WARNING_MAX_M -> CAUTION
            d > SonarConfig.HAZARD_MAX_M -> WARNING
            else -> HAZARD
        }
    }
}

enum class SystemStatus { IDLE, ACQUIRING, TRACKING, SEARCHING, UNCERTAIN, IMPACT_ALERT }
