package com.aethersense

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.TextView
import com.aethersense.service.SonarService

class MainActivity : Activity() {

    private lateinit var tvStatus: TextView
    private lateinit var tvDistance: TextView
    private lateinit var tvThreat: TextView
    private lateinit var tvImu: TextView
    private lateinit var tvBridge: TextView
    private lateinit var btnToggle: Button
    private lateinit var btnDismissImpact: Button

    private var sonarService: SonarService? = null
    private var isServiceBound = false

    private val serviceConn = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as SonarService.LocalBinder
            sonarService = binder.service
            isServiceBound = true
            updateUi()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            sonarService = null
            isServiceBound = false
            updateUi()
        }
    }

    private val uiHandler = Handler(Looper.getMainLooper())
    private val pollRunnable = object : Runnable {
        override fun run() {
            updateUi()
            uiHandler.postDelayed(this, 200)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvStatus = findViewById(R.id.tvStatus)
        tvDistance = findViewById(R.id.tvDistance)
        tvThreat = findViewById(R.id.tvThreat)
        tvImu = findViewById(R.id.tvImu)
        tvBridge = findViewById(R.id.tvBridge)
        btnToggle = findViewById(R.id.btnToggle)
        btnDismissImpact = findViewById(R.id.btnDismissImpact)

        btnToggle.setOnClickListener {
            if (isServiceBound) {
                stopSonarService()
            } else {
                checkPermissionsAndStart()
            }
        }

        btnDismissImpact.setOnClickListener {
            sonarService?.dismissImpactAlert()
            updateUi()
        }

        requestBatteryOptimizationExemption()
    }

    override fun onStart() {
        super.onStart()
        bindService(Intent(this, SonarService::class.java), serviceConn, Context.BIND_AUTO_CREATE)
        uiHandler.post(pollRunnable)
    }

    override fun onStop() {
        uiHandler.removeCallbacks(pollRunnable)
        if (isServiceBound) {
            unbindService(serviceConn)
            isServiceBound = false
        }
        super.onStop()
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
    }

    private fun stopSonarService() {
        val intent = Intent(this, SonarService::class.java)
        if (isServiceBound) {
            unbindService(serviceConn)
            isServiceBound = false
        }
        stopService(intent)
        sonarService = null
        updateUi()
    }

    private fun updateUi() {
        val s = sonarService
        if (s == null) {
            tvStatus.text = "STATUS: STANDBY"
            tvStatus.setTextColor(0xFF38BDF8.toInt())
            tvDistance.text = "RANGE: -- m"
            tvThreat.text = "THREAT: CLEAR"
            tvThreat.setTextColor(0xFF10B981.toInt())
            btnToggle.text = "START AETHERSENSE"
            btnToggle.backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF00E5A0.toInt())
            btnDismissImpact.visibility = View.GONE
            return
        }

        btnToggle.text = "STOP AETHERSENSE"
        btnToggle.backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF64748B.toInt())

        if (s.isImpactAlert) {
            tvStatus.text = "STATUS: EMERGENCY IMPACT ALERT!"
            tvStatus.setTextColor(0xFFEF4444.toInt())
            btnDismissImpact.visibility = View.VISIBLE
        } else {
            btnDismissImpact.visibility = View.GONE
            tvStatus.text = "STATUS: ACTIVE TRACKING"
            tvStatus.setTextColor(0xFF00E5A0.toInt())
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

    companion object {
        private const val REQ_PERMISSIONS = 2001
    }
}
