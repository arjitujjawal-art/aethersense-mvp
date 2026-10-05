package com.aethersense.server

import android.util.Log
import com.aethersense.config.SonarConfig
import com.aethersense.model.TelemetryPayload
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.util.concurrent.Executors

/**
 * Loop 5 — Embedded local WebSocket telemetry bridge (PRD Feature 4).
 *
 * Binds strictly to 127.0.0.1:8080.
 * Endpoints:
 *   ws://127.0.0.1:8080/telemetry
 *
 * Incoming packets are broadcast at 10 Hz from an async single-thread executor
 * to guarantee that client network latency never blocks the audio DSP loop.
 */
class TelemetryServer(
    port: Int = SonarConfig.WS_PORT,
    host: String = SonarConfig.WS_HOST,
) : WebSocketServer(InetSocketAddress(host, port)) {

    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "TelemetryBroadcaster").apply { isDaemon = true }
    }

    @Volatile var clientCount: Int = 0
        private set

    init {
        isReuseAddr = true
        isTcpNoDelay = true
    }

    override fun onOpen(conn: WebSocket?, handshake: ClientHandshake?) {
        val path = handshake?.resourceDescriptor ?: ""
        if (path != SonarConfig.WS_PATH && path != "${SonarConfig.WS_PATH}/") {
            Log.w(TAG, "Rejected client request on unknown path: $path")
            conn?.close(1008, "Invalid path: only ${SonarConfig.WS_PATH} supported")
            return
        }
        clientCount = connections.size
        Log.i(TAG, "Observatory client connected from ${conn?.remoteSocketAddress} (total: $clientCount)")
    }

    override fun onClose(conn: WebSocket?, code: Int, reason: String?, remote: Boolean) {
        clientCount = connections.size
        Log.i(TAG, "Observatory client disconnected (code=$code reason=$reason, total: $clientCount)")
    }

    override fun onMessage(conn: WebSocket?, message: String?) {
        // Client-to-server commands (e.g. ping or calibrate) can be handled here if needed
        if (message == "ping") {
            conn?.send("pong")
        }
    }

    override fun onMessage(conn: WebSocket?, message: ByteBuffer?) {}

    override fun onError(conn: WebSocket?, ex: Exception?) {
        Log.e(TAG, "WebSocket server error on ${conn?.remoteSocketAddress}", ex)
    }

    override fun onStart() {
        Log.i(TAG, "Telemetry WebSocket server listening on ws://${address.hostString}:${port}${SonarConfig.WS_PATH}")
    }

    /** Broadcasts payload as JSON to all connected clients asynchronously. */
    fun broadcastPayload(payload: TelemetryPayload) {
        if (connections.isEmpty()) return
        val json = payload.toJson()
        executor.execute {
            try {
                broadcast(json)
            } catch (e: Exception) {
                Log.w(TAG, "Broadcast failed", e)
            }
        }
    }

    fun stopSafe() {
        try {
            executor.shutdownNow()
            stop(1000)
            Log.i(TAG, "Telemetry server stopped")
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping telemetry server", e)
        }
    }

    companion object {
        private const val TAG = "AetherServer"
    }
}
