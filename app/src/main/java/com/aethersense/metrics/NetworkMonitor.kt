package com.aethersense.metrics

import android.net.TrafficStats
import android.os.Process

/**
 * Monitors external network traffic for this app UID.
 * PRD Feature 4: Cloud Throughput readout (Target: 0.00 KB/s in offline mode).
 */
class NetworkMonitor {
    private val uid = Process.myUid()
    private var lastRxBytes = TrafficStats.getUidRxBytes(uid)
    private var lastTxBytes = TrafficStats.getUidTxBytes(uid)
    private var lastTimeMs = System.currentTimeMillis()

    @Volatile var cloudBytesSec: Long = 0L
        private set

    fun update(): Long {
        val now = System.currentTimeMillis()
        val dt = now - lastTimeMs
        if (dt < 500) return cloudBytesSec

        val rx = TrafficStats.getUidRxBytes(uid)
        val tx = TrafficStats.getUidTxBytes(uid)
        if (lastRxBytes != TrafficStats.UNSUPPORTED.toLong() && rx != TrafficStats.UNSUPPORTED.toLong()) {
            val dBytes = (rx - lastRxBytes) + (tx - lastTxBytes)
            cloudBytesSec = if (dBytes > 0) (dBytes * 1000L / dt) else 0L
        } else {
            cloudBytesSec = 0L
        }
        lastRxBytes = rx
        lastTxBytes = tx
        lastTimeMs = now
        return cloudBytesSec
    }
}
