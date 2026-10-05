# AetherSense MVP

> **Omnidirectional Ultrasonic FMCW Radar, Haptic Danger Ladder & Offline Telemetry Bridge**
>
> **Target Device:** iQOO 15 (Snapdragon 8 Elite / Dimensity 9400)
>
> **Hackathon Track:** Open Innovation / Accessibility & HealthTech

[![Live Observatory](https://img.shields.io/badge/Observatory-Live%20Dashboard-00e5a0?style=for-the-badge)](https://arjitujjawal-art.github.io/aethersense-observatory/)
[![Platform](https://img.shields.io/badge/Android-14%2B%20%28API%2034%2B%29-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://android.com)
[![Offline Mode](https://img.shields.io/badge/Mode-100%25%20Offline-38bdf8?style=for-the-badge)](https://github.com)
[![Build Status](https://img.shields.io/badge/Unit%20Tests-24%2F24%20Passed-10b981?style=for-the-badge)](https://github.com)

---

## 🚀 Live Demo & Observatory Dashboard
- **Web Observatory:** [https://arjitujjawal-art.github.io/aethersense-observatory/](https://arjitujjawal-art.github.io/aethersense-observatory/)
  - Features real-time **Polar Radar Sweep (0.3 – 2.5m)**, **Correlation Oscilloscope & Waterfall (0 – 3.0m)**, **IMU Sparkline**, and **Interactive Evaluation Controls** for judges.
- **Android APK Download:** [Download `aethersense-mvp.apk`](https://arjitujjawal-art.github.io/aethersense-observatory/aethersense-mvp.apk) (2.6 MB, ready to install).

---

## 🎯 The Core Problem & Innovation
Assistive technology for the visually impaired typically forces blind users to hold up a camera. Cameras fail in dark environments, drain battery in 2–3 hours, and cannot see through pockets or clothes.

**AetherSense** turns an unmodified smartphone into an active near-ultrasonic spatial radar:
1. **FMCW Ultrasonic Radar (18.0–20.0 kHz):** Uses native `AudioTrack` and `AudioRecord UNPROCESSED` with Tukey-windowed LFM chirps (10 chirps/sec) to detect obstacles from 0.3 m to 2.5 m without any camera or cloud connection.
2. **Haptic Danger Ladder:** Maps obstacle distance to intuitive tactile feedback cadences on the phone's vibrator (Clear > Caution > Warning > Hazard).
3. **IMU Safety Tripwire:** Detects curb trips and falls ($< 0.25g$ free-fall followed by $> 3.0g$ impact shock) within $< 150\text{ ms}$, immediately silencing the ultrasound to free the speaker and sounding an emergency siren.
4. **Local Telemetry Bridge:** Broadcasts live 10 Hz JSON telemetry strictly over `ws://127.0.0.1:8080/telemetry`, completely isolated from cellular/Wi-Fi ($0.00\text{ KB/s}$ cloud traffic).

---

## 🛠️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ANDROID BACKEND (KOTLIN)                        │
│                                                                        │
│  [Chirp Generator] ──► [AudioTrack] ──► Speaker (18.0–20.0 kHz)       │
│                                              │                         │
│  [Mic Array] ──► [AudioRecord UNPROCESSED] ◄─┘ (Acoustic Echo)         │
│          │                                                             │
│          ▼                                                             │
│  [Digital Bandpass Filter (17.5–20.5 kHz)]                             │
│          │                                                             │
│          ▼                                                             │
│  [Analytic Matched Filter (IQ Envelope)]                               │
│          │                                                             │
│          ▼                                                             │
│  [Direct-Path Blanking & Sidelobe Cancellation]                        │
│          │                                                             │
│          ├──► [Range Estimator] ──► [Haptic Danger Engine (Vibrator)]  │
│          │                                                             │
│  [IMU SensorManager] ─────────────► [Impact / Drop Tripwire]           │
│          │                                     │                       │
│          └───────────────┬─────────────────────┘                       │
│                          ▼                                             │
│       [Local Telemetry Server: Java-WebSocket]                         │
│             (ws://127.0.0.1:8080/telemetry)                            │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │ USB Port Forward / Office Kit
                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│               FRONTEND: "AETHERSENSE OBSERVATORY"                      │
│                                                                        │
│  - Real-Time Polar Range Radar Sweep (0.3–2.5 m)                       │
│  - Correlation Oscilloscope & Waterfall (0.0–3.0 m)                    │
│  - IMU Dynamics & Haptic State Indicator                               │
│  - System HUD: Loop Latency (ms), Buffer Underruns, 0.00 KB/s Cloud    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📱 Quick Start

### 1. Install APK to Device
```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 2. Forward Telemetry Port
```bash
adb forward tcp:8080 tcp:8080
```

### 3. Open Observatory in Browser
Open `observatory/index.html` or visit [https://arjitujjawal-art.github.io/aethersense-observatory/](https://arjitujjawal-art.github.io/aethersense-observatory/).

---

## 🧪 Automated Unit Tests (24/24 Passed)
- `ChirpGeneratorTest` (4 tests): In-band energy > 99%, audible leakage < -80 dB, Tukey edge tapering.
- `RangingEngineTest` (10 tests): Exact 4800-sample PRI lock, 1.0 m ranging, 0.5–2.2 m sweep, blanking zone rejection, clutter detection, baseline calibration, < 1 ms DSP latency.
- `HapticLadderTest` (5 tests): PRD vibration patterns, hysteresis margins, immediate hazard escalation, impact latching.
- `ImuTripwireTest` (4 tests): Two-phase free-fall and shock trigger, shock-only rejection, window expiry rejection.
- `TelemetryPayloadTest` (1 test): Full JSON schema conformance.
