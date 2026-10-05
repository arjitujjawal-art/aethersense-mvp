// AetherSense Observatory // Frontend Telemetry Client & Renderer
(function() {
  'use strict';

  // Config & State
  const params = new URLSearchParams(window.location.search);
  const wsUrl = params.get('ws') || 'ws://127.0.0.1:8080/telemetry';

  let ws = null;
  let isSimulating = false;
  let simInterval = null;

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

  // DOM Elements
  const elConnBadge = document.getElementById('conn-badge');
  const elFpsMeter = document.getElementById('fps-meter');
  const elTargetReadout = document.getElementById('target-readout');
  const elHudStatus = document.getElementById('hud-status');
  const elHudConn = document.getElementById('hud-conn');
  const elHudLatency = document.getElementById('hud-latency');
  const elHudPsr = document.getElementById('hud-psr');
  const elHudBuffer = document.getElementById('hud-buffer');
  const elHapticLevel = document.getElementById('haptic-level');
  const elHapticDesc = document.getElementById('haptic-desc');
  const elAccelVal = document.getElementById('accel-val');
  const elTripwireBadge = document.getElementById('tripwire-badge');
  const elImpactOverlay = document.getElementById('impact-overlay');
  const elImpactStats = document.getElementById('impact-stats');

  // Toolbar Buttons
  const btnSimToggle = document.getElementById('btn-sim-toggle');
  const btnTestApproach = document.getElementById('btn-test-approach');
  const btnTestImpact = document.getElementById('btn-test-impact');
  const btnTestClutter = document.getElementById('btn-test-clutter');
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
  const imuCanvas = document.getElementById('imuSparkline');
  const imuCtx = imuCanvas.getContext('2d');

  function resizeCanvases() {
    [radarCanvas, scopeCanvas, waterfallCanvas, imuCanvas].forEach(c => {
      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
    });
  }
  window.addEventListener('resize', resizeCanvases);
  resizeCanvases();

  // ---------------------------------------------------- Simulation State
  let simTargetDist = 1.45;
  let simDistDir = -0.012;
  let simIsCluttered = false;
  let simImpactTriggered = false;

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

    simTargetDist += simDistDir;
    if (simTargetDist < 0.45) { simDistDir = 0.015; }
    else if (simTargetDist > 2.2) { simDistDir = -0.015; }

    const detected = simTargetDist < 2.0;
    const threat = simIsCluttered ? 'UNCERTAIN' :
      (!detected ? 'CLEAR' : (simTargetDist < 0.7 ? 'HAZARD' : (simTargetDist < 1.2 ? 'WARNING' : 'CAUTION')));

    // 100-point curve across 0.0 to 3.0 m
    const curve = new Array(100).fill(0).map((_, i) => {
      const binDist = (i / 100) * 3.0;
      let v = Math.random() * 0.03;
      if (binDist < 0.3) v = 0.0; // blanked
      if (detected && Math.abs(binDist - simTargetDist) < 0.16) {
        v = 0.88 * Math.exp(-Math.pow((binDist - simTargetDist) / 0.06, 2));
      }
      if (simIsCluttered && Math.abs(binDist - 1.85) < 0.16) {
        v = Math.max(v, 0.72 * Math.exp(-Math.pow((binDist - 1.85) / 0.06, 2)));
      }
      return v;
    });

    const frame = {
      timestamp: Date.now(),
      status: simIsCluttered ? 'UNCERTAIN' : (detected ? 'TRACKING' : 'SEARCHING'),
      target: {
        detected: detected,
        distance_m: detected ? simTargetDist : -1,
        confidence_psr: detected ? 6.8 + Math.random() * 1.2 : 2.1,
        threat_level: threat,
        velocity_mps: simDistDir * 10
      },
      imu: {
        acc_magnitude: 9.81 + (Math.random() - 0.5) * 0.3,
        is_impact: false
      },
      telemetry: {
        dsp_latency_ms: 12.8 + Math.random() * 1.5,
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
  }

  // ---------------------------------------------------- WebSocket
  let wsTimeout = null;

  function connectWs() {
    elConnBadge.textContent = 'CONNECTING TO PHONE (127.0.0.1:8080)...';
    elConnBadge.className = 'badge badge-disconnected';
    elHudConn.textContent = '127.0.0.1:8080 (WS)';

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      fallbackToSim();
      return;
    }

    // Auto-fallback to simulation after 1.5s if phone not connected
    wsTimeout = setTimeout(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log('No local phone connected on ws://127.0.0.1:8080. Running Interactive Simulator.');
        startSimulator();
      }
    }, 1500);

    ws.onopen = () => {
      clearTimeout(wsTimeout);
      isSimulating = false;
      elConnBadge.textContent = 'LIVE PHONE CONNECTED (OFFLINE BRIDGE)';
      elConnBadge.className = 'badge badge-connected';
      btnSimToggle.textContent = 'MODE: LIVE HARDWARE BRIDGE';
      btnSimToggle.classList.remove('active');
    };

    ws.onclose = () => {
      if (!isSimulating) {
        fallbackToSim();
      }
    };

    ws.onerror = () => {
      if (!isSimulating) {
        fallbackToSim();
      }
    };

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
  }

  // ---------------------------------------------------- HUD Update
  function updateHud(f) {
    if (!f) return;

    elHudStatus.textContent = f.status || 'ACTIVE';
    elHudStatus.className = 'hud-val ' + (f.status === 'TRACKING' ? 'text-green' : (f.status === 'IMPACT_ALERT' ? 'text-red' : 'text-cyan'));

    if (f.telemetry) {
      elHudLatency.textContent = `${f.telemetry.dsp_latency_ms.toFixed(1)} ms`;
      elHudBuffer.textContent = `${f.telemetry.underruns} UNDERRUNS`;
    }

    if (f.target) {
      elHudPsr.textContent = f.target.confidence_psr > 0 ? f.target.confidence_psr.toFixed(1) : '--';
      if (f.target.detected && f.target.distance_m > 0) {
        const d = f.target.distance_m;
        const threat = f.target.threat_level || 'CLEAR';
        elTargetReadout.textContent = `TARGET: ${d.toFixed(2)} m (${threat})`;
        elTargetReadout.style.color = d < 0.8 ? 'var(--accent-red)' : (d <= 1.5 ? 'var(--accent-amber)' : 'var(--accent-green)');
      } else {
        elTargetReadout.textContent = f.status === 'UNCERTAIN' ? 'UNCERTAIN / CLUTTERED' : 'SEARCHING (NO TARGET)';
        elTargetReadout.style.color = 'var(--text-muted)';
      }
    }

    const threat = (f.target && f.target.threat_level) || 'CLEAR';
    updateHapticDisplay(threat, f.target ? f.target.distance_m : -1);

    if (f.imu) {
      elAccelVal.textContent = `${f.imu.acc_magnitude.toFixed(2)} m/s²`;
      if (f.imu.is_impact || f.status === 'IMPACT_ALERT') {
        elTripwireBadge.textContent = 'TRIGGERED / IMPACT!';
        elTripwireBadge.className = 'badge badge-impact';
        elImpactOverlay.classList.remove('hidden');
        elImpactStats.textContent = `PEAK IMPACT: ${f.imu.acc_magnitude.toFixed(1)} m/s²`;
      } else {
        elTripwireBadge.textContent = 'ARMED / SECURE';
        elTripwireBadge.className = 'badge badge-armed';
        elImpactOverlay.classList.add('hidden');
      }
    }
  }

  function updateHapticDisplay(threat, distance) {
    elHapticLevel.className = 'haptic-badge ' + ('haptic-' + threat.toLowerCase());
    Object.values(ladderSteps).forEach(el => el && el.classList.remove('active'));

    switch (threat) {
      case 'HAZARD':
        elHapticLevel.textContent = 'HAZARD (RAPID PULSE)';
        elHapticDesc.textContent = '100 ms ON, 80 ms OFF (< 0.7 m)';
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
        elHapticDesc.textContent = 'Soft double-tap warning; clutter / muting';
        break;
      default:
        elHapticLevel.textContent = 'CLEAR (OFF)';
        elHapticDesc.textContent = 'No tactile feedback (> 2.0 m)';
        ladderSteps.CLEAR && ladderSteps.CLEAR.classList.add('active');
        break;
    }
  }

  // ---------------------------------------------------- Interactive Judge Controls
  btnSimToggle.addEventListener('click', () => {
    if (isSimulating) stopSimulator();
    else startSimulator();
  });

  btnTestApproach.addEventListener('click', () => {
    if (!isSimulating) startSimulator();
    simTargetDist = 0.52; // Force to hazard distance immediately
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

    // Simulate free-fall then shock
    let step = 0;
    const impactInterval = setInterval(() => {
      step++;
      if (step <= 3) {
        // Free-fall: 1.2 m/s²
        imuHistory.push(1.2);
      } else {
        // Impact shock: 38.5 m/s²
        imuHistory.push(38.5);
        clearInterval(impactInterval);

        onFrameReceived({
          timestamp: Date.now(),
          status: 'IMPACT_ALERT',
          target: { detected: false, distance_m: -1, confidence_psr: 0, threat_level: 'IMPACT', velocity_mps: 0 },
          imu: { acc_magnitude: 38.5, is_impact: true },
          telemetry: { dsp_latency_ms: 0, audio_sample_rate: 48000, cloud_bytes_sec: 0, underruns: 0 },
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

  // ---------------------------------------------------- Render Loop
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
    drawWaterfall();
    drawImu();

    requestAnimationFrame(render);
  }

  // ---------------------------------------------------- 1. Radar
  function drawRadar(time) {
    const w = radarCanvas.width;
    const h = radarCanvas.height;
    if (w === 0 || h === 0) return;

    radarCtx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h * 0.88;
    const maxRadius = Math.min(w * 0.45, h * 0.78);
    const maxRangeM = 2.5;

    radarCtx.save();
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, maxRadius, Math.PI, 2 * Math.PI);
    radarCtx.fillStyle = '#060d17';
    radarCtx.fill();

    const rings = [0.5, 1.0, 1.5, 2.0, 2.5];
    radarCtx.lineWidth = 1;
    rings.forEach(r => {
      const radius = (r / maxRangeM) * maxRadius;
      radarCtx.beginPath();
      radarCtx.arc(cx, cy, radius, Math.PI, 2 * Math.PI);
      radarCtx.strokeStyle = 'rgba(0, 229, 160, 0.2)';
      radarCtx.stroke();

      radarCtx.fillStyle = 'rgba(0, 229, 160, 0.5)';
      radarCtx.font = `${Math.max(10, w * 0.024)}px monospace`;
      radarCtx.fillText(`${r.toFixed(1)}m`, cx + 6, cy - radius + 4);
    });

    [-60, -30, 0, 30, 60].forEach(deg => {
      const rad = (deg - 90) * (Math.PI / 180);
      radarCtx.beginPath();
      radarCtx.moveTo(cx, cy);
      radarCtx.lineTo(cx + Math.cos(rad) * maxRadius, cy + Math.sin(rad) * maxRadius);
      radarCtx.strokeStyle = 'rgba(0, 229, 160, 0.1)';
      radarCtx.stroke();
    });

    sweepAngle = (sweepAngle + 0.035) % (Math.PI * 2);
    const sectorAngle = (Math.sin(sweepAngle) * 0.9 - Math.PI / 2);
    const sweepRadius = maxRadius;

    const grad = radarCtx.createRadialGradient(cx, cy, 0, cx, cy, sweepRadius);
    grad.addColorStop(0, 'rgba(0, 229, 160, 0.3)');
    grad.addColorStop(1, 'rgba(0, 229, 160, 0.0)');

    radarCtx.beginPath();
    radarCtx.moveTo(cx, cy);
    radarCtx.arc(cx, cy, sweepRadius, sectorAngle - 0.25, sectorAngle, false);
    radarCtx.closePath();
    radarCtx.fillStyle = grad;
    radarCtx.fill();

    radarCtx.beginPath();
    radarCtx.arc(cx, cy, 8, 0, Math.PI * 2);
    radarCtx.fillStyle = '#00e5a0';
    radarCtx.fill();
    radarCtx.fillStyle = '#ffffff';
    radarCtx.font = '10px monospace';
    radarCtx.textAlign = 'center';
    radarCtx.fillText('PHONE', cx, cy + 18);

    if (latestFrame && latestFrame.target && latestFrame.target.detected && latestFrame.target.distance_m > 0) {
      const d = latestFrame.target.distance_m;
      const blipRadius = (d / maxRangeM) * maxRadius;
      const blipX = cx;
      const blipY = cy - blipRadius;

      const blipColor = d < 0.8 ? '#ef4444' : (d <= 1.5 ? '#f59e0b' : '#00e5a0');

      radarCtx.beginPath();
      radarCtx.arc(blipX, blipY, 14 + Math.sin(time * 0.01) * 3, 0, Math.PI * 2);
      radarCtx.strokeStyle = blipColor;
      radarCtx.lineWidth = 2;
      radarCtx.stroke();

      radarCtx.beginPath();
      radarCtx.arc(blipX, blipY, 6, 0, Math.PI * 2);
      radarCtx.fillStyle = blipColor;
      radarCtx.fill();

      radarCtx.fillStyle = '#ffffff';
      radarCtx.font = 'bold 12px monospace';
      radarCtx.fillText(`${d.toFixed(2)} m`, blipX + 18, blipY + 4);
    }

    radarCtx.restore();
  }

  // ---------------------------------------------------- 2. Oscilloscope
  function drawScope() {
    const w = scopeCanvas.width;
    const h = scopeCanvas.height;
    if (w === 0 || h === 0) return;

    scopeCtx.clearRect(0, 0, w, h);
    scopeCtx.fillStyle = '#080d16';
    scopeCtx.fillRect(0, 0, w, h);

    const padLeft = 40;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 25;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    scopeCtx.lineWidth = 1;
    scopeCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    for (let m = 0; m <= 3.0; m += 0.5) {
      const x = padLeft + (m / 3.0) * plotW;
      scopeCtx.beginPath();
      scopeCtx.moveTo(x, padTop);
      scopeCtx.lineTo(x, padTop + plotH);
      scopeCtx.stroke();

      scopeCtx.fillStyle = '#64748b';
      scopeCtx.font = '10px monospace';
      scopeCtx.textAlign = 'center';
      scopeCtx.fillText(`${m.toFixed(1)}m`, x, h - 8);
    }

    const blankX = padLeft + (0.3 / 3.0) * plotW;
    scopeCtx.fillStyle = 'rgba(239, 68, 68, 0.08)';
    scopeCtx.fillRect(padLeft, padTop, blankX - padLeft, plotH);
    scopeCtx.fillStyle = 'rgba(239, 68, 68, 0.4)';
    scopeCtx.font = '9px monospace';
    scopeCtx.fillText('BLANKED (0-0.3m)', padLeft + (blankX - padLeft) / 2, padTop + 14);

    const curve = (latestFrame && latestFrame.dsp && latestFrame.dsp.correlation_curve) || null;
    if (curve && curve.length > 0) {
      scopeCtx.beginPath();
      scopeCtx.strokeStyle = '#00e5a0';
      scopeCtx.lineWidth = 2;

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

        scopeCtx.beginPath();
        scopeCtx.arc(peakX, peakY, 5, 0, Math.PI * 2);
        scopeCtx.fillStyle = '#f59e0b';
        scopeCtx.fill();

        scopeCtx.fillStyle = '#f59e0b';
        scopeCtx.font = 'bold 10px monospace';
        scopeCtx.fillText(`Peak: ${d.toFixed(2)}m (PSR: ${latestFrame.target.confidence_psr.toFixed(1)})`, peakX + 8, peakY - 6);
      }
    }
  }

  // ---------------------------------------------------- 3. Waterfall
  function drawWaterfall() {
    const w = waterfallCanvas.width;
    const h = waterfallCanvas.height;
    if (w === 0 || h === 0 || waterfallBuffer.length === 0) return;

    waterfallCtx.clearRect(0, 0, w, h);

    const rows = waterfallBuffer.length;
    const rowH = h / rows;

    for (let r = 0; r < rows; r++) {
      const curve = waterfallBuffer[r];
      const cols = curve.length;
      const colW = w / cols;
      const y = r * rowH;

      for (let c = 0; c < cols; c++) {
        const val = Math.max(0, Math.min(1, curve[c]));
        const intensity = Math.pow(val, 0.7);
        const red = Math.min(255, Math.floor(intensity * 300));
        const green = Math.min(255, Math.floor(intensity * 220));
        const blue = Math.min(255, Math.floor((1 - intensity) * 80 + intensity * 150));

        waterfallCtx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
        waterfallCtx.fillRect(c * colW, y, colW + 1, rowH + 1);
      }
    }
  }

  // ---------------------------------------------------- 4. IMU Sparkline
  function drawImu() {
    const w = imuCanvas.width;
    const h = imuCanvas.height;
    if (w === 0 || h === 0) return;

    imuCtx.clearRect(0, 0, w, h);
    imuCtx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    imuCtx.fillRect(0, 0, w, h);

    const gY = h * 0.65;
    imuCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    imuCtx.setLineDash([4, 4]);
    imuCtx.beginPath();
    imuCtx.moveTo(0, gY);
    imuCtx.lineTo(w, gY);
    imuCtx.stroke();
    imuCtx.setLineDash([]);

    imuCtx.beginPath();
    imuCtx.strokeStyle = '#38bdf8';
    imuCtx.lineWidth = 1.5;

    for (let i = 0; i < imuHistory.length; i++) {
      const x = (i / (imuHistory.length - 1)) * w;
      const val = imuHistory[i];
      const y = h - (val / 40.0) * h;
      if (i === 0) imuCtx.moveTo(x, y);
      else imuCtx.lineTo(x, y);
    }
    imuCtx.stroke();
  }

  // Connect automatically, or auto-fallback to simulator
  connectWs();
  requestAnimationFrame(render);
})();
