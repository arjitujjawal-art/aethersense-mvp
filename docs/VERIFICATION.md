# AetherSense MVP — Verification & Deployment Guide

This document outlines the step-by-step instructions to run, verify, and demo the **AetherSense MVP** on an Android 14+ device (specifically optimized for iQOO 15 / Snapdragon 8 Elite) and view live telemetry on a connected laptop via the **AetherSense Observatory**.

---

## 1. Quick Start / Deployment

### Step 1: Install APK to Phone
Connect your iQOO device via USB (with **USB Debugging** enabled in Developer Options):
```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

### Step 2: Forward Telemetry Port
Set up local TCP port forwarding so your browser can connect to the phone's offline WebSocket bridge:
```powershell
adb forward tcp:8080 tcp:8080
```

### Step 3: Launch AetherSense on Phone
1. Open the **AetherSense** app on your phone.
2. Grant the **Microphone** and **Notification** permissions when prompted.
3. Tap **START AETHERSENSE**.
4. The status card will show: `STATUS: ACTIVE TRACKING`.
5. A persistent foreground notification will keep the ultrasonic sonar and IMU tripwire alive even with the **screen turned off**.

### Step 4: Open the Observatory Dashboard on Laptop
Open [`observatory/index.html`](file:///c:/Users/arjit/Desktop/iqoo12/observatory/index.html) in any web browser (Chrome, Edge, Firefox, Brave):
* The status banner in the top right will turn green: `CONNECTED (127.0.0.1:8080)`.
* Real-time polar radar sweep, correlation oscilloscope, IMU sparkline, and HUD metrics will stream live at **10 Hz**.
* To test or demo without a connected phone, open:
  ```
  observatory/index.html?demo=1
  ```

---

## 2. Verification Gates & Acceptance Criteria

### Gate 1: Chirp Synthesizer & AudioTrack Player
* **Criteria:** Clean 18.0–20.0 kHz LFM chirp, Tukey windowed, zero audible pops or clicks.
* **Automated Unit Test:** `ChirpGeneratorTest` passes (in-band energy > 99%, audible leakage < -80 dB).
* **Physical Device Test:**
  1. With Sonar active, listen closely to the phone speaker in a quiet room.
  2. Verify there are **no audible clicks or buzzing**.
  3. Optional: Use a laptop spectrum analyzer (e.g. Audacity / Spectroid) to verify the 18–20 kHz transmission band.

### Gate 2: Unprocessed Mic Capture & Matched Filter
* **Criteria:** Microphone captures raw audio via `AudioSource.UNPROCESSED` without AEC/AGC distortion; correlation peaks occur at consistent 100 ms intervals.
* **Automated Unit Test:** `RangingEngineTest.gate2_directPathPeaksSpacedByPri` passes with exact 4800-sample spacing.
* **Physical Device Test:**
  Check logcat:
  ```powershell
  adb logcat -s SonarService SonarRecorder AetherPlayer
  ```
  Confirm `Recording via UNPROCESSED` (or fallback) and `underruns: 0`.

### Gate 3: Direct-Path Blanking & Acoustic Ranging (0.3 – 2.5 m)
* **Criteria:** Direct speaker-to-mic chassis crosstalk is blanked; obstacles are accurately extracted with PSR $\ge 4.5$.
* **Automated Unit Test:**
  * `RangingEngineTest.gate3_rangeAtOneMetre` passes (0.98 m – 1.02 m).
  * `RangingEngineTest.acceptance_sweep_05_to_18m` passes across 0.5m, 0.75m, 1.0m, 1.25m, 1.5m, 1.8m, and 2.2m.
* **Physical Device Test:**
  1. Hold a flat surface (book, clipboard, laptop lid) 1.0 m in front of the phone.
  2. Observe the Observatory polar radar and HUD: distance reads between **0.90 m and 1.15 m**.
  3. Move the object closer (0.5 m): radar marker animates inward and turns red.

### Gate 4: Haptic Danger Ladder & IMU Safety Engine
* **Criteria:**
  * `> 2.0 m`: CLEAR (No vibration)
  * `1.2 – 2.0 m`: CAUTION (Slow pulse: 50 ms ON, 400 ms OFF)
  * `0.7 – 1.2 m`: WARNING (Medium pulse: 70 ms ON, 200 ms OFF)
  * `< 0.7 m`: HAZARD (Rapid pulse: 100 ms ON, 80 ms OFF)
  * Free-fall ($< 2.5\text{ m/s}^2$ for $\ge 120\text{ ms}$) + shock ($> 30\text{ m/s}^2$) triggers emergency state within $< 150\text{ ms}$.
* **Automated Unit Tests:**
  * `HapticLadderTest` passes all cadence patterns, hysteresis margins, and immediate escalation checks.
  * `ImuTripwireTest` passes full drop sequence, and rejects shock-only or brief free-fall motions.
* **Physical Device Test:**
  1. Move a barrier toward the phone: feel tactile vibration cadence accelerate from slow to rapid.
  2. Simulate a drop motion onto a soft surface (e.g. pillow / sofa):
     - The siren immediately sounds.
     - The phone vibrates with continuous emergency pulse.
     - The ultrasound chirp loop is suspended to free the speaker.
     - The Observatory dashboard flashes red with `IMPACT SHOCK DETECTED`.
  3. Tap **DISMISS IMPACT ALERT** on the phone or in the notification to resume tracking.

### Gate 5: Local WebSocket Telemetry Bridge
* **Criteria:** Streams JSON packets at 10 Hz with zero packet loss to `localhost:8080/telemetry`.
* **Automated Unit Test:** `TelemetryPayloadTest.jsonMatchesPrdFeature4Spec` verifies exact key/type schema conformance.
* **Physical Test:**
  Verify with PowerShell or `wscat`:
  ```powershell
  # Using curl / websocat or browser
  curl http://localhost:8080/  # Returns 404/rejection
  # Open observatory/index.html to see live 10 Hz packet reception
  ```

### Gate 6: The "Observatory" Frontend Dashboard
* **Criteria:** 60 FPS Canvas rendering, polar radar sweep with distance rings, correlation oscilloscope with shaded blanking zone, range-time waterfall, IMU sparkline.
* **Evaluation:** Open `observatory/index.html` on a laptop connected via port forwarding or in `?demo=1` mode. The FPS counter in the top-right displays $\ge 30\text{ FPS}$ continuously.
