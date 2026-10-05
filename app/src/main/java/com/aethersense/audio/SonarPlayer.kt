package com.aethersense.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import com.aethersense.config.SonarConfig

/**
 * Loop 1 — Loops one PRI frame (chirp + silence) through the speaker.
 *
 * Uses MODE_STATIC with hardware loop points so the PRI is sample-exact and immune to
 * thread scheduling jitter. Falls back to a MODE_STREAM writer thread if the OEM HAL
 * rejects loop points.
 */
class SonarPlayer(private val frame: FloatArray) {

    private var track: AudioTrack? = null
    private var streamThread: Thread? = null
    @Volatile private var streaming = false
    @Volatile var isPlaying = false
        private set
    var usingStaticLoop = true
        private set

    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    private val format = AudioFormat.Builder()
        .setSampleRate(SonarConfig.SAMPLE_RATE)
        .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
        .build()

    @Synchronized
    fun start() {
        if (isPlaying) return
        if (!startStatic()) startStream()
        isPlaying = true
        Log.i(TAG, "Sonar playback started (static=$usingStaticLoop)")
    }

    private fun startStatic(): Boolean = try {
        val t = AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(format)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(frame.size * 4)
            .build()
        val written = t.write(frame, 0, frame.size, AudioTrack.WRITE_BLOCKING)
        val loop = t.setLoopPoints(0, frame.size, -1)
        if (written != frame.size || loop != AudioTrack.SUCCESS) {
            Log.w(TAG, "Static loop unsupported (written=$written loop=$loop); using stream mode")
            t.release(); false
        } else {
            t.setVolume(AudioTrack.getMaxVolume())
            t.play()
            track = t; usingStaticLoop = true; true
        }
    } catch (e: Exception) {
        Log.w(TAG, "Static AudioTrack failed", e); false
    }

    private fun startStream() {
        val minBuf = AudioTrack.getMinBufferSize(
            SonarConfig.SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT
        )
        val t = AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(format)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
            .setBufferSizeInBytes(maxOf(minBuf, frame.size * 4 * 2))
            .build()
        t.play()
        track = t; usingStaticLoop = false; streaming = true
        streamThread = Thread({
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
            while (streaming) {
                t.write(frame, 0, frame.size, AudioTrack.WRITE_BLOCKING)
            }
        }, "SonarPlayer").apply { start() }
    }

    /** Frees the speaker (used by the IMU tripwire). */
    @Synchronized
    fun stop() {
        streaming = false
        streamThread?.join(300)
        streamThread = null
        track?.let {
            try { it.pause(); it.flush(); it.stop() } catch (_: IllegalStateException) {}
            it.release()
        }
        track = null
        isPlaying = false
        Log.i(TAG, "Sonar playback stopped")
    }

    fun underrunCount(): Int = track?.underrunCount ?: 0

    companion object { private const val TAG = "AetherPlayer" }
}
