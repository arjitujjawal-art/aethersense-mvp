// AetherSense Observatory // Minimalist Monochrome Telemetry Engine & Grand Finale Simulator v3.0
(function() {
  'use strict';

  // Config & State
  const params = new URLSearchParams(window.location.search);
  const wsUrl = params.get('ws') || 'ws://127.0.0.1:8080/telemetry';

  let ws = null;
  let isSimulating = false;
  let simInterval = null;

  // Operating Modes: 'TRANSIT' (Mode A) | 'CARE' (Mode B) | 'IMPACT'
  let systemMode = 'TRANSIT';

  // Telemetry Frame State
  let latestFrame = null;
  let frameCount = 0;
  let fps = 60;
  let lastFpsTime = performance.now();

  // History Buffers
  const IMU_HISTORY_LEN = 100;
  const imuHistory = new Array(IMU_HISTORY_LEN).fill(9.81);
  const WATERFALL_ROWS = 60;
  const waterfallBuffer = [];

  // Respiration History Buffer (Care Mode)
  const RESP_HISTORY_LEN = 160;
  const respHistory = new Array(RESP_HISTORY_LEN).fill(0);
  let respPhase = 0;
  let respBpm = 16;
  let respDisplacementMm = 3.4;

  // Web Audio Context for Acoustic Chirp Synthesizer Demonstration
  let audioCtx = null;
  let isAudioEnabled = false;
  let chirpAudioTimer = null;

  // DOM Elements - General & Status
  const elConnBadge = document.getElementById('conn-badge');
  const elFpsMeter = document.getElementById('fps-meter');
  const elTargetReadout = document.getElementById('target-readout');
  const elHudStatus = document.getElementById('hud-status');
  const elHudConn = document.getElementById('hud-conn');
  const elHudLatency = document.getElementById('hud-latency');
  const elHudPsr = document.getElementById('hud-psr');
  const elHudBuffer = document.getElementById('hud-buffer');
  const elHudPhaseAccel = document.getElementById('hud-phase-accel');
  const elHapticLevel = document.getElementById('haptic-level');
  const elHapticDesc = document.getElementById('haptic-desc');
  const elAccelVal = document.getElementById('accel-val');
  const elTripwireBadge = document.getElementById('tripwire-badge');
  const elImpactOverlay = document.getElementById('impact-overlay');
  const elImpactStats = document.getElementById('impact-stats');

  // DOM Elements - AI Classifier
  const elAiClassName = document.getElementById('ai-class-name');
  const elAiConfidence = document.getElementById('ai-confidence');
  const barHuman = document.getElementById('bar-human');
  const barWall = document.getElementById('bar-wall');
  const barSurge = document.getElementById('bar-surge');
  const barDrop = document.getElementById('bar-drop');
  const barClutter = document.getElementById('bar-clutter');
  const pctHuman = document.getElementById('pct-human');
  const pctWall = document.getElementById('pct-wall');
  const pctSurge = document.getElementById('pct-surge');
  const pctDrop = document.getElementById('pct-drop');
  const pctClutter = document.getElementById('pct-clutter');

  // DOM Elements - Care & Rest Mode
  const elCareModeBadge = document.getElementById('care-mode-badge');
  const elRespRateVal = document.getElementById('resp-rate-val');
  const elRespStatusText = document.getElementById('resp-status-text');
  const elRespDispVal = document.getElementById('resp-disp-val');
  const elRespGuardVal = document.getElementById('resp-guard-val');

  // DOM Elements - Toolbar & Buttons
  const btnSimToggle = document.getElementById('btn-sim-toggle');
  const btnSwitchTransit = document.getElementById('btn-switch-transit');
  const btnSwitchCare = document.getElementById('btn-switch-care');
  const btnTestSurge = document.getElementById('btn-test-surge');
  const btnTestApproach = document.getElementById('btn-test-approach');
  const btnTestImpact = document.getElementById('btn-test-impact');
  const btnTestClutter = document.getElementById('btn-test-clutter');
  const btnAudioToggle = document.getElementById('btn-audio-toggle');
  const btnDismissOverlay = document.getElementById('btn-dismiss-overlay');

  const ladderSteps = {
    CLEAR: document.getElementById('step-clear'),
    CAUTION: document.getElementById('step-caution'),
    WARNING: document.getElementById('step-warning'),
    HAZARD: document.getElementById('step-hazard')
  };

  // Canvases
  const radarCanvas = document.getElementById('radarCanvas');
  const radarCtx = radarCanvas.getContext('2d');
  const scopeCanvas = document.getElementById('scopeCanvas');
  const scopeCtx = scopeCanvas.getContext('2d');
  const waterfallCanvas = document.getElementById('waterfallCanvas');
  const waterfallCtx = waterfallCanvas.getContext('2d');
  const slamCanvas = document.getElementById('slamCanvas');
  const slamCtx = slamCanvas ? slamCanvas.getContext('2d') : null;
  const imuCanvas = document.getElementById('imuSparkline');
  const imuCtx = imuCanvas.getContext('2d');
  const respirationCanvas = document.getElementById('respirationCanvas');
  const respCtx = respirationCanvas.getContext('2d');

  // ---------------------------------------------------- Canvas Resizing
  function resizeCanvases() {
    [radarCanvas, scopeCanvas, waterfallCanvas, slamCanvas, imuCanvas, respirationCanvas].forEach(c => {
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
    });
  }
  window.addEventListener('resize', resizeCanvases);
  resizeCanvases();

  // ---------------------------------------------------- Reference Photo Controls & Lightbox
  const btnTogglePhotoMode = document.getElementById('btn-toggle-photo-mode');
  const refRoomImg = document.getElementById('ref-room-img');
  const btnOpenLightbox = document.getElementById('btn-open-lightbox');
  const refPhotoFrame = document.getElementById('ref-photo-frame');
  const photoLightbox = document.getElementById('photo-lightbox');
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');

  if (btnTogglePhotoMode && refRoomImg) {
    btnTogglePhotoMode.addEventListener('click', () => {
      refRoomImg.classList.toggle('color-mode');
      const isColor = refRoomImg.classList.contains('color-mode');
      btnTogglePhotoMode.textContent = isColor ? 'PHOTO: NATURAL COLOR' : 'PHOTO: MONOCHROME';
    });
  }

  function openLightbox() {
    if (photoLightbox) photoLightbox.classList.remove('hidden');
  }
  function closeLightbox() {
    if (photoLightbox) photoLightbox.classList.add('hidden');
  }

  if (btnOpenLightbox) btnOpenLightbox.addEventListener('click', openLightbox);
  if (refPhotoFrame) refPhotoFrame.addEventListener('click', openLightbox);
  if (btnCloseLightbox) btnCloseLightbox.addEventListener('click', closeLightbox);
  if (photoLightbox) {
    photoLightbox.addEventListener('click', (e) => {
      if (e.target === photoLightbox) closeLightbox();
    });
  }

  // ---------------------------------------------------- Perspective View Tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.dashboard-grid .panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;

      panels.forEach(panel => {
        if (filter === 'all') {
          panel.style.display = 'flex';
          panel.style.opacity = '1';
        } else if (filter === 'transit') {
          const isTransit = panel.id === 'panel-slam' || panel.id === 'panel-waterfall' || panel.id === 'panel-radar' || panel.id === 'panel-scope' || panel.id === 'panel-haptic' || panel.id === 'panel-hud';
          panel.style.display = isTransit ? 'flex' : 'none';
        } else if (filter === 'care') {
          const isCare = panel.id === 'panel-care' || panel.id === 'panel-hud' || panel.id === 'panel-haptic';
          panel.style.display = isCare ? 'flex' : 'none';
        } else if (filter === 'ai') {
          const isAi = panel.id === 'panel-ai' || panel.id === 'panel-slam' || panel.id === 'panel-radar' || panel.id === 'panel-hud';
          panel.style.display = isAi ? 'flex' : 'none';
        } else if (filter === 'rf') {
          const isRf = panel.id === 'panel-rf' || panel.id === 'panel-hud';
          panel.style.display = isRf ? 'flex' : 'none';
        }
      });
      resizeCanvases();
    });
  });

  // ---------------------------------------------------- Web Audio Synth (Audible Demo)
  function initAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playAcousticChirp(dist) {
    if (!isAudioEnabled || !audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      // Transpose from 18-20.5 kHz down to human-audible 1.8-2.2 kHz for audio demo
      const baseFreq = 1800 + Math.max(0, (2.5 - dist)) * 250;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.linearRampToValueAtTime(baseFreq + 350, now + 0.02);

      // Window envelope (Tukey cosine taper)
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.005);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.02);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.025);
    } catch(e) {
      console.warn('Audio synth error', e);
    }
  }

  btnAudioToggle.addEventListener('click', () => {
    initAudio();
    isAudioEnabled = !isAudioEnabled;
    if (isAudioEnabled) {
      btnAudioToggle.textContent = '🔊 AUDIBLE CHIRP SYNTH: ACTIVE';
      btnAudioToggle.classList.remove('muted');
    } else {
      btnAudioToggle.textContent = '🔊 AUDIBLE CHIRP SYNTH: OFF';
      btnAudioToggle.classList.add('muted');
    }
  });

  // ---------------------------------------------------- Simulation State Engine
  let simTargetDist = 1.45;
  let simDistDir = -0.012;
  let simIsCluttered = false;
  let simImpactTriggered = false;
  let simIsSurging = false;
  let simPhaseAccel = 0.08;

  function startSimulator() {
    if (isSimulating) return;
    isSimulating = true;
    if (ws) { try { ws.close(); } catch(_) {} ws = null; }

    btnSimToggle.textContent = 'MODE: INTERACTIVE SIM (ACTIVE)';
    btnSimToggle.classList.add('active');
    elConnBadge.textContent = 'SIMULATOR ACTIVE';
    elConnBadge.className = 'badge badge-connected';
    elHudConn.textContent = 'VIRTUAL TELEMETRY GENERATOR';

    simInterval = setInterval(stepSimulation, 100);
  }

  function stopSimulator() {
    isSimulating = false;
    if (simInterval) clearInterval(simInterval);
    simInterval = null;
    btnSimToggle.textContent = 'MODE: LIVE HARDWARE BRIDGE';
    btnSimToggle.classList.remove('active');
    connectWs();
  }

  function stepSimulation() {
    if (simImpactTriggered) return;

    // Transit Radar Simulation
    if (systemMode === 'TRANSIT') {
      if (simIsSurging) {
        simTargetDist -= 0.08;
        simPhaseAccel = 2.45 + (Math.random() - 0.5) * 0.3;
        if (simTargetDist < 0.42) {
          simIsSurging = false;
          simDistDir = 0.018;
        }
      } else {
        simTargetDist += simDistDir;
        simPhaseAccel = 0.08 + (Math.random() - 0.5) * 0.06;
        if (simTargetDist < 0.45) { simDistDir = 0.015; }
        else if (simTargetDist > 2.4) { simDistDir = -0.015; }
      }

      const detected = simTargetDist < 2.2;
      const isSurgeHazard = simPhaseAccel > 1.8;
      const threat = isSurgeHazard ? 'HAZARD' : (simIsCluttered ? 'UNCERTAIN' :
        (!detected ? 'CLEAR' : (simTargetDist < 0.7 ? 'HAZARD' : (simTargetDist < 1.2 ? 'WARNING' : 'CAUTION'))));

      // 100-point physical environmental correlation curve across 0.0 to 3.0 m
      // Multi-reflection acoustic modeling directly matching the living room photograph:
      const coffeeTableDist = 1.10; // Center coffee table specular reflection
      const chairDist = 1.40;       // Leather lounge armchair left reflection
      const sofaDist = 1.70;        // Contemporary fabric sofa right flank reflection
      const rearWallDist = 2.50;    // Rear wooden credenza & structural wall boundary

      const curve = new Array(100).fill(0).map((_, i) => {
        const binDist = (i / 100) * 3.0;
        let v = Math.random() * 0.035; // Natural acoustic speckle noise floor

        if (binDist < 0.3) {
          return 0.0; // Direct-path microphone blanking zone (0 to 0.3m)
        }

        // 1. Center Coffee Table Specular Peak at 1.10m
        v += 0.58 * Math.exp(-Math.pow((binDist - coffeeTableDist) / 0.06, 2));

        // 2. Leather Lounge Armchair at 1.40m
        v += 0.42 * Math.exp(-Math.pow((binDist - chairDist) / 0.07, 2));

        // 3. Contemporary Fabric Sofa at 1.70m
        v += 0.48 * Math.exp(-Math.pow((binDist - sofaDist) / 0.08, 2));

        // 4. Rear Wooden Credenza & Wall Boundary at 2.50m
        v += 0.76 * Math.exp(-Math.pow((binDist - rearWallDist) / 0.08, 2));

        // 5. Dynamic Moving Obstacle (approaching / surging target)
        if (detected) {
          v = Math.max(v, 0.96 * Math.exp(-Math.pow((binDist - simTargetDist) / 0.06, 2)));
        }

        // 6. Room Multipath / Doorway Reverberation (if clutter mode toggled)
        if (simIsCluttered) {
          v = Math.max(v, 0.65 * Math.exp(-Math.pow((binDist - 2.05) / 0.08, 2)));
          v = Math.max(v, 0.52 * Math.exp(-Math.pow((binDist - 2.70) / 0.09, 2)));
        }

        return Math.min(1.0, v);
      });

      // Periodic chirp sound trigger
      if (Math.random() < 0.4) {
        playAcousticChirp(simTargetDist);
      }

      const frame = {
        timestamp: Date.now(),
        mode: 'TRANSIT',
        status: isSurgeHazard ? 'SURGE_HAZARD' : (simIsCluttered ? 'UNCERTAIN' : (detected ? 'TRACKING' : 'SEARCHING')),
        target: {
          detected: detected,
          distance_m: detected ? simTargetDist : -1,
          confidence_psr: detected ? 6.8 + Math.random() * 1.2 : 2.1,
          threat_level: threat,
          velocity_mps: (simDistDir * 10) - (simIsSurging ? 1.4 : 0),
          phase_accel_rad_s2: simPhaseAccel
        },
        imu: {
          acc_magnitude: 9.81 + (Math.random() - 0.5) * 0.35,
          is_impact: false
        },
        telemetry: {
          dsp_latency_ms: 12.8 + Math.random() * 1.2,
          npu_latency_ms: 3.2,
          audio_sample_rate: 48000,
          cloud_bytes_sec: 0,
          audio_source: 'UNPROCESSED',
          underruns: 0
        },
        dsp: {
          correlation_curve: curve
        }
      };

      onFrameReceived(frame);

    } else if (systemMode === 'CARE') {
      // Care & Rest Mode: Contactless Respiration simulation
      respPhase += (respBpm / 60) * (Math.PI * 2) * 0.1;
      const breathingWave = Math.sin(respPhase) * (respDisplacementMm * 0.4) + (Math.sin(respPhase * 2.3) * 0.15);
      respHistory.push(breathingWave);
      if (respHistory.length > RESP_HISTORY_LEN) respHistory.shift();

      const frame = {
        timestamp: Date.now(),
        mode: 'CARE',
        status: 'CARE_MONITORING',
        target: {
          detected: false,
          distance_m: 0.45,
          confidence_psr: 9.2,
          threat_level: 'CLEAR',
          velocity_mps: 0,
          phase_accel_rad_s2: 0.02
        },
        respiration: {
          bpm: respBpm,
          displacement_mm: respDisplacementMm + (Math.random() - 0.5) * 0.2,
          status: 'NORMAL'
        },
        imu: {
          acc_magnitude: 9.81 + (Math.random() - 0.5) * 0.04, // Stillness
          is_impact: false
        },
        telemetry: {
          dsp_latency_ms: 8.4,
          npu_latency_ms: 3.2,
          audio_sample_rate: 48000,
          cloud_bytes_sec: 0,
          audio_source: 'CW_20KHZ_PILOT',
          underruns: 0
        },
        dsp: {
          correlation_curve: new Array(100).fill(0).map((_, i) => Math.max(0, Math.sin(i * 0.08) * 0.12))
        }
      };

      onFrameReceived(frame);
    }
  }

  // ---------------------------------------------------- WebSocket Bridge
  let wsTimeout = null;

  function connectWs() {
    elConnBadge.textContent = 'CONNECTING TO PHONE (127.0.0.1:8080)...';
    elConnBadge.className = 'badge badge-disconnected';
    elHudConn.textContent = '127.0.0.1:8080 (OFFLINE BRIDGE)';

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      fallbackToSim();
      return;
    }

    wsTimeout = setTimeout(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log('No phone connected on ws://127.0.0.1:8080. Running Interactive Simulator.');
        startSimulator();
      }
    }, 1500);

    ws.onopen = () => {
      clearTimeout(wsTimeout);
      isSimulating = false;
      elConnBadge.textContent = 'LIVE PHONE CONNECTED';
      elConnBadge.className = 'badge badge-connected';
      btnSimToggle.textContent = 'MODE: LIVE HARDWARE BRIDGE';
      btnSimToggle.classList.remove('active');
    };

    ws.onclose = () => { if (!isSimulating) fallbackToSim(); };
    ws.onerror = () => { if (!isSimulating) fallbackToSim(); };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onFrameReceived(data);
      } catch (e) {
        console.error('Failed to parse frame JSON', e);
      }
    };
  }

  function fallbackToSim() {
    clearTimeout(wsTimeout);
    startSimulator();
  }

  function onFrameReceived(frame) {
    latestFrame = frame;

    // Push IMU history
    if (frame.imu && typeof frame.imu.acc_magnitude === 'number') {
      imuHistory.push(frame.imu.acc_magnitude);
      if (imuHistory.length > IMU_HISTORY_LEN) imuHistory.shift();
    }

    // Push waterfall history
    if (frame.dsp && frame.dsp.correlation_curve) {
      waterfallBuffer.unshift([...frame.dsp.correlation_curve]);
      if (waterfallBuffer.length > WATERFALL_ROWS) waterfallBuffer.pop();
    }

    updateHud(frame);
    updateAiClassification(frame);
  }

  // ---------------------------------------------------- HUD & Classification Updates
  function updateHud(f) {
    if (!f) return;

    elHudStatus.textContent = f.status || 'ACTIVE';

    if (f.telemetry) {
      elHudLatency.textContent = `${f.telemetry.dsp_latency_ms.toFixed(1)} ms`;
      elHudBuffer.textContent = `${f.telemetry.underruns} UNDERRUNS`;
    }

    if (f.target) {
      elHudPsr.textContent = f.target.confidence_psr > 0 ? f.target.confidence_psr.toFixed(1) : '--';
      if (typeof f.target.phase_accel_rad_s2 === 'number') {
        const pa = f.target.phase_accel_rad_s2;
        elHudPhaseAccel.textContent = `${pa.toFixed(2)} rad/s² ${pa > 1.8 ? '[SURGE!]' : '[STEADY]'}`;
      }

      if (f.target.detected && f.target.distance_m > 0) {
        const d = f.target.distance_m;
        const threat = f.target.threat_level || 'CLEAR';
        elTargetReadout.textContent = `TARGET: ${d.toFixed(2)} m [${threat}]`;
        if (d < 0.7 || threat === 'HAZARD') {
          elTargetReadout.style.backgroundColor = '#000000';
          elTargetReadout.style.color = '#FFFFFF';
        } else {
          elTargetReadout.style.backgroundColor = '#FFFFFF';
          elTargetReadout.style.color = '#000000';
        }
      } else {
        elTargetReadout.textContent = f.status === 'UNCERTAIN' ? 'UNCERTAIN / MULTIPATH' : 'SEARCHING (NO OBSTACLE)';
        elTargetReadout.style.backgroundColor = '#FFFFFF';
        elTargetReadout.style.color = '#525252';
      }
    }

    const threat = (f.target && f.target.threat_level) || 'CLEAR';
    updateHapticDisplay(threat);

    if (f.respiration && systemMode === 'CARE') {
      elRespRateVal.textContent = `${f.respiration.bpm} BPM`;
      elRespDispVal.textContent = `${f.respiration.displacement_mm.toFixed(1)} mm`;
      elRespStatusText.textContent = 'RESTING RHYTHM // CHEST IN-CONTACT';
      elCareModeBadge.textContent = 'MODE B: CARE (CW 20 kHz)';
    }

    if (f.imu) {
      elAccelVal.textContent = `${f.imu.acc_magnitude.toFixed(2)} m/s²`;
      if (f.imu.is_impact || f.status === 'IMPACT_ALERT') {
        elTripwireBadge.textContent = 'TRIGGERED / IMPACT!';
        elTripwireBadge.className = 'badge badge-impact';
        elImpactOverlay.classList.remove('hidden');
        elImpactStats.textContent = `PEAK ACCEL: ${f.imu.acc_magnitude.toFixed(1)} m/s²`;
      } else {
        elTripwireBadge.textContent = 'ARMED / SECURE';
        elTripwireBadge.className = 'badge badge-armed';
        elImpactOverlay.classList.add('hidden');
      }
    }
  }

  function updateHapticDisplay(threat) {
    Object.values(ladderSteps).forEach(el => el && el.classList.remove('active'));

    switch (threat) {
      case 'HAZARD':
        elHapticLevel.textContent = 'HAZARD (RAPID PULSE)';
        elHapticDesc.textContent = '100 ms ON, 80 ms OFF (< 0.7 m or Surge)';
        ladderSteps.HAZARD && ladderSteps.HAZARD.classList.add('active');
        break;
      case 'WARNING':
        elHapticLevel.textContent = 'WARNING (MEDIUM PULSE)';
        elHapticDesc.textContent = '70 ms ON, 200 ms OFF (0.7 – 1.2 m)';
        ladderSteps.WARNING && ladderSteps.WARNING.classList.add('active');
        break;
      case 'CAUTION':
        elHapticLevel.textContent = 'CAUTION (SLOW PULSE)';
        elHapticDesc.textContent = '50 ms ON, 400 ms OFF (1.2 – 2.0 m)';
        ladderSteps.CAUTION && ladderSteps.CAUTION.classList.add('active');
        break;
      case 'UNCERTAIN':
        elHapticLevel.textContent = 'UNCERTAIN (DOUBLE-TAP)';
        elHapticDesc.textContent = 'Soft double-tap warning; multipath clutter';
        break;
      default:
        elHapticLevel.textContent = 'CLEAR (OFF)';
        elHapticDesc.textContent = 'No tactile feedback (> 2.0 m)';
        ladderSteps.CLEAR && ladderSteps.CLEAR.classList.add('active');
        break;
    }
  }

  function updateAiClassification(f) {
    if (!f) return;

    let pHuman = 4, pWall = 3, pSurge = 1, pDrop = 1, pClutter = 2;
    let className = 'SEARCHING / AMBIENT';

    if (f.target && f.target.phase_accel_rad_s2 > 1.8) {
      className = 'FAST SURGE (E-BIKE / VEHICLE)';
      pSurge = 96; pHuman = 2; pWall = 1; pDrop = 0; pClutter = 1;
    } else if (f.status === 'IMPACT_ALERT') {
      className = 'OPEN DROP-OFF / FALL SHOCK';
      pDrop = 98; pHuman = 1; pWall = 0; pSurge = 0; pClutter = 1;
    } else if (simIsCluttered) {
      className = 'ROOM MULTIPATH CLUTTER';
      pClutter = 92; pHuman = 3; pWall = 3; pSurge = 1; pDrop = 1;
    } else if (f.target && f.target.detected) {
      if (f.target.distance_m < 0.8) {
        className = 'SOLID BARRIER / WALL';
        pWall = 94; pHuman = 4; pSurge = 1; pDrop = 0; pClutter = 1;
      } else {
        className = 'HUMAN / PEDESTRIAN';
        pHuman = 97; pWall = 2; pSurge = 0; pDrop = 0; pClutter = 1;
      }
    }

    elAiClassName.textContent = className;
    elAiConfidence.textContent = `${Math.max(pHuman, pWall, pSurge, pDrop, pClutter)}% CONFIDENCE`;

    barHuman.style.width = `${pHuman}%`; pctHuman.textContent = `${pHuman}%`;
    barWall.style.width = `${pWall}%`; pctWall.textContent = `${pWall}%`;
    barSurge.style.width = `${pSurge}%`; pctSurge.textContent = `${pSurge}%`;
    barDrop.style.width = `${pDrop}%`; pctDrop.textContent = `${pDrop}%`;
    barClutter.style.width = `${pClutter}%`; pctClutter.textContent = `${pClutter}%`;
  }

  // ---------------------------------------------------- Interactive Controls
  btnSimToggle.addEventListener('click', () => {
    if (isSimulating) stopSimulator();
    else startSimulator();
  });

  btnSwitchTransit.addEventListener('click', () => {
    systemMode = 'TRANSIT';
    btnSwitchTransit.classList.add('active');
    btnSwitchCare.classList.remove('active');
    elCareModeBadge.textContent = 'STANDBY (AWAITING STILLNESS)';
    startSimulator();
  });

  btnSwitchCare.addEventListener('click', () => {
    systemMode = 'CARE';
    btnSwitchCare.classList.add('active');
    btnSwitchTransit.classList.remove('active');
    elCareModeBadge.textContent = 'MODE B: ACTIVE (CW 20 kHz)';
    startSimulator();
  });

  btnTestSurge.addEventListener('click', () => {
    systemMode = 'TRANSIT';
    btnSwitchTransit.classList.add('active');
    btnSwitchCare.classList.remove('active');
    if (!isSimulating) startSimulator();
    simIsSurging = true;
    simTargetDist = 2.1;
  });

  btnTestApproach.addEventListener('click', () => {
    systemMode = 'TRANSIT';
    btnSwitchTransit.classList.add('active');
    btnSwitchCare.classList.remove('active');
    if (!isSimulating) startSimulator();
    simTargetDist = 0.52;
    simDistDir = -0.005;
  });

  btnTestClutter.addEventListener('click', () => {
    if (!isSimulating) startSimulator();
    simIsCluttered = !simIsCluttered;
    btnTestClutter.classList.toggle('active', simIsCluttered);
  });

  btnTestImpact.addEventListener('click', () => {
    if (!isSimulating) startSimulator();
    simImpactTriggered = true;

    // Simulate free-fall (<0.2g) then shock (>3.0g) sequence
    let step = 0;
    const impactInterval = setInterval(() => {
      step++;
      if (step <= 3) {
        imuHistory.push(1.2); // Free-fall
      } else {
        imuHistory.push(38.5); // Impact shock
        clearInterval(impactInterval);

        onFrameReceived({
          timestamp: Date.now(),
          status: 'IMPACT_ALERT',
          target: { detected: false, distance_m: -1, confidence_psr: 0, threat_level: 'IMPACT', velocity_mps: 0, phase_accel_rad_s2: 0 },
          imu: { acc_magnitude: 38.5, is_impact: true },
          telemetry: { dsp_latency_ms: 0, npu_latency_ms: 0, audio_sample_rate: 48000, cloud_bytes_sec: 0, underruns: 0 },
          dsp: { correlation_curve: new Array(100).fill(0) }
        });
      }
      if (imuHistory.length > IMU_HISTORY_LEN) imuHistory.shift();
    }, 40);
  });

  btnDismissOverlay.addEventListener('click', () => {
    simImpactTriggered = false;
    elImpactOverlay.classList.add('hidden');
    elTripwireBadge.textContent = 'ARMED / SECURE';
    elTripwireBadge.className = 'badge badge-armed';
  });

  // ---------------------------------------------------- Render Loops
  let sweepAngle = 0;

  function render(time) {
    frameCount++;
    if (time - lastFpsTime >= 1000) {
      fps = Math.round((frameCount * 1000) / (time - lastFpsTime));
      elFpsMeter.textContent = `${fps} FPS`;
      frameCount = 0;
      lastFpsTime = time;
    }

    drawRadar(time);
    drawScope();
    drawSlamMap(time);
    drawWaterfall();
    drawImu();
    drawRespiration();

    requestAnimationFrame(render);
  }

  // ---------------------------------------------------- 1. Polar Radar
  function drawRadar(time) {
    const w = radarCanvas.width;
    const h = radarCanvas.height;
    if (w === 0 || h === 0) return;

    radarCtx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h * 0.88;
    const maxRadius = Math.min(w * 0.45, h * 0.78);
    const maxRangeM = 3.0;

    radarCtx.save();

    // Polar backdrop arc
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, maxRadius, Math.PI, 2 * Math.PI);
    radarCtx.fillStyle = '#FFFFFF';
    radarCtx.fill();
    radarCtx.lineWidth = 1.5;
    radarCtx.strokeStyle = '#000000';
    radarCtx.stroke();

    // Concentric range rings
    const rings = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    radarCtx.lineWidth = 1;
    rings.forEach(r => {
      const radius = (r / maxRangeM) * maxRadius;
      radarCtx.beginPath();
      radarCtx.arc(cx, cy, radius, Math.PI, 2 * Math.PI);
      radarCtx.strokeStyle = '#E5E5E5';
      radarCtx.stroke();

      radarCtx.fillStyle = '#525252';
      radarCtx.font = `500 ${Math.max(10, Math.floor(w * 0.024))}px "JetBrains Mono", monospace`;
      radarCtx.textAlign = 'left';
      radarCtx.fillText(`${r.toFixed(1)}m`, cx + 6, cy - radius + 4);
    });

    // Azimuth ray dividers
    radarCtx.setLineDash([3, 4]);
    radarCtx.strokeStyle = '#D4D4D4';
    [-60, -30, 0, 30, 60].forEach(deg => {
      const rad = (deg - 90) * (Math.PI / 180);
      radarCtx.beginPath();
      radarCtx.moveTo(cx, cy);
      radarCtx.lineTo(cx + Math.cos(rad) * maxRadius, cy + Math.sin(rad) * maxRadius);
      radarCtx.stroke();
    });
    radarCtx.setLineDash([]);

    // Environment Boundary Mapping: Static Room Wall (2.35m) with Doorway Opening
    const wallRad = (2.35 / maxRangeM) * maxRadius;
    radarCtx.lineWidth = 2.5;
    radarCtx.strokeStyle = '#000000';
    // Left wall segment
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, wallRad, (180 + 30) * (Math.PI / 180), (180 + 75) * (Math.PI / 180));
    radarCtx.stroke();
    // Right wall segment
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, wallRad, (180 + 105) * (Math.PI / 180), (180 + 150) * (Math.PI / 180));
    radarCtx.stroke();
    // Doorway opening dashed line
    radarCtx.setLineDash([2, 3]);
    radarCtx.lineWidth = 1;
    radarCtx.strokeStyle = '#737373';
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, wallRad, (180 + 75) * (Math.PI / 180), (180 + 105) * (Math.PI / 180));
    radarCtx.stroke();
    radarCtx.setLineDash([]);
    // Corner fixture at 1.55m
    const fixRad = (1.55 / maxRangeM) * maxRadius;
    const fixAngle = (180 + 55) * (Math.PI / 180);
    radarCtx.strokeRect(cx + Math.cos(fixAngle) * fixRad - 6, cy + Math.sin(fixAngle) * fixRad - 6, 12, 12);

    // Animated sonar sweep sector
    sweepAngle = (sweepAngle + 0.035) % (Math.PI * 2);
    const sectorAngle = (Math.sin(sweepAngle) * 0.9 - Math.PI / 2);
    const sweepRadius = maxRadius;

    const grad = radarCtx.createRadialGradient(cx, cy, 0, cx, cy, sweepRadius);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.16)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.01)');

    radarCtx.beginPath();
    radarCtx.moveTo(cx, cy);
    radarCtx.arc(cx, cy, sweepRadius, sectorAngle - 0.22, sectorAngle, false);
    radarCtx.closePath();
    radarCtx.fillStyle = grad;
    radarCtx.fill();

    // Sharp sweep front line
    radarCtx.beginPath();
    radarCtx.moveTo(cx, cy);
    radarCtx.lineTo(cx + Math.cos(sectorAngle) * sweepRadius, cy + Math.sin(sectorAngle) * sweepRadius);
    radarCtx.strokeStyle = '#000000';
    radarCtx.lineWidth = 1.5;
    radarCtx.stroke();

    // Emitter origin
    radarCtx.fillStyle = '#000000';
    radarCtx.fillRect(cx - 5, cy - 5, 10, 10);
    radarCtx.font = '700 10px "JetBrains Mono", monospace';
    radarCtx.textAlign = 'center';
    radarCtx.fillText('iQOO 15', cx, cy + 18);

    // Target Blip
    if (latestFrame && latestFrame.target && latestFrame.target.detected && latestFrame.target.distance_m > 0) {
      const d = latestFrame.target.distance_m;
      const blipRadius = (d / maxRangeM) * maxRadius;
      const blipX = cx;
      const blipY = cy - blipRadius;

      // Pulsing outer ring
      radarCtx.beginPath();
      radarCtx.arc(blipX, blipY, 12 + Math.sin(time * 0.01) * 3, 0, Math.PI * 2);
      radarCtx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      radarCtx.lineWidth = 1;
      radarCtx.stroke();

      // Sharp architectural target crosshair ticks
      radarCtx.strokeStyle = '#000000';
      radarCtx.lineWidth = 1.5;
      radarCtx.beginPath();
      radarCtx.moveTo(blipX - 12, blipY); radarCtx.lineTo(blipX - 5, blipY);
      radarCtx.moveTo(blipX + 5, blipY); radarCtx.lineTo(blipX + 12, blipY);
      radarCtx.moveTo(blipX, blipY - 12); radarCtx.lineTo(blipX, blipY - 5);
      radarCtx.moveTo(blipX, blipY + 5); radarCtx.lineTo(blipX, blipY + 12);
      radarCtx.stroke();

      // Solid central blip
      radarCtx.beginPath();
      radarCtx.arc(blipX, blipY, 4, 0, Math.PI * 2);
      radarCtx.fillStyle = '#000000';
      radarCtx.fill();

      // Inverted distance tag
      const tagText = `${d.toFixed(2)} m ${latestFrame.target.phase_accel_rad_s2 > 1.8 ? '[SURGE]' : ''}`;
      radarCtx.font = '700 11px "JetBrains Mono", monospace';
      const textWidth = radarCtx.measureText(tagText).width;

      radarCtx.fillStyle = '#000000';
      radarCtx.fillRect(blipX + 16, blipY - 10, textWidth + 16, 20);

      radarCtx.fillStyle = '#FFFFFF';
      radarCtx.textAlign = 'left';
      radarCtx.fillText(tagText, blipX + 24, blipY + 4);
    }

    radarCtx.restore();
  }

  // ---------------------------------------------------- 2. Correlation Scope
  function drawScope() {
    const w = scopeCanvas.width;
    const h = scopeCanvas.height;
    if (w === 0 || h === 0) return;

    scopeCtx.clearRect(0, 0, w, h);
    scopeCtx.fillStyle = '#FFFFFF';
    scopeCtx.fillRect(0, 0, w, h);

    const padLeft = 45;
    const padRight = 24;
    const padTop = 22;
    const padBottom = 26;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    scopeCtx.lineWidth = 1;
    scopeCtx.strokeStyle = '#000000';
    scopeCtx.strokeRect(padLeft, padTop, plotW, plotH);

    for (let m = 0; m <= 3.0; m += 0.5) {
      const x = padLeft + (m / 3.0) * plotW;
      scopeCtx.beginPath();
      scopeCtx.moveTo(x, padTop);
      scopeCtx.lineTo(x, padTop + plotH);
      scopeCtx.strokeStyle = '#F0F0F0';
      scopeCtx.stroke();

      scopeCtx.fillStyle = '#525252';
      scopeCtx.font = '500 10px "JetBrains Mono", monospace';
      scopeCtx.textAlign = 'center';
      scopeCtx.fillText(`${m.toFixed(1)}m`, x, h - 8);
    }

    // Direct-path blanking zone (0 – 0.3 m)
    const blankX = padLeft + (0.3 / 3.0) * plotW;
    scopeCtx.save();
    scopeCtx.beginPath();
    scopeCtx.rect(padLeft, padTop, blankX - padLeft, plotH);
    scopeCtx.clip();

    scopeCtx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    scopeCtx.lineWidth = 1;
    for (let x = padLeft - plotH; x < blankX + plotH; x += 8) {
      scopeCtx.beginPath();
      scopeCtx.moveTo(x, padTop + plotH);
      scopeCtx.lineTo(x + plotH, padTop);
      scopeCtx.stroke();
    }
    scopeCtx.restore();

    scopeCtx.beginPath();
    scopeCtx.moveTo(blankX, padTop);
    scopeCtx.lineTo(blankX, padTop + plotH);
    scopeCtx.strokeStyle = '#000000';
    scopeCtx.lineWidth = 1;
    scopeCtx.stroke();

    scopeCtx.fillStyle = '#000000';
    scopeCtx.font = '700 9px "JetBrains Mono", monospace';
    scopeCtx.textAlign = 'left';
    scopeCtx.fillText('BLANKED (0–0.3m)', padLeft + 4, padTop + 14);

    // Threshold line
    const yThresh = padTop + plotH * 0.70;
    scopeCtx.setLineDash([4, 4]);
    scopeCtx.strokeStyle = '#737373';
    scopeCtx.beginPath();
    scopeCtx.moveTo(blankX, yThresh);
    scopeCtx.lineTo(padLeft + plotW, yThresh);
    scopeCtx.stroke();
    scopeCtx.setLineDash([]);

    scopeCtx.fillStyle = '#737373';
    scopeCtx.font = '500 8px "JetBrains Mono", monospace';
    scopeCtx.textAlign = 'right';
    scopeCtx.fillText('THRESHOLD (μ + 4.5σ)', padLeft + plotW - 8, yThresh - 4);

    // Correlation trace
    const curve = (latestFrame && latestFrame.dsp && latestFrame.dsp.correlation_curve) || null;
    if (curve && curve.length > 0) {
      scopeCtx.beginPath();
      scopeCtx.strokeStyle = '#000000';
      scopeCtx.lineWidth = 2.2;

      for (let i = 0; i < curve.length; i++) {
        const x = padLeft + (i / (curve.length - 1)) * plotW;
        const val = Math.max(0, Math.min(1, curve[i]));
        const y = padTop + plotH - val * plotH;
        if (i === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();

      if (latestFrame.target && latestFrame.target.detected && latestFrame.target.distance_m > 0) {
        const d = latestFrame.target.distance_m;
        const peakX = padLeft + (d / 3.0) * plotW;
        const bin = Math.min(curve.length - 1, Math.max(0, Math.round((d / 3.0) * curve.length)));
        const peakY = padTop + plotH - Math.max(0, Math.min(1, curve[bin] || 0.5)) * plotH;

        scopeCtx.fillStyle = '#000000';
        scopeCtx.fillRect(peakX - 4, peakY - 4, 8, 8);

        scopeCtx.setLineDash([2, 3]);
        scopeCtx.strokeStyle = '#000000';
        scopeCtx.beginPath();
        scopeCtx.moveTo(peakX, peakY + 4);
        scopeCtx.lineTo(peakX, padTop + plotH);
        scopeCtx.stroke();
        scopeCtx.setLineDash([]);

        const calloutText = `PEAK: ${d.toFixed(2)}m (PSR: ${latestFrame.target.confidence_psr.toFixed(1)})`;
        scopeCtx.font = '700 9px "JetBrains Mono", monospace';
        const cWidth = scopeCtx.measureText(calloutText).width;

        scopeCtx.fillStyle = '#000000';
        scopeCtx.fillRect(peakX + 8, peakY - 16, cWidth + 12, 16);

        scopeCtx.fillStyle = '#FFFFFF';
        scopeCtx.textAlign = 'left';
        scopeCtx.fillText(calloutText, peakX + 14, peakY - 5);
      }
    }
  }

  // ---------------------------------------------------- 2. Grayscale Environmental Waterfall (18.0 – 20.5 kHz)
  function drawWaterfall() {
    const w = waterfallCanvas.width;
    const h = waterfallCanvas.height;
    if (w === 0 || h === 0 || waterfallBuffer.length === 0) return;

    waterfallCtx.clearRect(0, 0, w, h);
    waterfallCtx.fillStyle = '#FFFFFF';
    waterfallCtx.fillRect(0, 0, w, h);

    const padLeft = 42;
    const padRight = 18;
    const padTop = 24;
    const padBottom = 18;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    // Double-line outer framing box (Matching editorial standard in media_1791222138685.png)
    waterfallCtx.lineWidth = 1;
    waterfallCtx.strokeStyle = '#000000';
    waterfallCtx.strokeRect(padLeft - 4, padTop - 4, plotW + 8, plotH + 8);
    waterfallCtx.strokeRect(padLeft, padTop, plotW, plotH);

    // Top range axis markers (0.0 to 3.0 m)
    for (let m = 0; m <= 3.0; m += 0.5) {
      const x = padLeft + (m / 3.0) * plotW;
      waterfallCtx.beginPath();
      waterfallCtx.moveTo(x, padTop - 6);
      waterfallCtx.lineTo(x, padTop);
      waterfallCtx.strokeStyle = '#000000';
      waterfallCtx.stroke();

      waterfallCtx.fillStyle = '#525252';
      waterfallCtx.font = '500 8.5px "JetBrains Mono", monospace';
      waterfallCtx.textAlign = 'center';
      waterfallCtx.fillText(`${m.toFixed(1)}m`, x, padTop - 8);
    }

    // Left time history axis markers (0s to -10s)
    const timeSteps = [0, 2, 4, 6, 8, 10];
    timeSteps.forEach(sec => {
      const y = padTop + (sec / 10.0) * plotH;
      waterfallCtx.beginPath();
      waterfallCtx.moveTo(padLeft - 6, y);
      waterfallCtx.lineTo(padLeft, y);
      waterfallCtx.strokeStyle = '#000000';
      waterfallCtx.stroke();

      waterfallCtx.fillStyle = '#525252';
      waterfallCtx.font = '500 8px "JetBrains Mono", monospace';
      waterfallCtx.textAlign = 'right';
      waterfallCtx.fillText(sec === 0 ? '0s' : `-${sec}s`, padLeft - 8, y + 3);
    });

    // Direct-path blanking zone (0 – 0.3 m) with diagonal line hatching
    const blankW = (0.3 / 3.0) * plotW;
    waterfallCtx.save();
    waterfallCtx.beginPath();
    waterfallCtx.rect(padLeft, padTop, blankW, plotH);
    waterfallCtx.clip();

    waterfallCtx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    waterfallCtx.lineWidth = 1;
    for (let x = padLeft - plotH; x < padLeft + blankW + plotH; x += 8) {
      waterfallCtx.beginPath();
      waterfallCtx.moveTo(x, padTop + plotH);
      waterfallCtx.lineTo(x + plotH, padTop);
      waterfallCtx.stroke();
    }
    waterfallCtx.restore();

    // Blanking boundary line
    waterfallCtx.beginPath();
    waterfallCtx.moveTo(padLeft + blankW, padTop);
    waterfallCtx.lineTo(padLeft + blankW, padTop + plotH);
    waterfallCtx.strokeStyle = '#000000';
    waterfallCtx.lineWidth = 1;
    waterfallCtx.stroke();

    waterfallCtx.fillStyle = '#000000';
    waterfallCtx.font = '700 8px "JetBrains Mono", monospace';
    waterfallCtx.textAlign = 'center';
    waterfallCtx.fillText('BLANKED', padLeft + blankW / 2, padTop + plotH - 6);

    // Multi-reflection waterfall pixel matrix (60 frames history)
    const rows = waterfallBuffer.length;
    const rowH = plotH / rows;

    for (let r = 0; r < rows; r++) {
      const curve = waterfallBuffer[r];
      const cols = curve.length;
      const colW = (plotW - blankW) / cols;
      const y = padTop + r * rowH;

      for (let c = 0; c < cols; c++) {
        const val = Math.max(0, Math.min(1, curve[c]));
        const intensity = Math.pow(val, 0.65);
        // High contrast grayscale mapping (white = no echo, black = strong reflection)
        const gray = Math.max(0, Math.min(255, Math.floor(255 - intensity * 255)));

        waterfallCtx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
        waterfallCtx.fillRect(padLeft + blankW + c * colW, y, colW + 1, rowH + 1);
      }
    }

    // Static Room Feature Callout Lines (matching the living room photo)
    const tableX = padLeft + (1.10 / 3.0) * plotW;
    const chairX = padLeft + (1.40 / 3.0) * plotW;
    const sofaX = padLeft + (1.70 / 3.0) * plotW;
    const wallX = padLeft + (2.50 / 3.0) * plotW;

    waterfallCtx.setLineDash([2, 4]);
    waterfallCtx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    [tableX, chairX, sofaX, wallX].forEach(x => {
      waterfallCtx.beginPath();
      waterfallCtx.moveTo(x, padTop);
      waterfallCtx.lineTo(x, padTop + plotH);
      waterfallCtx.stroke();
    });
    waterfallCtx.setLineDash([]);

    // Feature tags at bottom of waterfall
    waterfallCtx.fillStyle = '#000000';
    waterfallCtx.font = '700 7.5px "JetBrains Mono", monospace';
    waterfallCtx.textAlign = 'center';
    waterfallCtx.fillText('TABLE (1.1m)', tableX, padTop + plotH - 6);
    waterfallCtx.fillText('CHAIR (1.4m)', chairX, padTop + plotH - 16);
    waterfallCtx.fillText('SOFA (1.7m)', sofaX, padTop + plotH - 6);
    waterfallCtx.fillText('WALL (2.5m)', wallX, padTop + plotH - 6);

    // Dynamic target pointer on top edge
    if (latestFrame && latestFrame.target && latestFrame.target.detected && latestFrame.target.distance_m > 0) {
      const d = latestFrame.target.distance_m;
      const targetX = padLeft + (d / 3.0) * plotW;
      waterfallCtx.fillStyle = '#000000';
      waterfallCtx.beginPath();
      waterfallCtx.moveTo(targetX, padTop + 2);
      waterfallCtx.lineTo(targetX - 4, padTop + 9);
      waterfallCtx.lineTo(targetX + 4, padTop + 9);
      waterfallCtx.closePath();
      waterfallCtx.fill();
    }
  }

  // ---------------------------------------------------- 1. 2D Acoustic Room SLAM Map (Living Room Spatial Reconstruction)
  function drawSlamMap(time) {
    if (!slamCanvas || !slamCtx) return;
    const w = slamCanvas.width;
    const h = slamCanvas.height;
    if (w === 0 || h === 0) return;

    slamCtx.clearRect(0, 0, w, h);
    slamCtx.fillStyle = '#FFFFFF';
    slamCtx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h - 34;
    const maxRangeM = 3.0;
    const scale = (cy - 38) / maxRangeM; // pixels per meter

    function toScreen(xM, yM) {
      return { x: cx + xM * scale, y: cy - yM * scale };
    }

    // 1. Blueprint Grid lines (0.5m dashed, 1.0m solid)
    slamCtx.lineWidth = 1;
    for (let xm = -2.5; xm <= 2.5; xm += 0.5) {
      const p1 = toScreen(xm, 0);
      const p2 = toScreen(xm, 3.0);
      slamCtx.strokeStyle = Math.abs(xm % 1.0) < 0.01 ? '#E0E0E0' : '#F2F2F2';
      if (Math.abs(xm % 1.0) >= 0.01) slamCtx.setLineDash([2, 4]);
      else slamCtx.setLineDash([]);
      slamCtx.beginPath(); slamCtx.moveTo(p1.x, p1.y); slamCtx.lineTo(p2.x, p2.y); slamCtx.stroke();
    }
    for (let ym = 0.5; ym <= 3.0; ym += 0.5) {
      const p1 = toScreen(-2.2, ym);
      const p2 = toScreen(2.2, ym);
      slamCtx.strokeStyle = Math.abs(ym % 1.0) < 0.01 ? '#E0E0E0' : '#F2F2F2';
      if (Math.abs(ym % 1.0) >= 0.01) slamCtx.setLineDash([2, 4]);
      else slamCtx.setLineDash([]);
      slamCtx.beginPath(); slamCtx.moveTo(p1.x, p1.y); slamCtx.lineTo(p2.x, p2.y); slamCtx.stroke();
    }
    slamCtx.setLineDash([]);

    // 2. Transducer Acoustic Coverage Cone (-50 deg to +50 deg)
    slamCtx.setLineDash([3, 4]);
    slamCtx.strokeStyle = '#CCCCCC';
    [-45, -30, -15, 0, 15, 30, 45].forEach(deg => {
      const rad = (deg - 90) * (Math.PI / 180);
      slamCtx.beginPath();
      slamCtx.moveTo(cx, cy);
      slamCtx.lineTo(cx + Math.cos(rad) * (cy - 20), cy + Math.sin(rad) * (cy - 20));
      slamCtx.stroke();

      if (deg !== 0) {
        slamCtx.fillStyle = '#888888';
        slamCtx.font = '500 8px "JetBrains Mono", monospace';
        slamCtx.textAlign = 'center';
        slamCtx.fillText(`${deg > 0 ? '+' : ''}${deg}°`, cx + Math.cos(rad) * (cy - 12), cy + Math.sin(rad) * (cy - 12));
      }
    });

    // Range distance arc circles (0.5m, 1.0m, 1.5m, 2.0m, 2.5m, 3.0m)
    [0.5, 1.0, 1.5, 2.0, 2.5, 3.0].forEach(r => {
      const rad = r * scale;
      slamCtx.beginPath();
      slamCtx.arc(cx, cy, rad, Math.PI * 1.15, Math.PI * 1.85);
      slamCtx.stroke();

      slamCtx.fillStyle = '#666666';
      slamCtx.font = '600 8.5px "JetBrains Mono", monospace';
      slamCtx.textAlign = 'left';
      slamCtx.fillText(`${r.toFixed(1)}m`, cx + 6, cy - rad + 3);
    });
    slamCtx.setLineDash([]);

    // 3. Live Animated Ultrasonic Wavefront Pulse (FMCW sweep visualization)
    const tMs = Date.now();
    const waveProgress = (tMs % 1600) / 1600;
    const waveRadius = waveProgress * 3.0 * scale;
    slamCtx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    slamCtx.lineWidth = 1.5;
    slamCtx.beginPath();
    slamCtx.arc(cx, cy, waveRadius, Math.PI * 1.2, Math.PI * 1.8);
    slamCtx.stroke();

    // Live acoustic beam ray oscillation (+-42 deg)
    const sweepDeg = Math.sin(tMs * 0.002) * 42;
    const sweepRad = (sweepDeg - 90) * (Math.PI / 180);
    slamCtx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    slamCtx.lineWidth = 1;
    slamCtx.beginPath();
    slamCtx.moveTo(cx, cy);
    slamCtx.lineTo(cx + Math.cos(sweepRad) * (3.0 * scale), cy + Math.sin(sweepRad) * (3.0 * scale));
    slamCtx.stroke();

    // 4. LIVING ROOM FLOORPLAN (Directly Reconstructed from Photograph)
    // -------------------------------------------------------------------
    // A. Geometric Area Rug (textile diffuse scatter under table & chairs)
    const rugP1 = toScreen(-0.90, 2.35);
    const rugP2 = toScreen(0.90, 0.65);
    slamCtx.setLineDash([3, 3]);
    slamCtx.strokeStyle = '#D4D4D4';
    slamCtx.lineWidth = 1;
    slamCtx.strokeRect(rugP1.x, rugP1.y, rugP2.x - rugP1.x, rugP2.y - rugP1.y);
    slamCtx.setLineDash([]);

    // Subtle chevron pattern on rug matching photo
    slamCtx.strokeStyle = '#F0F0F0';
    for (let ym = 0.8; ym <= 2.2; ym += 0.25) {
      const rpL = toScreen(-0.80, ym);
      const rpM = toScreen(0, ym + 0.1);
      const rpR = toScreen(0.80, ym);
      slamCtx.beginPath();
      slamCtx.moveTo(rpL.x, rpL.y);
      slamCtx.lineTo(rpM.x, rpM.y);
      slamCtx.lineTo(rpR.x, rpR.y);
      slamCtx.stroke();
    }

    slamCtx.fillStyle = '#A3A3A3';
    slamCtx.font = '500 7.5px "JetBrains Mono", monospace';
    slamCtx.textAlign = 'left';
    slamCtx.fillText('AREA RUG (GEOMETRIC WEAVE // DIFFUSE SCATTER)', rugP1.x + 8, rugP2.y - 6);

    // B. Item 01: Center Coffee Table (1.10 m // Specular Echo Peak)
    const tableTL = toScreen(-0.25, 1.35);
    const tableBR = toScreen(0.40, 0.95);
    const tableW = tableBR.x - tableTL.x;
    const tableH = tableBR.y - tableTL.y;

    // Metal wireframe cross-braces
    slamCtx.strokeStyle = '#CCCCCC';
    slamCtx.lineWidth = 1;
    slamCtx.beginPath();
    slamCtx.moveTo(tableTL.x, tableTL.y); slamCtx.lineTo(tableBR.x, tableBR.y);
    slamCtx.moveTo(tableBR.x, tableTL.y); slamCtx.lineTo(tableTL.x, tableBR.y);
    slamCtx.stroke();

    // Tabletop boundary
    slamCtx.lineWidth = 2;
    slamCtx.strokeStyle = '#000000';
    slamCtx.strokeRect(tableTL.x, tableTL.y, tableW, tableH);

    // Round pedestal drink table next to coffee table
    const roundTab = toScreen(0.48, 1.25);
    slamCtx.beginPath();
    slamCtx.arc(roundTab.x, roundTab.y, 0.12 * scale, 0, Math.PI * 2);
    slamCtx.fillStyle = '#FFFFFF';
    slamCtx.fill();
    slamCtx.strokeStyle = '#000000';
    slamCtx.stroke();

    // Acoustic return stipple dots along coffee table leading edge
    slamCtx.fillStyle = '#000000';
    for (let i = 0; i < 8; i++) {
      const stX = tableTL.x + (i / 7) * tableW;
      const stY = tableBR.y + (Math.sin(i * 1.5 + tMs * 0.005) * 1.5);
      slamCtx.fillRect(stX - 1, stY - 1, 2, 2);
    }

    // Callout Badge for Item 01
    drawSlamBadge(tableTL.x - 10, tableBR.y + 14, '01. COFFEE TABLE (1.10m)', 'SPECULAR PEAK', 'left');

    // C. Item 02: Cognac Leather Lounge Armchair (1.40 m // Left Flank)
    const chairCenter = toScreen(-0.95, 1.45);
    const chairAngle = -18 * (Math.PI / 180);
    slamCtx.save();
    slamCtx.translate(chairCenter.x, chairCenter.y);
    slamCtx.rotate(chairAngle);

    const cW = 0.55 * scale;
    const cH = 0.45 * scale;
    // Outer metal frame
    slamCtx.lineWidth = 1.5;
    slamCtx.strokeStyle = '#000000';
    slamCtx.strokeRect(-cW / 2, -cH / 2, cW, cH);
    // Armrests
    slamCtx.strokeRect(-cW / 2 - 3, -cH / 2, 3, cH);
    slamCtx.strokeRect(cW / 2, -cH / 2, 3, cH);
    // Backrest
    slamCtx.strokeRect(-cW / 2 + 2, -cH / 2, cW - 4, 6);
    slamCtx.restore();

    drawSlamBadge(chairCenter.x - 30, chairCenter.y - 12, '02. LEATHER CHAIR (1.40m)', 'LEFT AZIMUTH -35°', 'right');

    // D. Item 03: Secondary Upholstered Chair (1.90 m // Rear Left)
    const chair2Center = toScreen(-1.05, 1.95);
    slamCtx.lineWidth = 1.2;
    slamCtx.strokeStyle = '#555555';
    const c2W = 0.48 * scale;
    const c2H = 0.42 * scale;
    slamCtx.strokeRect(chair2Center.x - c2W / 2, chair2Center.y - c2H / 2, c2W, c2H);
    drawSlamBadge(chair2Center.x - 20, chair2Center.y - 10, '03. SECONDARY CHAIR (1.90m)', '', 'right');

    // E. Item 04: Contemporary 3-Seater Sofa (1.70 m - 2.60 m // Right Flank)
    const sofaTL = toScreen(0.80, 2.55);
    const sofaBR = toScreen(1.50, 1.45);
    const sofaW = sofaBR.x - sofaTL.x;
    const sofaH = sofaBR.y - sofaTL.y;

    // Sofa outer frame
    slamCtx.lineWidth = 2;
    slamCtx.strokeStyle = '#000000';
    slamCtx.strokeRect(sofaTL.x, sofaTL.y, sofaW, sofaH);

    // 3 Cushions
    slamCtx.lineWidth = 1;
    const cushionH = sofaH / 3;
    for (let c = 1; c < 3; c++) {
      slamCtx.beginPath();
      slamCtx.moveTo(sofaTL.x, sofaTL.y + c * cushionH);
      slamCtx.lineTo(sofaBR.x - 6, sofaTL.y + c * cushionH);
      slamCtx.stroke();
    }
    // Sofa backrest along right wall
    slamCtx.lineWidth = 1.5;
    slamCtx.strokeRect(sofaBR.x - 6, sofaTL.y, 6, sofaH);

    // Side table & potted palm plant in photo
    const plantPos = toScreen(1.10, 1.22);
    slamCtx.beginPath();
    slamCtx.arc(plantPos.x, plantPos.y, 0.10 * scale, 0, Math.PI * 2);
    slamCtx.fillStyle = '#FFFFFF'; slamCtx.fill(); slamCtx.strokeStyle = '#000000'; slamCtx.stroke();
    slamCtx.fillStyle = '#000000'; slamCtx.font = '700 7px "JetBrains Mono", monospace';
    slamCtx.textAlign = 'center'; slamCtx.fillText('PLANT', plantPos.x, plantPos.y + 2.5);

    drawSlamBadge(sofaTL.x + 10, sofaBR.y + 14, '04. FABRIC SOFA (1.70m FRONT)', 'LENGTH: 2.6m // RIGHT FLANK', 'left');

    // F. Item 05: Wooden Credenza & Shelving Unit (2.50 m Back Wall)
    const wallY = cy - 2.50 * scale;
    const wallL = toScreen(-1.60, 2.50).x;
    const wallR = toScreen(1.60, 2.50).x;

    // Structural wall
    slamCtx.lineWidth = 3;
    slamCtx.strokeStyle = '#000000';
    slamCtx.beginPath();
    slamCtx.moveTo(wallL, wallY);
    slamCtx.lineTo(wallR, wallY);
    slamCtx.stroke();

    // Modular Credenza Cabinet
    const credTL = toScreen(-0.55, 2.62);
    const credBR = toScreen(0.75, 2.45);
    slamCtx.lineWidth = 1.8;
    slamCtx.fillStyle = '#FAFAFA';
    slamCtx.fillRect(credTL.x, credTL.y, credBR.x - credTL.x, credBR.y - credTL.y);
    slamCtx.strokeRect(credTL.x, credTL.y, credBR.x - credTL.x, credBR.y - credTL.y);

    // Cabinet partitions
    slamCtx.lineWidth = 1;
    const credMidX = (credTL.x + credBR.x) / 2;
    slamCtx.beginPath(); slamCtx.moveTo(credMidX, credTL.y); slamCtx.lineTo(credMidX, credBR.y); slamCtx.stroke();

    // Acoustic Guitar on stand (left of credenza in photo)
    const guitarPos = toScreen(-0.45, 2.30);
    slamCtx.beginPath();
    slamCtx.arc(guitarPos.x, guitarPos.y, 0.08 * scale, 0, Math.PI * 2);
    slamCtx.fillStyle = '#FFFFFF'; slamCtx.fill(); slamCtx.strokeStyle = '#000000'; slamCtx.stroke();
    slamCtx.fillStyle = '#555555'; slamCtx.font = '600 7px "JetBrains Mono", monospace';
    slamCtx.textAlign = 'center'; slamCtx.fillText('GUITAR', guitarPos.x, guitarPos.y + 2);

    drawSlamBadge(credMidX, wallY - 10, '05. CREDENZA / BACK WALL (2.50m)', 'MODULAR SHELVES & GUITAR', 'center');

    // G. Item 06: Open Doorway Aperture (2.70 m Left)
    const doorL = toScreen(-1.55, 2.70).x;
    const doorR = toScreen(-0.85, 2.70).x;
    const doorY = toScreen(0, 2.70).y;

    slamCtx.setLineDash([2, 3]);
    slamCtx.lineWidth = 1.5;
    slamCtx.strokeStyle = '#737373';
    slamCtx.beginPath();
    slamCtx.moveTo(doorL, doorY);
    slamCtx.lineTo(doorR, doorY);
    slamCtx.stroke();
    slamCtx.setLineDash([]);

    drawSlamBadge((doorL + doorR) / 2, doorY - 8, '06. OPEN DOORWAY (2.70m)', '0.8m APERTURE TO HALL', 'center');

    // 5. DYNAMIC TARGET / PEDESTRIAN (Walking in open aisle)
    // ------------------------------------------------------
    let targetDist = simTargetDist;
    let targetDetected = true;
    if (latestFrame && latestFrame.target) {
      targetDetected = latestFrame.target.detected;
      if (latestFrame.target.distance_m > 0) targetDist = latestFrame.target.distance_m;
    }

    if (targetDetected && targetDist > 0) {
      // Dynamic lateral walk position in the aisle between coffee table and couch
      const lateralX = 0.22 + Math.sin(tMs * 0.0012) * 0.12;
      const tPos = toScreen(lateralX, targetDist);

      // Warning rings
      const pulseRad = 8 + (tMs % 800) / 800 * 10;
      slamCtx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      slamCtx.lineWidth = 1;
      slamCtx.beginPath();
      slamCtx.arc(tPos.x, tPos.y, pulseRad, 0, Math.PI * 2);
      slamCtx.stroke();

      // Target Crosshair
      slamCtx.lineWidth = 2;
      slamCtx.strokeStyle = '#000000';
      slamCtx.beginPath();
      slamCtx.moveTo(tPos.x - 9, tPos.y); slamCtx.lineTo(tPos.x + 9, tPos.y);
      slamCtx.moveTo(tPos.x, tPos.y - 9); slamCtx.lineTo(tPos.x, tPos.y + 9);
      slamCtx.stroke();

      slamCtx.beginPath();
      slamCtx.arc(tPos.x, tPos.y, 4, 0, Math.PI * 2);
      slamCtx.fillStyle = '#000000';
      slamCtx.fill();

      // Velocity Approach Vector Arrow
      slamCtx.lineWidth = 2;
      slamCtx.beginPath();
      slamCtx.moveTo(tPos.x, tPos.y);
      slamCtx.lineTo(tPos.x, tPos.y + 22);
      slamCtx.stroke();

      slamCtx.beginPath();
      slamCtx.moveTo(tPos.x, tPos.y + 24);
      slamCtx.lineTo(tPos.x - 4, tPos.y + 18);
      slamCtx.lineTo(tPos.x + 4, tPos.y + 18);
      slamCtx.closePath();
      slamCtx.fillStyle = '#000000';
      slamCtx.fill();

      // Target Label Badge
      const isSurge = simPhaseAccel > 1.8;
      const threatText = isSurge ? 'SURGE HAZARD' : (targetDist < 0.7 ? 'HAZARD' : (targetDist < 1.2 ? 'WARNING' : 'CAUTION'));
      const targetLabel = `DYNAMIC OBSTACLE: ${targetDist.toFixed(2)}m [${threatText}]`;

      slamCtx.font = '700 9px "JetBrains Mono", monospace';
      const labelW = slamCtx.measureText(targetLabel).width;
      slamCtx.fillStyle = '#000000';
      slamCtx.fillRect(tPos.x + 14, tPos.y - 10, labelW + 12, 20);
      slamCtx.fillStyle = '#FFFFFF';
      slamCtx.textAlign = 'left';
      slamCtx.fillText(targetLabel, tPos.x + 20, tPos.y + 4);

      // Update DOM readout in panel header
      const slamTargetStatus = document.getElementById('slam-target-status');
      if (slamTargetStatus) {
        slamTargetStatus.textContent = `OBSTACLE: ${targetDist.toFixed(2)}m // ${threatText} (${(simDistDir * 10).toFixed(1)} m/s)`;
      }
    }

    // 6. PHONE TRANSDUCER ORIGIN (iQOO 15 at Bottom Center)
    // ------------------------------------------------------
    slamCtx.fillStyle = '#000000';
    slamCtx.fillRect(cx - 8, cy - 8, 16, 16);

    // Dual Mic Port Indicators
    slamCtx.fillStyle = '#FFFFFF';
    slamCtx.fillRect(cx - 5, cy - 6, 2, 2);
    slamCtx.fillRect(cx + 3, cy - 6, 2, 2);

    slamCtx.fillStyle = '#000000';
    slamCtx.font = '700 9px "JetBrains Mono", monospace';
    slamCtx.textAlign = 'center';
    slamCtx.fillText('iQOO 15 (DUAL-MIC TRANSDUCER)', cx, cy + 18);

    // 7. Architectural Scale Bar (Bottom Left)
    slamCtx.lineWidth = 2;
    slamCtx.strokeStyle = '#000000';
    slamCtx.beginPath();
    slamCtx.moveTo(16, h - 14);
    slamCtx.lineTo(16 + 1.0 * scale, h - 14);
    slamCtx.stroke();

    slamCtx.beginPath();
    slamCtx.moveTo(16, h - 18); slamCtx.lineTo(16, h - 10);
    slamCtx.moveTo(16 + 1.0 * scale, h - 18); slamCtx.lineTo(16 + 1.0 * scale, h - 10);
    slamCtx.stroke();

    slamCtx.fillStyle = '#000000';
    slamCtx.font = '700 8.5px "JetBrains Mono", monospace';
    slamCtx.textAlign = 'left';
    slamCtx.fillText('1.0m SCALE', 16, h - 22);

    // Status Tag at Top Right
    slamCtx.font = '700 8px "JetBrains Mono", monospace';
    slamCtx.textAlign = 'right';
    slamCtx.fillText('2D ACOUSTIC ROOM SLAM // 3.5cm RESOLUTION', w - 12, 14);

    // Orientation compass at bottom right
    slamCtx.textAlign = 'right';
    slamCtx.fillText('▲ +Y FORWARD // +X RIGHT', w - 14, h - 14);
  }

  function drawSlamBadge(x, y, title, subtitle, align) {
    slamCtx.font = '700 8px "JetBrains Mono", monospace';
    const tW = slamCtx.measureText(title).width;
    slamCtx.font = '500 7px "JetBrains Mono", monospace';
    const sW = subtitle ? slamCtx.measureText(subtitle).width : 0;
    const bW = Math.max(tW, sW) + 10;
    const bH = subtitle ? 22 : 14;

    let bX = x;
    if (align === 'center') bX = x - bW / 2;
    else if (align === 'right') bX = x - bW;

    slamCtx.fillStyle = '#000000';
    slamCtx.fillRect(bX, y - bH / 2, bW, bH);

    slamCtx.fillStyle = '#FFFFFF';
    slamCtx.textAlign = 'left';
    slamCtx.font = '700 8px "JetBrains Mono", monospace';
    slamCtx.fillText(title, bX + 5, y - (subtitle ? 1 : -3));

    if (subtitle) {
      slamCtx.fillStyle = '#D4D4D4';
      slamCtx.font = '500 7px "JetBrains Mono", monospace';
      slamCtx.fillText(subtitle, bX + 5, y + 8);
    }
  }

  // ---------------------------------------------------- 4. IMU Sparkline
  function drawImu() {
    const w = imuCanvas.width;
    const h = imuCanvas.height;
    if (w === 0 || h === 0) return;

    imuCtx.clearRect(0, 0, w, h);
    imuCtx.fillStyle = '#FFFFFF';
    imuCtx.fillRect(0, 0, w, h);

    const gY = h * 0.65;
    imuCtx.strokeStyle = '#A3A3A3';
    imuCtx.lineWidth = 1;
    imuCtx.setLineDash([4, 4]);
    imuCtx.beginPath();
    imuCtx.moveTo(0, gY);
    imuCtx.lineTo(w, gY);
    imuCtx.stroke();
    imuCtx.setLineDash([]);

    imuCtx.fillStyle = '#737373';
    imuCtx.font = '500 9px "JetBrains Mono", monospace';
    imuCtx.textAlign = 'right';
    imuCtx.fillText('9.81 m/s² (1.0g BASELINE)', w - 8, gY - 4);

    imuCtx.beginPath();
    imuCtx.strokeStyle = '#000000';
    imuCtx.lineWidth = 1.8;

    let lastX = 0, lastY = gY;
    for (let i = 0; i < imuHistory.length; i++) {
      const x = (i / (imuHistory.length - 1)) * w;
      const val = imuHistory[i];
      const y = h - (val / 40.0) * h;
      if (i === 0) imuCtx.moveTo(x, y);
      else imuCtx.lineTo(x, y);
      lastX = x; lastY = y;
    }
    imuCtx.stroke();

    imuCtx.beginPath();
    imuCtx.arc(lastX - 2, lastY, 3, 0, Math.PI * 2);
    imuCtx.fillStyle = '#000000';
    imuCtx.fill();
  }

  // ---------------------------------------------------- 5. Care Mode Respiration Waveform
  function drawRespiration() {
    const w = respirationCanvas.width;
    const h = respirationCanvas.height;
    if (w === 0 || h === 0) return;

    respCtx.clearRect(0, 0, w, h);
    respCtx.fillStyle = '#FFFFFF';
    respCtx.fillRect(0, 0, w, h);

    const midY = h * 0.5;

    // Midline zero reference
    respCtx.strokeStyle = '#E5E5E5';
    respCtx.lineWidth = 1;
    respCtx.beginPath();
    respCtx.moveTo(0, midY);
    respCtx.lineTo(w, midY);
    respCtx.stroke();

    // Sinusoidal chest displacement trace
    respCtx.beginPath();
    respCtx.strokeStyle = '#000000';
    respCtx.lineWidth = 2.2;

    let lastX = 0, lastY = midY;
    for (let i = 0; i < respHistory.length; i++) {
      const x = (i / (respHistory.length - 1)) * w;
      const val = respHistory[i];
      const y = midY - (val / 3.0) * (h * 0.42);
      if (i === 0) respCtx.moveTo(x, y);
      else respCtx.lineTo(x, y);
      lastX = x; lastY = y;
    }
    respCtx.stroke();

    // Lead point pulse dot
    respCtx.beginPath();
    respCtx.arc(lastX - 2, lastY, 4, 0, Math.PI * 2);
    respCtx.fillStyle = '#000000';
    respCtx.fill();

    // Callout
    respCtx.fillStyle = '#525252';
    respCtx.font = '500 9px "JetBrains Mono", monospace';
    respCtx.textAlign = 'right';
    respCtx.fillText('PHASE UNWRAPPED DISPLACEMENT (0.1–0.5 Hz)', w - 8, h - 6);
  }

  // Connect automatically, or auto-fallback to simulator
  connectWs();
  requestAnimationFrame(render);
})();
