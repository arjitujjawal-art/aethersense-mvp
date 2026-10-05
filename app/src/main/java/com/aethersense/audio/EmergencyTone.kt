package com.aethersense.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.util.Log
import kotlin.math.PI
import kotlin.math.sin

/** Loop 4 — Audible emergency siren (alternating 2.5 / 3.2 kHz, 250 ms each), looped until stopped. */
class EmergencyTone(private val context: Context) {
    private var track: AudioTrack? = null
    private val sampleRate = 48_000
    private val buffer: FloatArray = synth()

    private fun synth(): FloatArray {
        val seg = sampleRate / 4
        var phase = 0.0
        return FloatArray(seg * 2) { n ->
            val f = if (n < seg) 2500.0 else 3200.0
            phase += 2 * PI * f / sampleRate
            val local = n % seg
            val ramp = minOf(1.0, minOf(local, seg - local) / 96.0) // 2 ms ramps, no clicks
            (0.95 * ramp * sin(phase)).toFloat()
        }
    }

    @Synchronized
    fun start() {
        if (track != null) return
        try {
            val am = context.getSystemService(AudioManager::class.java)
            am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
        } catch (e: SecurityException) { Log.w(TAG, "Cannot raise alarm volume (DND?)", e) }

        val t = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder().setSampleRate(sampleRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(buffer.size * 4)
            .build()
        t.write(buffer, 0, buffer.size, AudioTrack.WRITE_BLOCKING)
        t.setLoopPoints(0, buffer.size, -1)
        t.play()
        track = t
    }

    @Synchronized
    fun stop() {
        track?.let { try { it.stop() } catch (_: IllegalStateException) {}; it.release() }
        track = null
    }

    companion object { private const val TAG = "AetherSiren" }
}
