package com.aethersense.audio

/**
 * Lock-free single-producer / single-consumer float ring buffer addressed by an
 * absolute, monotonically increasing sample index. This lets the DSP thread request
 * "samples [start, start+len)" in absolute capture time, which is how frames stay
 * phase-locked to the hardware-looped chirp.
 */
class RingBuffer(val capacity: Int) {
    private val data = FloatArray(capacity)

    /** Absolute index of the next sample to be written. */
    @Volatile var writeIndex: Long = 0L
        private set

    fun write(src: FloatArray, len: Int) {
        var w = writeIndex
        for (i in 0 until len) {
            data[(w % capacity).toInt()] = src[i]
            w++
        }
        writeIndex = w // publish after data is in place
    }

    fun oldestAvailable(): Long = maxOf(0L, writeIndex - capacity)

    /**
     * Copies [len] samples starting at absolute index [start] into [dst].
     * @return false if the range is not yet written or has already been overwritten.
     */
    fun read(start: Long, dst: FloatArray, len: Int): Boolean {
        val end = start + len
        if (end > writeIndex || start < oldestAvailable()) return false
        for (i in 0 until len) dst[i] = data[((start + i) % capacity).toInt()]
        // Re-check that the producer did not lap us while copying.
        return start >= writeIndex - capacity
    }

    fun fillPercent(readCursor: Long): Float =
        ((writeIndex - readCursor).coerceIn(0, capacity.toLong()) * 100f / capacity)
}
