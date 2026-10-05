package com.aethersense.audio

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Process
import android.util.Log
import com.aethersense.config.SonarConfig
import com.aethersense.dsp.BandpassFilter

/**
 * Loop 2 — Raw microphone capture.
 *
 * Opens AudioRecord with AudioSource.UNPROCESSED (no AEC/AGC/NS) when the HAL supports it,
 * falling back to VOICE_RECOGNITION and then MIC. Each 2048-sample read is converted to float,
 * band-passed (17.5–20.5 kHz) and appended to the absolute-indexed [ring].
 */
class SonarRecorder(private val context: Context, val ring: RingBuffer) {

    @Volatile private var running = false
    private var thread: Thread? = null
    private var record: AudioRecord? = null
    private val bpf = BandpassFilter()

    var sourceName: String = "NONE"
        private set
    @Volatile var clippedSamples: Long = 0
        private set
    @Volatile var lastReadNanos: Long = 0
        private set

    @SuppressLint("MissingPermission") // RECORD_AUDIO is checked by MainActivity before the service starts.
    fun start() {
        if (running) return
        val am = context.getSystemService(AudioManager::class.java)
        val unprocessedSupported =
            am.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true"

        val candidates = buildList {
            if (unprocessedSupported) add(MediaRecorder.AudioSource.UNPROCESSED to "UNPROCESSED")
            add(MediaRecorder.AudioSource.VOICE_RECOGNITION to "VOICE_RECOGNITION")
            add(MediaRecorder.AudioSource.MIC to "MIC")
        }

        val minBuf = AudioRecord.getMinBufferSize(
            SonarConfig.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        )
        val bufBytes = maxOf(minBuf, SonarConfig.RECORD_READ_SIZE * 2 * 4)

        for ((src, name) in candidates) {
            val r = try {
                AudioRecord.Builder()
                    .setAudioSource(src)
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setSampleRate(SonarConfig.SAMPLE_RATE)
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                            .build()
                    )
                    .setBufferSizeInBytes(bufBytes)
                    .build()
            } catch (e: Exception) { Log.w(TAG, "Source $name failed", e); null }
            if (r != null && r.state == AudioRecord.STATE_INITIALIZED) {
                record = r; sourceName = name; break
            }
            r?.release()
        }
        val r = record ?: error("No usable AudioRecord source")
        disableEffects(r.audioSessionId)
        Log.i(TAG, "Recording via $sourceName (unprocessedSupported=$unprocessedSupported, buf=$bufBytes)")

        running = true
        r.startRecording()
        thread = Thread(::loop, "SonarRecorder").apply { start() }
    }

    private fun disableEffects(session: Int) {
        if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(session)?.apply { enabled = false; release() }
        if (AutomaticGainControl.isAvailable()) AutomaticGainControl.create(session)?.apply { enabled = false; release() }
        if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(session)?.apply { enabled = false; release() }
    }

    private fun loop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val pcm = ShortArray(SonarConfig.RECORD_READ_SIZE)
        val f = FloatArray(SonarConfig.RECORD_READ_SIZE)
        val r = record ?: return
        while (running) {
            val n = r.read(pcm, 0, pcm.size, AudioRecord.READ_BLOCKING)
            if (n <= 0) { if (n < 0) Log.e(TAG, "read error $n"); continue }
            var clips = 0
            for (i in 0 until n) {
                val v = pcm[i] / 32768f
                if (v > SonarConfig.CLIP_LEVEL || v < -SonarConfig.CLIP_LEVEL) clips++
                f[i] = v
            }
            clippedSamples += clips
            bpf.process(f, n)
            ring.write(f, n)
            lastReadNanos = System.nanoTime()
        }
    }

    fun stop() {
        running = false
        thread?.join(500)
        thread = null
        record?.let { try { it.stop() } catch (_: IllegalStateException) {}; it.release() }
        record = null
    }

    companion object { private const val TAG = "AetherRecorder" }
}
