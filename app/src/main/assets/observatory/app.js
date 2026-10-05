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

  // Mapping Mode State: 'WATERFALL' | 'SLAM'
  let mappingView = 'WATERFALL';
  const btnToggleMappingMode = document.getElementById('btn-toggle-mapping-mode');
  const waterfallStatusPill = document.getElementById('waterfall-status-pill');

  if (btnToggleMappingMode) {
    btnToggleMappingMode.addEventListener('click', () => {
      if (mappingView === 'WATERFALL') {
        mappingView = 'SLAM';
        waterfallCanvas.style.display = 'none';
        if (slamCanvas) slamCanvas.style.display = 'block';
        btnToggleMappingMode.textContent = 'TOGGLE: RANGE-TIME WATERFALL';
        if (waterfallStatusPill) waterfallStatusPill.textContent = '2D ROOM SLAM // RECONSTRUCTION';
      } else {
        mappingView = 'WATERFALL';
        if (slamCanvas) slamCanvas.style.display = 'none';
        waterfallCanvas.style.display = 'block';
        btnToggleMappingMode.textContent = 'TOGGLE: 2D SLAM MAP';
        if (waterfallStatusPill) waterfallStatusPill.textContent = 'ENVIRONMENT MAPPING // GRAYSCALE';
      }
      resizeCanvases();
    });
  }

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
          const isTransit = panel.id === 'panel-radar' || panel.id === 'panel-scope' || panel.id === 'panel-waterfall' || panel.id === 'panel-haptic' || panel.id === 'panel-hud';
          panel.style.display = isTransit ? 'flex' : 'none';
        } else if (filter === 'care') {
          const isCare = panel.id === 'panel-care' || panel.id === 'panel-hud' || panel.id === 'panel-haptic';
          panel.style.display = isCare ? 'flex' : 'none';
        } else if (filter === 'ai') {
          const isAi = panel.id === 'panel-ai' || panel.id === 'panel-radar' || panel.id === 'panel-hud';
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
      // Multi-reflection acoustic modeling: Static room boundaries + Furniture + Dynamic target + Multipath
      const wallDist = 2.35;
      const fixtureDist = 1.55;
      const floorBounce = 0.85;

      const curve = new Array(100).fill(0).map((_, i) => {
        const binDist = (i / 100) * 3.0;
        let v = Math.random() * 0.035; // Natural acoustic speckle noise floor

        if (binDist < 0.3) {
          return 0.0; // Direct-path microphone blanking zone
        }

        // 1. Static Room Wall Backscatter (persistent boundary at 2.35m)
        v += 0.72 * Math.exp(-Math.pow((binDist - wallDist) / 0.08, 2));

        // 2. Corner Desk / Pillar Reflection (static fixture at 1.55m)
        v += 0.38 * Math.exp(-Math.pow((binDist - fixtureDist) / 0.07, 2));

        // 3. Ground / Floor Specular Bounce at 0.85m
        v += 0.18 * Math.exp(-Math.pow((binDist - floorBounce) / 0.09, 2));

        // 4. Dynamic Moving Obstacle (approaching / surging target)
        if (detected) {
          v = Math.max(v, 0.94 * Math.exp(-Math.pow((binDist - simTargetDist) / 0.06, 2)));
        }

        // 5. Room Multipath / Reverberation (if clutter mode toggled)
        if (simIsCluttered) {
          v = Math.max(v, 0.65 * Math.exp(-Math.pow((binDist - 1.95) / 0.08, 2)));
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
    if (mappingView === 'SLAM') {
      drawSlamMap();
    } else {
      drawWaterfall();
    }
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

  // ---------------------------------------------------- 3. Grayscale Environmental Waterfall & 2D SLAM
  function drawWaterfall() {
    const w = waterfallCanvas.width;
    const h = waterfallCanvas.height;
    if (w === 0 || h === 0 || waterfallBuffer.length === 0) return;

    waterfallCtx.clearRect(0, 0, w, h);
    waterfallCtx.fillStyle = '#FFFFFF';
    waterfallCtx.fillRect(0, 0, w, h);

    const padLeft = 40;
    const padRight = 16;
    const padTop = 22;
    const padBottom = 16;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    // Outer framing box
    waterfallCtx.lineWidth = 1;
    waterfallCtx.strokeStyle = '#000000';
    waterfallCtx.strokeRect(padLeft, padTop, plotW, plotH);

    // Top range axis markers (0.0 to 3.0 m)
    for (let m = 0; m <= 3.0; m += 0.5) {
      const x = padLeft + (m / 3.0) * plotW;
      waterfallCtx.beginPath();
      waterfallCtx.moveTo(x, padTop - 4);
      waterfallCtx.lineTo(x, padTop);
      waterfallCtx.strokeStyle = '#000000';
      waterfallCtx.stroke();

      waterfallCtx.fillStyle = '#525252';
      waterfallCtx.font = '500 9px "JetBrains Mono", monospace';
      waterfallCtx.textAlign = 'center';
      waterfallCtx.fillText(`${m.toFixed(1)}m`, x, padTop - 6);
    }

    // Left time history axis markers (0s to -10s)
    const timeSteps = [0, 2, 4, 6, 8, 10];
    timeSteps.forEach(sec => {
      const y = padTop + (sec / 10.0) * plotH;
      waterfallCtx.beginPath();
      waterfallCtx.moveTo(padLeft - 4, y);
      waterfallCtx.lineTo(padLeft, y);
      waterfallCtx.strokeStyle = '#000000';
      waterfallCtx.stroke();

      waterfallCtx.fillStyle = '#525252';
      waterfallCtx.font = '500 8px "JetBrains Mono", monospace';
      waterfallCtx.textAlign = 'right';
      waterfallCtx.fillText(sec === 0 ? '0s' : `-${sec}s`, padLeft - 6, y + 3);
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

    // Static Room Feature Callout Lines
    const wallX = padLeft + (2.35 / 3.0) * plotW;
    waterfallCtx.setLineDash([2, 4]);
    waterfallCtx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    waterfallCtx.beginPath();
    waterfallCtx.moveTo(wallX, padTop);
    waterfallCtx.lineTo(wallX, padTop + plotH);
    waterfallCtx.stroke();

    const fixtureX = padLeft + (1.55 / 3.0) * plotW;
    waterfallCtx.beginPath();
    waterfallCtx.moveTo(fixtureX, padTop);
    waterfallCtx.lineTo(fixtureX, padTop + plotH);
    waterfallCtx.stroke();
    waterfallCtx.setLineDash([]);

    // Feature tags
    waterfallCtx.fillStyle = '#000000';
    waterfallCtx.font = '700 8px "JetBrains Mono", monospace';
    waterfallCtx.textAlign = 'center';
    waterfallCtx.fillText('WALL (2.35m)', wallX, padTop + plotH - 6);
    waterfallCtx.fillText('FIXTURE (1.55m)', fixtureX, padTop + plotH - 6);

    // Dynamic target pointer
    if (latestFrame && latestFrame.target && latestFrame.target.detected && latestFrame.target.distance_m > 0) {
      const d = latestFrame.target.distance_m;
      const targetX = padLeft + (d / 3.0) * plotW;
      waterfallCtx.fillStyle = '#000000';
      waterfallCtx.beginPath();
      waterfallCtx.moveTo(targetX, padTop + 2);
      waterfallCtx.lineTo(targetX - 4, padTop + 8);
      waterfallCtx.lineTo(targetX + 4, padTop + 8);
      waterfallCtx.closePath();
      waterfallCtx.fill();
    }
  }

  // ---------------------------------------------------- 2D Acoustic Room SLAM Map
  function drawSlamMap() {
    if (!slamCanvas || !slamCtx) return;
    const w = slamCanvas.width;
    const h = slamCanvas.height;
    if (w === 0 || h === 0) return;

    slamCtx.clearRect(0, 0, w, h);
    slamCtx.fillStyle = '#FFFFFF';
    slamCtx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h - 22;
    const maxRangeM = 3.0;
    const scaleY = (cy - 34) / maxRangeM;

    // Fine background grid
    slamCtx.lineWidth = 1;
    slamCtx.strokeStyle = '#F5F5F5';
    for (let x = 0; x < w; x += 30) {
      slamCtx.beginPath(); slamCtx.moveTo(x, 0); slamCtx.lineTo(x, h); slamCtx.stroke();
    }
    for (let y = 0; y < h; y += 30) {
      slamCtx.beginPath(); slamCtx.moveTo(0, y); slamCtx.lineTo(w, y); slamCtx.stroke();
    }

    // Outer framing box
    slamCtx.strokeStyle = '#000000';
    slamCtx.strokeRect(0, 0, w, h);

    // Forward acoustic coverage beam cone
    slamCtx.setLineDash([3, 4]);
    slamCtx.strokeStyle = '#D4D4D4';
    [-45, 0, 45].forEach(deg => {
      const rad = (deg - 90) * (Math.PI / 180);
      slamCtx.beginPath();
      slamCtx.moveTo(cx, cy);
      slamCtx.lineTo(cx + Math.cos(rad) * (cy - 30), cy + Math.sin(rad) * (cy - 30));
      slamCtx.stroke();
    });

    // Range distance arc circles (1m, 2m, 3m)
    [1.0, 2.0, 3.0].forEach(r => {
      const rad = r * scaleY;
      slamCtx.beginPath();
      slamCtx.arc(cx, cy, rad, Math.PI, 2 * Math.PI);
      slamCtx.stroke();

      slamCtx.fillStyle = '#888888';
      slamCtx.font = '500 8px "JetBrains Mono", monospace';
      slamCtx.textAlign = 'left';
      slamCtx.fillText(`${r.toFixed(1)}m`, cx + 8, cy - rad + 3);
    });
    slamCtx.setLineDash([]);

    // 1. Reconstructed Front Wall Boundary at 2.35m
    const wallY = cy - (2.35 * scaleY);
    const doorLeft = cx - 30;
    const doorRight = cx + 25;
    const wallLeft = cx - 130;
    const wallRight = cx + 130;

    // Left wall segment
    slamCtx.lineWidth = 3;
    slamCtx.strokeStyle = '#000000';
    slamCtx.beginPath();
    slamCtx.moveTo(wallLeft, wallY);
    slamCtx.lineTo(doorLeft, wallY);
    slamCtx.stroke();

    // Right wall segment
    slamCtx.beginPath();
    slamCtx.moveTo(doorRight, wallY);
    slamCtx.lineTo(wallRight, wallY);
    slamCtx.stroke();

    // Doorway opening indicator
    slamCtx.setLineDash([2, 2]);
    slamCtx.lineWidth = 1;
    slamCtx.strokeStyle = '#737373';
    slamCtx.beginPath();
    slamCtx.moveTo(doorLeft, wallY);
    slamCtx.lineTo(doorRight, wallY);
    slamCtx.stroke();
    slamCtx.setLineDash([]);

    slamCtx.fillStyle = '#000000';
    slamCtx.font = '700 8px "JetBrains Mono", monospace';
    slamCtx.textAlign = 'center';
    slamCtx.fillText('DOORWAY (0.8m APERTURE)', (doorLeft + doorRight) / 2, wallY - 6);
    slamCtx.fillText('FRONT WALL (2.35m CONCRETE)', wallLeft + 40, wallY - 6);

    // Lateral walls
    slamCtx.lineWidth = 2;
    slamCtx.beginPath();
    slamCtx.moveTo(wallLeft, wallY);
    slamCtx.lineTo(wallLeft, cy - 10);
    slamCtx.moveTo(wallRight, wallY);
    slamCtx.lineTo(wallRight, cy - 10);
    slamCtx.stroke();

    // 2. Corner Desk / Pillar Fixture at 1.55m
    const fixtureY = cy - (1.55 * scaleY);
    const fixtureX = cx - 75;
    slamCtx.strokeRect(fixtureX - 16, fixtureY - 12, 32, 24);
    slamCtx.fillStyle = '#000000';
    slamCtx.fillText('DESK (1.55m)', fixtureX, fixtureY + 22);

    // 3. Dynamic Detected Obstacle
    if (latestFrame && latestFrame.target && latestFrame.target.detected && latestFrame.target.distance_m > 0) {
      const d = latestFrame.target.distance_m;
      const targetY = cy - (d * scaleY);
      const targetX = cx + (Math.sin(Date.now() * 0.001) * 20); // Dynamic lateral walk

      // Target Crosshair
      slamCtx.lineWidth = 1.5;
      slamCtx.strokeStyle = '#000000';
      slamCtx.beginPath();
      slamCtx.moveTo(targetX - 10, targetY); slamCtx.lineTo(targetX + 10, targetY);
      slamCtx.moveTo(targetX, targetY - 10); slamCtx.lineTo(targetX, targetY + 10);
      slamCtx.stroke();

      slamCtx.beginPath();
      slamCtx.arc(targetX, targetY, 4, 0, Math.PI * 2);
      slamCtx.fillStyle = '#000000';
      slamCtx.fill();

      // Velocity approach vector
      slamCtx.beginPath();
      slamCtx.moveTo(targetX, targetY);
      slamCtx.lineTo(targetX, targetY + 18);
      slamCtx.stroke();

      // Target Callout Badge
      const label = `TARGET: ${d.toFixed(2)}m [APPROACHING]`;
      slamCtx.font = '700 9px "JetBrains Mono", monospace';
      const tw = slamCtx.measureText(label).width;
      slamCtx.fillStyle = '#000000';
      slamCtx.fillRect(targetX + 12, targetY - 9, tw + 10, 18);
      slamCtx.fillStyle = '#FFFFFF';
      slamCtx.textAlign = 'left';
      slamCtx.fillText(label, targetX + 17, targetY + 4);
    }

    // Phone / Emitter Origin
    slamCtx.fillStyle = '#000000';
    slamCtx.fillRect(cx - 6, cy - 6, 12, 12);
    slamCtx.fillStyle = '#000000';
    slamCtx.font = '700 9px "JetBrains Mono", monospace';
    slamCtx.textAlign = 'center';
    slamCtx.fillText('iQOO 15 (TRANSDUCER)', cx, cy + 16);

    // Scale Bar & Legend at Bottom Left
    slamCtx.lineWidth = 2;
    slamCtx.beginPath();
    slamCtx.moveTo(14, h - 14);
    slamCtx.lineTo(14 + scaleY, h - 14);
    slamCtx.stroke();
    slamCtx.font = '500 8px "JetBrains Mono", monospace';
    slamCtx.textAlign = 'left';
    slamCtx.fillText('1.0m SCALE', 14, h - 20);

    // Status Tag at Top Right
    slamCtx.font = '700 8px "JetBrains Mono", monospace';
    slamCtx.textAlign = 'right';
    slamCtx.fillText('2D ACOUSTIC ROOM SLAM // 3.5cm RESOLUTION', w - 12, 14);
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
