# AetherSense v3.0: Full Technical Specification & Grand Finale Blueprint

### Omnidirectional Pocket Acoustic Radar, Emergency Guard & Contactless Care Engine

> **Event:** iQOO Hackathon 2026, Grand Finale (Bengaluru, Oct 9–11)
> 
> 
> **Track:** Open Innovation / HealthTech & Accessibility
> 
> 
> **Target Device:** iQOO 15 (Snapdragon 8 Elite / Dimensity 9400)
> 
> 

---

## 1. Executive Summary & Core Thesis

Current assistive technology for the visually impaired suffers from a fundamental design flaw: **it forces a blind person to aim a camera at what they cannot see**. Camera solutions (like Bengaluru student winner *SecondSense*) fail inside pockets, become useless in complete darkness, blind the user with battery drain within 2–3 hours, and provide zero awareness of what approaches from the sides or blind angles.

**AetherSense v3.0** transforms an unmodified smartphone into a dual-mode, hands-free spatial radar and safety companion worn on a chest lanyard or shirt pocket:

1. **Active Transit Radar:** Uses near-ultrasonic FMCW acoustic chirps (18.0–20.5 kHz) to calculate obstacle distances (0.3–3.0 m) and approach speeds, enhanced with **acoustic phase acceleration** to detect sudden surges (e.g., e-bikes, lunging dogs, or sudden obstacles) in $<200\text{ ms}$.


2. **Instant Trip/Fall Protection:** Continuous sub-100 ms IMU thresholding ($<0.2g$ free-fall to $>3.0g$ impact) detects trips over curbs and drop-offs to trigger emergency sirens and distress beacons.
3. **Stationary Care & Rest Mode:** When the user sits down or rests, the system dynamically switches from collision radar to contactless respiration monitoring (0.1–0.5 Hz chest-displacement phase tracking), alerting caregivers if hyperventilation, panic, or respiratory arrest occurs.
4. **Office Kit Observatory:** Telemetry streams raw acoustic waterfalls, range-Doppler plots, and real-time respiration curves directly to a mentor/judge’s laptop using iQOO Office Kit, proving zero cloud reliance.



---

## 2. System State Machine

```
                        ┌────────────────────────────────┐
                        │        DEVICE STARTUP          │
                        │ 3s Acoustic Multipath Nulling  │
                        └───────────────┬────────────────┘
                                        │
                                        ▼
             ┌─────────────────────────────────────────────────────┐
             │            MODE A: ACTIVE TRANSIT RADAR             │
             │   - 18–20.5 kHz FMCW Chirps (Range: 0.3–3.0 m)      │
             │   - Phase Acceleration (Surge hazard <200 ms)       │
             │   - IMU Ego-Motion Subtraction                      │
             │   - BLE Passive Crowd-Density Adaptation            │
             └──────┬───────────────────────▲──────────────────────┘
                    │                       │
      Sustained Inactivity (>15s)     Step Detected
      Zero Translational Motion       Walking Resumed
                    │                       │
                    ▼                       │
             ┌──────────────────────────────┴──────────────────────┐
             │            MODE B: STATIONARY CARE & REST           │
             │   - Chirps shift to Continuous Wave (CW) Carrier    │
             │   - Sub-millimeter Phase Tracking (0.1–0.5 Hz)      │
             │   - Contactless Respiration & Panic Monitoring      │
             └──────────────────────┬──────────────────────────────┘
                                    │
                                    │
    ┌───────────────────────────────┴─────────────────────────────────┐
    │              GLOBAL INTERRUPT: CRITICAL FALL DETECTED           │
    │      IMU Trigger: <0.2g Drop + >3.0g Impact Transient (<100 ms)  │
    │      Action: Mute Chirps -> High-dB Local Alarm -> BLE SOS      │
    └─────────────────────────────────────────────────────────────────┘

```

---

## 3. Mathematical & Signal Processing Breakdown

### A. Active Transit Radar & Phase Acceleration

Standard ultrasonic echo processing relies solely on envelope cross-correlation peak-picking. While accurate for coarse distance ($3\text{--}5\text{ cm}$ resolution), it is too slow to detect dynamic velocity surges. AetherSense integrates dual-tier math adapted from wave-sensing principles:

#### 1. Coarse Ranging (Matched Filtering)

The phone transmits a windowed Linear Frequency Modulated (LFM) chirp:


$$s(t) = w(t) \cdot \cos\left(2\pi \left(f_0 t + \frac{B}{2T} t^2\right)\right)$$


Where $f_0 = 18.0\text{ kHz}$, bandwidth $B = 2.5\text{ kHz}$ ($18.0\text{--}20.5\text{ kHz}$), and duration $T = 20\text{ ms}$.

A **Tukey window** $w(t)$ with a $5\text{ ms}$ cosine taper is applied to eradicate high-frequency square transients ("acoustic clicking").

The distance $d$ is derived via normalized cross-correlation:


$$d = \frac{c \cdot \tau_{\text{peak}}}{2}, \quad c \approx 331.3 + 0.606 \times T_{\text{temp}}$$

#### 2. Fine-Grained Phase Acceleration ($\frac{d^2\phi}{dt^2}$) for Sudden Surges

Instead of waiting for multiple chirp envelopes to shift across range bins, AetherSense monitors the unwrapped carrier phase shift $\phi(t)$ of the matched filter peak:


$$\phi(t) = 2\pi \frac{2 d(t)}{\lambda}$$


Where $\lambda \approx 1.7\text{ cm}$ at $20\text{ kHz}$. A physical shift of just $4.25\text{ mm}$ causes a $90^\circ$ phase shift.

The app continuously tracks the second derivative of the phase:


$$\text{Phase Acceleration} = \alpha(t) = \frac{d^2\phi(t)}{dt^2} = \frac{4\pi}{\lambda} \cdot a_{\text{relative}}(t)$$

* **Pedestrian moving at constant speed:** $\alpha(t) \approx 0$ (velocity is steady).
* **Sudden Hazard Surge (lunging dog, e-bike accelerating, person tripping toward user):** $\alpha(t) > \text{Threshold}$. The system triggers a priority haptic buzz in **$<180\text{ ms}$**, long before the target traverses a full range bin.

### B. Dynamic Multipath Nulling (Auditorium & Hallway Calibration)

Auditoriums and indoor corridors cause severe acoustic multipath reflections off concrete floors, glass, and stages.

* **The Calibration Sequence:** At launch, the app takes a 3-second acoustic recording without active walking.


* It computes the static channel impulse response $h_{\text{static}}(r)$.
* It constructs an adaptive threshold across all range bins $r$:

$$\text{Threshold}(r) = \mu_{\text{static}}(r) + k \cdot \sigma_{\text{static}}(r)$$


* Only reflections with phase changes relative to the user's IMU ego-motion break through the threshold, neutralizing phantom echoes from fixed room fixtures.

### C. Emergency User-Fall Detection

A blind user’s greatest physical vulnerability is unlevel terrain, open drains, curbs, and stairs.

* **Detection Engine:** The 6-axis IMU reads continuous tri-axial acceleration at $200\text{ Hz}$.
* **The Physics:**

$$\Vert{}a(t)\Vert{} = \sqrt{a_x^2 + a_y^2 + a_z^2}$$


1. **Phase 1 (Free Fall):** $\Vert{}a(t)\Vert{} < 0.2g$ for a continuous duration $\Delta t \in [120\text{ ms}, 400\text{ ms}]$.
2. **Phase 2 (Hard Impact):** Rapid transition to $\Vert{}a(t)\Vert{} > 3.0g$ within $100\text{ ms}$.
3. **Phase 3 (Immobility):** Variance of acceleration $\text{Var}(\Vert{}a\Vert{}) < 0.05g$ for $>5\text{ seconds}$.


* **Immediate Response:** Mutes the ultrasonic loop to free the audio system, activates the maximum haptic pattern, sounds an 85 dB audible local alarm, and sends an emergency broadcast.

### D. Stationary Care & Rest Mode: Contactless Respiration Tracking

When the user sits down (e.g., resting on a bench, at a desk, or in bed), transit obstacle alerts are unnecessary. The IMU recognizes sustained stillness ($\text{Var}(\Vert{}a\Vert{}) \approx 0$ for $>15\text{ s}$) and pivots into **Care & Rest Mode**.

* **The Sensor Shift:** The speaker switches from chirps to a clean, single-frequency pilot tone at $20\text{ kHz}$.
* **Chest Displacement Extraction:** The user rests the phone in a shirt pocket or nearby on a desk pointed toward their chest. Chest expansion during breathing causes subtle physical displacements ($2\text{--}5\text{ mm}$).
* **Signal Demodulation:**
1. The top microphone records the reflected $20\text{ kHz}$ carrier wave.
2. The carrier is quadrature-demodulated into In-phase ($I$) and Quadrature ($Q$) components:

$$I(t) = x(t) \cos(2\pi f_0 t), \quad Q(t) = -x(t) \sin(2\pi f_0 t)$$


3. Arctangent phase unwrapping extracts chest micro-displacement:

$$\theta(t) = \text{unwrap}\left(\arctan\left(\frac{Q(t)}{I(t)}\right)\right)$$


4. The signal passes through a digital Butterworth bandpass filter **$(0.1\text{--}0.5\text{ Hz})$**, isolating the human breathing envelope ($6\text{--}30\text{ breaths per minute}$).


* **Safety Thresholds:**
* **Apnea / Fall-Asleep Check:** If respiration modulation drops below the noise floor for $>20\text{ s}$, an escalation haptic alert sounds.
* **Hyperventilation / Panic Attack:** If the respiration frequency exceeds $0.45\text{ Hz}$ ($>27\text{ BPM}$) while the IMU confirms the user is sitting still, the app speaks a grounding prompt: *"Elevated breathing detected. Sit upright and breathe slowly."*



---

## 4. Hardware Exploitation Matrix (iQOO 15 Silicon)

| Physical Subsystem | Low-Level API Used | Dedicated Function in AetherSense | Rubric Alignment |
| --- | --- | --- | --- |
| **Earpiece / Bottom Speaker**<br> | Android Oboe / AAudio (`AudioTrack` PCM 48 kHz)

 | 18.0–20.5 kHz Tukey-windowed chirp emission

 | Creative Phone Use (15%)

 |
| **Top & Bottom Mic Array**<br> | `AudioRecord` (`AudioSource.UNPROCESSED`)

 | Dual-channel echo capture, beamforming, phase extraction

 | Creative Phone Use (15%)

 |
| **Qualcomm Hexagon NPU**<br> | LiteRT (TFLite QNN Delegate / Qualcomm AI Engine)

 | 1D-CNN classification: *Wall vs. Person vs. Sudden Surge* in $<4\text{ ms}$<br> | Technical Depth (15%)

 |
| **6-Axis IMU (Acc/Gyro)**<br> | `SensorManager.SENSOR_DELAY_FASTEST` | Walking ego-motion subtraction; fall-detection tripwire ($<100\text{ ms}$)

 | Technical Depth (15%)

 |
| **Bluetooth Subsystem** | `BluetoothLeScanner` (Low Latency mode) | Real-time ambient device count for crowd-density sensitivity adjustment | Novelty & Impact (20%)

 |
| **Linear Haptic Motor**<br> | `Vibrator` (`VibrationEffect.createWaveform`)

 | Non-auditory distance/danger ladder (pulse frequency scales with threat)

 | End Product Quality (30%)

 |
| **iQOO Office Kit**<br> | Local Wi-Fi Direct / USB Protocol Bridge

 | Real-time streaming of spectrogram, Doppler, and respiration to laptop

 | Office Kit (10%)

 |

---

## 5. The "AetherSense Observatory" UI (Office Kit Bridge)

Because ultrasonic chirps, phase shifts, and haptics are invisible to an audience sitting 15 feet away, the **AetherSense Observatory** serves as the primary visual display for judges via iQOO Office Kit:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   AETHERSENSE OBSERVATORY (OFFICE KIT)                 │
├──────────────────────────────────┬─────────────────────────────────────┤
│ LIVE ACOUSTIC WATERFALL          │ TARGET RANGE-DOPPLER TRACKER        │
│ [20.5 kHz] ■■■■■■■■■■■■■■■■■■■■  │ Range: [ 1.42 m ]  Azimuth: CENTER  │
│ [19.2 kHz]   ■■■■■■■■■■■■■■      │ Rel. Velocity: -1.15 m/s (CLOSING)  │
│ [18.0 kHz]       ■■■■■■■■■■      │ Phase Accel: 1.42 rad/s² [SURGE!]   │
├──────────────────────────────────┼─────────────────────────────────────┤
│ CARE MODE: RESPIRATION MONITOR   │ HARDWARE TELEMETRY & COMPUTE HUD    │
│  /\    /\    /\    /\    /\      │ Hexagon NPU Latency: 3.2 ms         │
│ /  \  /  \  /  \  /  \  /  \     │ Audio DSP Buffer: 48 kHz / 16-bit   │
│Rate: 16 BPM [NORMAL / REST]      │ Crowd Density: 14 BLE devices/area  │
│Status: STATIONARY (IMU: 0.01g)   │ Cloud Uplink: 0.00 KB/s (OFFLINE)   │
└──────────────────────────────────┴─────────────────────────────────────┘

```

---

## 6. 90-Second Rehearsed Live Demo Script

*Setup:* Phone hung from chest lanyard, earbuds connected (or phone paired to a small speaker for the hall to hear), airplane mode ON. The laptop on the podium mirrors the *AetherSense Observatory* via Office Kit.

* **0:00 – Zero-Sight Hook:** Step to the center of the stage. "Judges, every assistive camera app forces a blind person to aim a camera at what they cannot see. AetherSense requires zero aiming. The camera is off. The screen is off. The phone is in airplane mode."


* **0:15 – Active Transit Ranging:** Walk toward a wall. The phone's haptic motor ticks faster and faster as distance decreases, and the speaker chirps directional audio. The Observatory UI plots the target line decreasing from $2.5\text{ m} \rightarrow 1.0\text{ m}$.


* **0:30 – Darkness / Pocket Test:** Cover the phone completely with a thick black cloth. Keep walking. It tracks the wall flawlessly. *"A camera is completely blind here. AetherSense does not care."*


* **0:45 – Sudden Surge Test (Phase Acceleration):** Stand still. A teammate steps forward and abruptly lunges toward you from 2 meters. Instantly ($<200\text{ ms}$), the app emits a double-pulse emergency buzz: *"Hazard surge, center!"* The Observatory screen flashes red: `PHASE ACCELERATION THRESHOLD EXCEEDED`.
* **1:05 – Fall Detection Tripwire:** Intentionally drop a dummy test rig or simulate a trip where the phone enters free fall ($<0.2g$) followed by a hard catch ($>3g$). In under 100 ms, the phone mutes the chirps and fires a high-decibel alert beacon: *"Fall impact detected. Alerting emergency contacts."*
* **1:15 – Care & Rest Mode (Respiration):** Sit on a chair. Place the phone against your chest. Within 5 seconds, the Observatory switches views. Point to the screen: a continuous sine wave traces your real-time breathing ($16\text{ BPM}$) derived purely from near-ultrasonic carrier phase reflection.
* **1:25 – The Close:** Point to the laptop HUD. "On-device Hexagon NPU: 3.2 milliseconds. Cloud traffic: zero bytes. While other solutions build apps for when a user can look at the world, AetherSense protects them when they can't."



---

## 7. Rubric Audit & Strategic Advantage vs. City Champions

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FINAL RUBRIC COVERAGE AUDIT                     │
├────────────────────────────────┬──────────┬───────────────────────────┤
│ Criterion                      │ Weight   │ How AetherSense Secures It│
├────────────────────────────────┼──────────┼───────────────────────────┤
│ End Product Quality            │ 30%      │ High: Rehearsed demo with │
│                                │          │ 3 physical fail-safes.    │
│ Novelty & Social Impact        │ 20%      │ High: Solves non-line-of- │
│                                │          │ sight accessibility gap.  │
│ Technical Depth & AI           │ 15%      │ High: Phase acceleration, │
│                                │          │ NPU 1D-CNN, breath tracking│
│ Creative Phone Use             │ 15%      │ Maximum: Earpiece, dual   │
│                                │          │ mics, IMU, haptics, BLE.  │
│ Office Kit Integration         │ 10%      │ Full: Live Observatory HUD│
│                                │          │ streaming to laptop.      │
│ Demo & Presentation            │ 10%      │ High: Multi-sensory stage │
│                                │          │ script under 90 seconds.  │
└────────────────────────────────┴──────────┴───────────────────────────┘

```

### Why This Outclasses the 24 City Winners

* **vs. SecondSense (Bengaluru Student Winner):** SecondSense won with camera CV. AetherSense wins the national stage by highlighting their fatal gap: cameras do not work in the dark, drain batteries quickly, and cannot be aimed at unseen threats.


* **vs. Origo (Pune 2nd Runner-up):** Origo tracks user walking history with dead reckoning, but cannot detect external obstacles. AetherSense detects both static and dynamically closing external threats.


* **vs. Ridezz (Hyderabad Winner):** Ridezz focuses on group biker communications. AetherSense focuses on high-stakes, solo pedestrian safety with zero external mesh dependency.


* **vs. TheraLens & Saathi (Hyderabad & Chennai Runners-up):** Both focus on post-facto logging and therapy guidance. AetherSense operates at the millisecond edge for active physical preservation.



---

## 8. Defensible Answers to Toughest Judge Questions

**Q1: "Why not use Wi-Fi signals (CSI) like RuView instead of sound waves?"**

> *"Stock Android HAL completely locks down raw subcarrier CSI and restricts Wi-Fi scans to once every 30 seconds for battery protection. Attempting Wi-Fi radar on an unrooted phone is physically impossible for collision safety. We took the strongest signal-processing principles from RuView—specifically **phase acceleration, dynamic multipath baseline nulling, and the visual observatory architecture**—and implemented them natively on the phone's high-speed acoustic transducers and Qualcomm Hexagon NPU. This keeps the system 100% phone-native with zero extra hardware to carry or buy."*
> 

**Q2: "Can people or dogs hear these chirps in the room?"**

> "We apply a Tukey cosine taper across the 18.0–20.5 kHz chirp window. This eliminates the square-wave transients that cause audible clicking. The fundamental frequency is above the human hearing cutoff for adults, and the system dynamically drops power output when the BLE density registers high ambient foot traffic."
> 
> 

**Q3: "Won't walking motion ruin your respiration tracking?"**

> *"Exactly why we don't attempt respiration while walking. The system operates on a strict state machine: respiration monitoring is strictly locked to **Care & Rest Mode**, which only activates when the IMU registers sustained zero-motion immobility ($>15\text{ s}$). When the user takes a single step, it switches back to Transit Radar instantly."*

**Q4: "Where is the AI, or is this just DSP?"**

> "DSP handles deterministic matched filtering in $<1\text{ ms}$. The local AI is a **1D-CNN running on the Qualcomm Hexagon NPU via LiteRT**. It classifies the temporal echo envelope into static barriers, soft obstacles, approaching targets, or multipath room clutter. It runs in 3.2 milliseconds with zero cloud dependency."
> 
>