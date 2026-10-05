package com.aethersense.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import com.aethersense.MainActivity
import com.aethersense.audio.EmergencyTone
import com.aethersense.audio.RingBuffer
import com.aethersense.audio.SonarPlayer
import com.aethersense.audio.SonarRecorder
import com.aethersense.config.SonarConfig
import com.aethersense.dsp.ChirpGenerator
import com.aethersense.engine.RangingEngine
import com.aethersense.feedback.HapticEngine
import com.aethersense.metrics.NetworkMonitor
import com.aethersense.model.SystemStatus
import com.aethersense.model.TelemetryPayload
import com.aethersense.model.ThreatLevel
import com.aethersense.safety.ImuTripwire
import com.aethersense.server.TelemetryServer

class SonarService : Service() {

    private val binder = LocalBinder()
    inner class LocalBinder : Binder() {
        val service: SonarService get() = this@SonarService
    }

    private var wakeLock: PowerManager.WakeLock? = null

    // Audio & DSP
    private lateinit var chirpGen: ChirpGenerator
    private lateinit var player: SonarPlayer
    private lateinit var ring: RingBuffer
    private lateinit var recorder: SonarRecorder
    private lateinit var engine: RangingEngine
    private lateinit var haptic: HapticEngine
    private lateinit var imu: ImuTripwire
    private lateinit var siren: EmergencyTone
    private lateinit var server: TelemetryServer
    private lateinit var netMonitor: NetworkMonitor

    @Volatile private var running = false
    private var dspThread: Thread? = null

    @Volatile var isImpactAlert = false
        private set

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Initializing SonarService")

        val pm = getSystemService(PowerManager::class.java)
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AetherSense:SonarWakeLock").apply {
            acquire(24 * 3600 * 1000L) // 24h safety timeout
        }

        chirpGen = ChirpGenerator()
        player = SonarPlayer(chirpGen.frame)
        ring = RingBuffer(SonarConfig.RING_BUFFER_SIZE)
        recorder = SonarRecorder(this, ring)
        engine = RangingEngine(ring, chirpGen)
        haptic = HapticEngine(this)
        siren = EmergencyTone(this)
        netMonitor = NetworkMonitor()

        imu = ImuTripwire(this) { thresholdCrossNanos ->
            onImpactDetected(thresholdCrossNanos)
        }

        server = TelemetryServer()
        try {
            server.start()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start telemetry server", e)
        }

        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_DISMISS_IMPACT) {
            dismissImpactAlert()
            return START_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification("AetherSense Active — Sonar Tracking"))
        startSonar()
        return START_STICKY
    }

    @Synchronized
    fun startSonar() {
        if (running) return
        running = true
        isImpactAlert = false

        haptic.clearImpact()
        siren.stop()
        recorder.start()
        player.start()
        imu.start()

        dspThread = Thread(::dspLoop, "AetherDspThread").apply {
            priority = Thread.MAX_PRIORITY
            start()
        }
        Log.i(TAG, "AetherSense Sonar started")
    }

    @Synchronized
    fun stopSonar() {
        running = false
        dspThread?.interrupt()
        dspThread?.join(500)
        dspThread = null

        player.stop()
        recorder.stop()
        imu.stop()
        haptic.stop()
        siren.stop()
        Log.i(TAG, "AetherSense Sonar stopped")
    }

    private fun onImpactDetected(tNs: Long) {
        if (isImpactAlert) return
        isImpactAlert = true

        // 1. Immediately suspend ultrasound chirp loop to free speaker
        player.stop()

        // 2. Continuous maximum haptic vibration
        haptic.impact()

        // 3. Emit audible emergency alert tone
        siren.start()

        // 4. Immediately broadcast IMPACT_ALERT packet over WebSocket
        val payload = TelemetryPayload(
            timestamp = System.currentTimeMillis(),
            status = "IMPACT_ALERT",
            targetDetected = false,
            distanceM = -1.0,
            confidencePsr = 0.0,
            threatLevel = "IMPACT",
            velocityMps = 0.0,
            accMagnitude = imu.magnitude,
            isImpact = true,
            dspLatencyMs = 0.0,
            audioSampleRate = SonarConfig.SAMPLE_RATE,
            cloudBytesSec = netMonitor.update(),
            audioSource = recorder.sourceName,
            underruns = player.underrunCount(),
            frameSeq = engine.result.seq + 1,
            correlationCurve = engine.result.curve,
            spectrumDb = engine.result.spectrumDb,
        )
        server.broadcastPayload(payload)

        // Update notification
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification("EMERGENCY: Impact Detected!"))
    }

    fun dismissImpactAlert() {
        if (!isImpactAlert) return
        isImpactAlert = false
        siren.stop()
        haptic.clearImpact()
        imu.rearm()
        player.start()
        Log.i(TAG, "Impact alert dismissed; sonar resumed")
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification("AetherSense Active — Sonar Tracking"))
    }

    private fun dspLoop() {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_DISPLAY)
        while (running) {
            if (isImpactAlert) {
                try { Thread.sleep(50) } catch (_: InterruptedException) { break }
                continue
            }

            engine.inputClipping = recorder.clippedSamples > 0
            val frame = engine.process()
            if (frame == null) {
                try { Thread.sleep(5) } catch (_: InterruptedException) { break }
                continue
            }

            // Haptic Ladder update
            haptic.onFrame(frame.threat, frame.distanceM, frame.frameDoneNanos)

            // Construct and broadcast telemetry
            val payload = TelemetryPayload(
                timestamp = System.currentTimeMillis(),
                status = frame.status.name,
                targetDetected = frame.detected,
                distanceM = frame.distanceM,
                confidencePsr = frame.psr,
                threatLevel = frame.threat.name,
                velocityMps = frame.velocityMps,
                accMagnitude = imu.magnitude,
                isImpact = false,
                dspLatencyMs = frame.dspLatencyMs,
                audioSampleRate = SonarConfig.SAMPLE_RATE,
                cloudBytesSec = netMonitor.update(),
                audioSource = recorder.sourceName,
                underruns = player.underrunCount(),
                frameSeq = frame.seq,
                correlationCurve = frame.curve,
                spectrumDb = frame.spectrumDb,
            )
            server.broadcastPayload(payload)
        }
    }

    override fun onDestroy() {
        stopSonar()
        server.stopSafe()
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder = binder

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "AetherSense Sonar Service",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Active acoustic radar and telemetry bridge"
        }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(statusText: String): Notification {
        val tapIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val dismissIntent = PendingIntent.getService(
            this, 1, Intent(this, SonarService::class.java).apply { action = ACTION_DISMISS_IMPACT },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("AetherSense Sonar")
            .setContentText(statusText)
            .setSmallIcon(com.aethersense.R.drawable.ic_launcher)
            .setContentIntent(tapIntent)
            .addAction(Notification.Action.Builder(null, "Dismiss Impact", dismissIntent).build())
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "SonarService"
        const val CHANNEL_ID = "aethersense_service_channel"
        const val NOTIFICATION_ID = 101
        const val ACTION_DISMISS_IMPACT = "com.aethersense.DISMISS_IMPACT"
    }
}
