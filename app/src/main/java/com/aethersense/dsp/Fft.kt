package com.aethersense.dsp

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Preallocated radix-2 FFT with a Hann window, used for the 17.5–20.5 kHz spectrogram. */
class Fft(val size: Int) {
    init { require(size > 0 && size and (size - 1) == 0) { "size must be a power of 2" } }

    private val re = DoubleArray(size)
    private val im = DoubleArray(size)
    private val window = DoubleArray(size) { 0.5 * (1 - cos(2 * PI * it / (size - 1))) }
    private val cosT = DoubleArray(size / 2) { cos(-2 * PI * it / size) }
    private val sinT = DoubleArray(size / 2) { sin(-2 * PI * it / size) }
    private val bits = Integer.numberOfTrailingZeros(size)

    /** Magnitude spectrum (linear) of [input][0 until size] into [mag][0 until size/2]. */
    fun magnitude(input: FloatArray, offset: Int, mag: FloatArray) {
        for (i in 0 until size) {
            val j = Integer.reverse(i) ushr (32 - bits)
            re[j] = input[offset + i] * window[i]
            im[j] = 0.0
        }
        var len = 2
        while (len <= size) {
            val half = len / 2
            val step = size / len
            var i = 0
            while (i < size) {
                for (k in 0 until half) {
                    val c = cosT[k * step]; val s = sinT[k * step]
                    val a = i + k; val b = a + half
                    val tr = re[b] * c - im[b] * s
                    val ti = re[b] * s + im[b] * c
                    re[b] = re[a] - tr; im[b] = im[a] - ti
                    re[a] += tr; im[a] += ti
                }
                i += len
            }
            len = len shl 1
        }
        val scale = 2.0 / size
        for (k in 0 until size / 2) mag[k] = (sqrt(re[k] * re[k] + im[k] * im[k]) * scale).toFloat()
    }
}
