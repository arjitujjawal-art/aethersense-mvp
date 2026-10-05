package com.aethersense

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView
import com.aethersense.service.SonarService

class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var tvAppTitle: TextView
    private lateinit var btnServiceToggle: TextView

    private var sonarService: SonarService? = null
    private var isServiceBound = false

    private val serviceConn = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as SonarService.LocalBinder
            sonarService = binder.service
            isServiceBound = true
            updateServiceStatusUi()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            sonarService = null
            isServiceBound = false
            updateServiceStatusUi()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvAppTitle = findViewById(R.id.tvAppTitle)
        btnServiceToggle = findViewById(R.id.btnServiceToggle)
        webView = findViewById(R.id.webView)

        setupWebView()

        btnServiceToggle.setOnClickListener {
            if (isServiceBound) {
                stopSonarService()
            } else {
                checkPermissionsAndStart()
            }
        }

        requestBatteryOptimizationExemption()
        checkPermissionsAndStart()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_NO_CACHE
        }

        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()

        // Inject Native Android Bridge to JavaScript
        webView.addJavascriptInterface(AndroidNativeBridge(), "AndroidBridge")

        // Load the embedded Minimalist Monochrome Observatory
        webView.loadUrl("file:///android_asset/observatory/index.html")
    }

    override fun onStart() {
        super.onStart()
        bindService(Intent(this, SonarService::class.java), serviceConn, Context.BIND_AUTO_CREATE)
    }

    override fun onStop() {
        if (isServiceBound) {
            unbindService(serviceConn)
            isServiceBound = false
        }
        super.onStop()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private fun checkPermissionsAndStart() {
        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val missing = permissions.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            requestPermissions(missing.toTypedArray(), REQ_PERMISSIONS)
        } else {
            startSonarService()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (requestCode == REQ_PERMISSIONS && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
            startSonarService()
        }
    }

    private fun startSonarService() {
        val intent = Intent(this, SonarService::class.java)
        startForegroundService(intent)
        bindService(intent, serviceConn, Context.BIND_AUTO_CREATE)
        updateServiceStatusUi()
    }

    private fun stopSonarService() {
        val intent = Intent(this, SonarService::class.java)
        if (isServiceBound) {
            unbindService(serviceConn)
            isServiceBound = false
        }
        stopService(intent)
        sonarService = null
        updateServiceStatusUi()
    }

    private fun updateServiceStatusUi() {
        if (isServiceBound) {
            tvAppTitle.text = "AETHERSENSE v3.0 // iQOO 15 HARDWARE ACTIVE"
            btnServiceToggle.text = "STOP SONAR"
            btnServiceToggle.setBackgroundColor(0xFFFFFFFF.toInt())
            btnServiceToggle.setTextColor(0xFF000000.toInt())
        } else {
            tvAppTitle.text = "AETHERSENSE v3.0 // STANDBY (TAP TO START)"
            btnServiceToggle.text = "START SONAR"
            btnServiceToggle.setBackgroundColor(0xFF000000.toInt())
            btnServiceToggle.setTextColor(0xFFFFFFFF.toInt())
        }
    }

    private fun requestBatteryOptimizationExemption() {
        val pm = getSystemService(PowerManager::class.java)
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            } catch (_: Exception) {}
        }
    }

    inner class AndroidNativeBridge {
        @JavascriptInterface
        fun isNativeAndroid(): Boolean = true

        @JavascriptInterface
        fun isServiceRunning(): Boolean = isServiceBound

        @JavascriptInterface
        fun toggleSonar() {
            runOnUiThread {
                if (isServiceBound) {
                    stopSonarService()
                } else {
                    checkPermissionsAndStart()
                }
            }
        }

        @JavascriptInterface
        fun dismissEmergencyAlert() {
            runOnUiThread {
                sonarService?.dismissImpactAlert()
            }
        }
    }

    companion object {
        private const val REQ_PERMISSIONS = 2001
    }
}
