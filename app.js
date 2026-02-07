const rows = 8;
const cols = 12;
const field = document.getElementById("routingField");

const ui = {
  inLevel: document.getElementById("inLevel"),
  outLevel: document.getElementById("outLevel"),
  lossLevel: document.getElementById("lossLevel"),
  amp: document.getElementById("amp"),
  dens: document.getElementById("dens"),
  jitter: document.getElementById("jitter"),
  clip: document.getElementById("clip"),
  impulse: document.getElementById("impulse"),
  noise: document.getElementById("noise"),
  extin: document.getElementById("extin"),
  micState: document.getElementById("micState"),
  micLevel: document.getElementById("micLevel"),
  micFill: document.getElementById("micFill"),
  micPeak: document.getElementById("micPeak"),
  fault: document.getElementById("fault"),
  faultActual: document.getElementById("faultActual"),
  clock: document.getElementById("clock"),
  audioState: document.getElementById("audioState"),
  modeLabel: document.getElementById("modeLabel"),
};

const controls = {
  rateDivider: document.getElementById("rateDivider"),
  phaseOffset: document.getElementById("phaseOffset"),
  mutationSeed: document.getElementById("mutationSeed"),
  extSource: document.getElementById("extSource"),
  micArm: document.getElementById("micArm"),
  threshold: document.getElementById("threshold"),
  limiter: document.getElementById("limiter"),
  routeWeight: document.getElementById("routeWeight"),
  drive: document.getElementById("drive"),
  spaceMix: document.getElementById("spaceMix"),
  spaceFeedback: document.getElementById("spaceFeedback"),
  lockRegister: document.getElementById("lockRegister"),
  faultProfile: document.getElementById("faultProfile"),
  faultIntensity: document.getElementById("faultIntensity"),
  faultAuto: document.getElementById("faultAuto"),
  routingMode: document.getElementById("routingMode"),
  snapshotSlot: document.getElementById("snapshotSlot"),
  snapshotWrite: document.getElementById("snapshotWrite"),
  snapshotRecall: document.getElementById("snapshotRecall"),
  snapshotPurge: document.getElementById("snapshotPurge"),
  snapshotExport: document.getElementById("snapshotExport"),
  snapshotImport: document.getElementById("snapshotImport"),
  snapshotImportFile: document.getElementById("snapshotImportFile"),
  snapshotMergeImport: document.getElementById("snapshotMergeImport"),
};

const cells = [];
const snapshotState = document.getElementById("snapshotState");
let clipMs = 0;
let peak = 0;
let tick = 0;
let prevOut = 0;
let audioEngine = null;
let micInput = null;
let lastDriveValue = -1;
let micPeakHold = 0;
const telemetryMemory = { density: 0, jitter: 0, inLevel: 0, overloaded: false };
const snapshotStore = { "1": null, "2": null, "3": null };
const snapshotStorageKey = "signal-lattice-snapshots-v1";
const snapshotSchema = "signal-lattice-snapshot-pack-v1";

function seedNoise(seed) {
  let x = Math.sin(seed * 999) * 10000;
  return x - Math.floor(x);
}

function buildGrid() {
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.type = "button";
      const active = (r + c) % 5 === 0;
      cell.dataset.active = active ? "1" : "0";
      cell.textContent = active ? "01" : "00";

      cell.addEventListener("click", () => {
        if (controls.lockRegister.checked) return;
        const next = cell.dataset.active === "1" ? "0" : "1";
        cell.dataset.active = next;
        cell.textContent = next === "1" ? "01" : "00";
      });

      cells.push(cell);
      field.appendChild(cell);
    }
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setSnapshotState(text) {
  snapshotState.textContent = text;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidSnapshotPayload(payload) {
  if (!isPlainObject(payload)) return false;
  if (!isPlainObject(payload.controls)) return false;
  if (!Array.isArray(payload.matrix) || payload.matrix.length !== cells.length) return false;
  return true;
}

function makeDriveCurve(amount) {
  const k = clamp(amount, 0, 800);
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function sampleMicLevel() {
  if (!micInput || !micInput.analyser) return 0;
  const analyser = micInput.analyser;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const centered = (data[i] - 128) / 128;
    sum += centered * centered;
  }
  const rms = Math.sqrt(sum / data.length);
  return clamp(rms * 3.2, 0, 1);
}

function resolveFaultProfile(selectedProfile, autoEnabled, intensity) {
  if (!autoEnabled) return selectedProfile;

  const pressure =
    (telemetryMemory.overloaded ? 1 : 0) +
    (telemetryMemory.jitter > 0.12 ? 1 : 0) +
    (telemetryMemory.density > 0.5 ? 1 : 0) +
    (telemetryMemory.inLevel > 0.6 ? 1 : 0);

  if (pressure >= 3 || (intensity > 0.75 && telemetryMemory.jitter > 0.16)) return "31";
  if (pressure >= 2) return "21";
  if (pressure >= 1) return "11";
  return "00";
}

function getActiveMap() {
  return cells.map((cell) => (cell.dataset.active === "1" ? 1 : 0));
}

function applyActiveMap(map) {
  for (let i = 0; i < cells.length; i += 1) {
    const value = map[i] ? "1" : "0";
    cells[i].dataset.active = value;
    cells[i].textContent = value === "1" ? "01" : "00";
  }
}

function createSnapshot() {
  return {
    controls: {
      rateDivider: Number(controls.rateDivider.value),
      phaseOffset: Number(controls.phaseOffset.value),
      mutationSeed: Number(controls.mutationSeed.value),
      extSource: controls.extSource.value,
      threshold: Number(controls.threshold.value),
      limiter: Number(controls.limiter.value),
      routeWeight: Number(controls.routeWeight.value),
      drive: Number(controls.drive.value),
      spaceMix: Number(controls.spaceMix.value),
      spaceFeedback: Number(controls.spaceFeedback.value),
      faultProfile: controls.faultProfile.value,
      faultIntensity: Number(controls.faultIntensity.value),
      faultAuto: controls.faultAuto.checked,
      routingMode: controls.routingMode.value,
      lockRegister: controls.lockRegister.checked,
    },
    matrix: getActiveMap(),
  };
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  const state = snapshot.controls || {};
  controls.rateDivider.value = String(clamp(Number(state.rateDivider) || 1, 1, 16));
  controls.phaseOffset.value = String(clamp(Number(state.phaseOffset) || 0, 0, 31));
  controls.mutationSeed.value = String(clamp(Number(state.mutationSeed) || 0, 0, 999));
  controls.extSource.value = state.extSource === "MIC" ? "MIC" : "SYN";
  controls.threshold.value = String(clamp(Number(state.threshold) || 0.35, 0, 1));
  controls.limiter.value = String(clamp(Number(state.limiter) || 0.8, 0, 1));
  controls.routeWeight.value = String(clamp(Number(state.routeWeight) || 160, 0, 255));
  controls.drive.value = String(clamp(Number(state.drive) || 28, 0, 100));
  controls.spaceMix.value = String(clamp(Number(state.spaceMix) || 18, 0, 100));
  controls.spaceFeedback.value = String(clamp(Number(state.spaceFeedback) || 24, 0, 95));
  controls.faultProfile.value = ["00", "11", "21", "31"].includes(state.faultProfile) ? state.faultProfile : "00";
  controls.faultIntensity.value = String(clamp(Number(state.faultIntensity) || 55, 0, 100));
  controls.faultAuto.checked = Boolean(state.faultAuto);
  controls.routingMode.value = ["A", "B", "C"].includes(state.routingMode) ? state.routingMode : "A";
  controls.lockRegister.checked = Boolean(state.lockRegister);
  if (Array.isArray(snapshot.matrix) && snapshot.matrix.length === cells.length) {
    applyActiveMap(snapshot.matrix);
  }
}

function persistSnapshots() {
  try {
    localStorage.setItem(snapshotStorageKey, JSON.stringify(snapshotStore));
  } catch (_err) {
    setSnapshotState("STORAGE FAIL");
  }
}

function restoreSnapshots() {
  try {
    const raw = localStorage.getItem(snapshotStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    for (const slot of ["1", "2", "3"]) {
      if (parsed && parsed[slot]) {
        snapshotStore[slot] = parsed[slot];
      }
    }
  } catch (_err) {
    setSnapshotState("RESTORE FAIL");
  }
}

function bindSnapshotActions() {
  controls.snapshotWrite.addEventListener("click", () => {
    const slot = controls.snapshotSlot.value || "1";
    snapshotStore[slot] = createSnapshot();
    persistSnapshots();
    setSnapshotState(`WROTE ${slot.padStart(2, "0")}`);
  });

  controls.snapshotRecall.addEventListener("click", () => {
    const slot = controls.snapshotSlot.value || "1";
    const snapshot = snapshotStore[slot];
    if (!snapshot) {
      setSnapshotState(`EMPTY ${slot.padStart(2, "0")}`);
      return;
    }
    applySnapshot(snapshot);
    setSnapshotState(`RECALL ${slot.padStart(2, "0")}`);
  });

  controls.snapshotPurge.addEventListener("click", () => {
    const slot = controls.snapshotSlot.value || "1";
    snapshotStore[slot] = null;
    persistSnapshots();
    setSnapshotState(`PURGED ${slot.padStart(2, "0")}`);
  });

  controls.snapshotExport.addEventListener("click", () => {
    try {
      const payload = {
        schema: snapshotSchema,
        exportedAt: new Date().toISOString(),
        slots: snapshotStore,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `signal-lattice-snapshots-${stamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSnapshotState("EXPORT OK");
    } catch (_err) {
      setSnapshotState("EXPORT FAIL");
    }
  });

  controls.snapshotImport.addEventListener("click", () => {
    controls.snapshotImportFile.click();
  });

  controls.snapshotImportFile.addEventListener("change", async (event) => {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || parsed.schema !== snapshotSchema) {
        setSnapshotState("SCHEMA FAIL");
        input.value = "";
        return;
      }

      const slots = parsed && parsed.slots ? parsed.slots : null;
      if (!slots || typeof slots !== "object") {
        setSnapshotState("IMPORT FAIL");
        input.value = "";
        return;
      }

      const mergeMode = controls.snapshotMergeImport.checked;
      if (!mergeMode) {
        for (const slot of ["1", "2", "3"]) {
          snapshotStore[slot] = null;
        }
      }

      for (const slot of ["1", "2", "3"]) {
        const incoming = slots[slot] || null;
        if (!incoming) {
          if (!mergeMode) snapshotStore[slot] = null;
          continue;
        }
        if (!isValidSnapshotPayload(incoming)) {
          setSnapshotState(`SLOT ${slot.padStart(2, "0")} FAIL`);
          input.value = "";
          return;
        }
        snapshotStore[slot] = incoming;
      }
      persistSnapshots();
      setSnapshotState(mergeMode ? "IMPORT MERGE" : "IMPORT REPLACE");
    } catch (_err) {
      setSnapshotState("IMPORT FAIL");
    } finally {
      input.value = "";
    }
  });
}

function initAudio() {
  if (audioEngine || !window.AudioContext) {
    return;
  }

  const ctx = new AudioContext();
  const master = ctx.createGain();
  const inputBus = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const driveGain = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const delayNode = ctx.createDelay(1.2);
  const feedbackGain = ctx.createGain();
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();

  master.gain.value = 0.0001;
  inputBus.gain.value = 1;
  driveGain.gain.value = 1;
  shaper.curve = makeDriveCurve(120);
  shaper.oversample = "4x";
  dryGain.gain.value = 0.82;
  wetGain.gain.value = 0.18;
  delayNode.delayTime.value = 0.14;
  feedbackGain.gain.value = 0.24;
  filter.type = "bandpass";
  filter.frequency.value = 220;
  filter.Q.value = 6;

  oscA.type = "sawtooth";
  oscA.frequency.value = 110;
  oscB.type = "square";
  oscB.frequency.value = 55;

  oscA.connect(inputBus);
  oscB.connect(inputBus);
  inputBus.connect(filter);
  filter.connect(driveGain);
  driveGain.connect(shaper);
  shaper.connect(dryGain);
  dryGain.connect(master);
  shaper.connect(delayNode);
  delayNode.connect(wetGain);
  wetGain.connect(master);
  delayNode.connect(feedbackGain);
  feedbackGain.connect(delayNode);
  master.connect(ctx.destination);

  oscA.start();
  oscB.start();

  audioEngine = {
    ctx,
    master,
    inputBus,
    filter,
    driveGain,
    shaper,
    dryGain,
    wetGain,
    delayNode,
    feedbackGain,
    oscA,
    oscB,
  };
  ui.audioState.textContent = "LIVE";
}

async function armMicInput() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    ui.micState.textContent = "N/A";
    return;
  }

  try {
    initAudio();
    if (audioEngine && audioEngine.ctx.state === "suspended") {
      await audioEngine.ctx.resume();
    }
    if (micInput && micInput.stream) {
      ui.micState.textContent = "LIVE";
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const source = audioEngine.ctx.createMediaStreamSource(stream);
    const analyser = audioEngine.ctx.createAnalyser();
    const micGain = audioEngine.ctx.createGain();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.85;
    micGain.gain.value = 0.8;

    source.connect(analyser);
    analyser.connect(micGain);
    micGain.connect(audioEngine.inputBus);

    micInput = { stream, source, analyser, micGain };
    ui.micState.textContent = "LIVE";
  } catch (_err) {
    ui.micState.textContent = "DENY";
  }
}

function armAudioOnce() {
  if (!window.AudioContext) {
    ui.audioState.textContent = "N/A";
    return;
  }

  initAudio();
  if (audioEngine && audioEngine.ctx.state === "suspended") {
    audioEngine.ctx.resume();
  }
}

document.addEventListener("pointerdown", armAudioOnce, { once: true });
document.addEventListener("keydown", armAudioOnce, { once: true });
controls.micArm.addEventListener("click", armMicInput);

function frame() {
  tick += 1;

  const rateDivider = clamp(Number(controls.rateDivider.value) || 1, 1, 16);
  const phaseOffset = clamp(Number(controls.phaseOffset.value) || 0, 0, 31);
  const threshold = clamp(Number(controls.threshold.value) || 0.35, 0, 1);
  const limiter = clamp(Number(controls.limiter.value) || 0.8, 0, 1);
  const routeWeight = clamp(Number(controls.routeWeight.value) || 160, 0, 255) / 255;
  const drive = clamp(Number(controls.drive.value) || 28, 0, 100) / 100;
  const spaceMix = clamp(Number(controls.spaceMix.value) || 18, 0, 100) / 100;
  const spaceFeedback = clamp(Number(controls.spaceFeedback.value) || 24, 0, 95) / 100;
  const seed = Number(controls.mutationSeed.value) || 0;
  const extSource = controls.extSource.value || "SYN";
  const selectedFaultProfile = controls.faultProfile.value || "00";
  const faultIntensity = clamp(Number(controls.faultIntensity.value) || 55, 0, 100) / 100;
  const faultProfile = resolveFaultProfile(selectedFaultProfile, controls.faultAuto.checked, faultIntensity);
  const mode = controls.routingMode.value || "A";

  const impulse = ((tick + phaseOffset) % (rateDivider * 2) === 0) ? 1 : 0;
  const noise = seedNoise(seed + tick * 0.07);
  const extSynthetic = seedNoise(seed * 0.31 + tick * 0.03);
  const extMic = sampleMicLevel();
  const extIn = extSource === "MIC" ? extMic : extSynthetic;
  micPeakHold = Math.max(extMic, micPeakHold * 0.94);
  const drift = (seedNoise(seed * 0.77 + tick * 0.02) - 0.5) * (0.14 + faultIntensity * 0.46);
  const thresholdUsed = clamp(threshold + (faultProfile === "21" ? drift : 0), 0, 1);
  const burstGate = 0.97 - faultIntensity * 0.08;
  const burst = faultProfile === "31" && seedNoise(seed + tick * 0.19) > burstGate ? 1 : 0;

  let activeCount = 0;
  let weightedSum = 0;

  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i];
    const row = Math.floor(i / cols);
    const col = i % cols;
    const baseActive = c.dataset.active === "1";
    const mutation = seedNoise(seed + i * 0.13 + tick * 0.02) > 0.92;
    const diagonalGate = ((row + col + tick + phaseOffset) % rateDivider) === 0;
    const phaseGate = ((col + tick) % Math.max(2, rateDivider)) < Math.max(1, Math.floor(rateDivider / 2));
    let hot = false;

    if (mode === "A") {
      hot = baseActive && (impulse > 0 || mutation || extIn > thresholdUsed);
    } else if (mode === "B") {
      hot = baseActive && (diagonalGate || extIn > thresholdUsed * 0.8) && noise > 0.18;
    } else {
      hot = baseActive && (mutation || (impulse > 0 && phaseGate) || extIn > thresholdUsed * 0.6);
      if (((tick + row) % (rateDivider + 1)) === 0 && noise > 0.4) {
        hot = !hot;
      }
    }

    if (faultProfile === "11") {
      hot = hot && seedNoise(seed + tick * 0.11 + i * 0.23) > (0.15 + faultIntensity * 0.35);
    } else if (faultProfile === "31" && burst === 1 && baseActive && i % 3 === tick % 3) {
      hot = true;
    }

    c.classList.toggle("hot", hot);

    if (hot) {
      activeCount += 1;
      const burstLift = faultProfile === "31" && burst === 1 ? 0.1 + faultIntensity * 0.35 : 0;
      weightedSum += ((noise + extIn + impulse) / 3) + burstLift;
    }
  }

  const density = activeCount / cells.length;
  const inLevel = (impulse * 0.5 + noise * 0.3 + extIn * 0.2);
  let rawOut = (weightedSum / Math.max(activeCount, 1)) * density * routeWeight;
  if (faultProfile === "11") {
    rawOut *= 1 - (0.12 + faultIntensity * 0.28);
  } else if (faultProfile === "21") {
    rawOut *= clamp(0.85 + Math.sin(tick * 0.07) * (0.1 + faultIntensity * 0.2), 0.5, 1.2);
  } else if (faultProfile === "31") {
    rawOut *= 1 + burst * (0.35 + faultIntensity * 0.9);
  }
  const outLevel = clamp(rawOut, 0, limiter);
  const lossLevel = clamp(inLevel - outLevel, 0, 1);

  peak = Math.max(peak, outLevel);
  if (rawOut > limiter) clipMs += 16;

  const jitter = Math.abs(outLevel - prevOut);
  prevOut = outLevel;

  ui.inLevel.textContent = inLevel.toFixed(2);
  ui.outLevel.textContent = outLevel.toFixed(2);
  ui.lossLevel.textContent = lossLevel.toFixed(2);

  ui.amp.textContent = `${outLevel.toFixed(2)}/${peak.toFixed(2)}`;
  ui.dens.textContent = String(activeCount);
  ui.jitter.textContent = jitter.toFixed(2);
  ui.clip.textContent = `${clipMs} ms`;

  ui.impulse.textContent = impulse.toFixed(2);
  ui.noise.textContent = noise.toFixed(2);
  ui.extin.textContent = extIn.toFixed(2);
  ui.micLevel.textContent = extMic.toFixed(2);
  ui.micFill.style.width = `${(extMic * 100).toFixed(1)}%`;
  ui.micPeak.style.left = `${(micPeakHold * 100).toFixed(1)}%`;
  ui.modeLabel.textContent = mode;
  ui.faultActual.textContent = faultProfile;

  ui.clock.textContent = String(120 + Math.floor(density * 28));
  const overloaded = rawOut > limiter;
  if (faultProfile === "00") {
    ui.fault.textContent = overloaded ? "01" : "00";
  } else if (faultProfile === "11") {
    ui.fault.textContent = overloaded ? "12" : "11";
  } else if (faultProfile === "21") {
    ui.fault.textContent = overloaded ? "22" : "21";
  } else {
    ui.fault.textContent = burst === 1 ? "33" : overloaded ? "32" : "31";
  }

  if (audioEngine) {
    const t = audioEngine.ctx.currentTime;
    let gainTarget = clamp(outLevel * 0.16, 0.0001, 0.22);
    let cutoff = 80 + density * 2600 + threshold * 1200;
    let baseFreq = 40 + routeWeight * 180 + phaseOffset * 2;
    let modFreq = baseFreq * (1 + impulse * 0.5 + jitter);

    if (mode === "A") {
      audioEngine.filter.type = "bandpass";
    } else if (mode === "B") {
      audioEngine.filter.type = "highpass";
      cutoff = 120 + density * 3400;
      baseFreq = 55 + routeWeight * 220 + phaseOffset * 3;
      modFreq = baseFreq * (1 + jitter * 1.4);
    } else {
      audioEngine.filter.type = "lowpass";
      cutoff = 70 + density * 1800 + extIn * 900;
      baseFreq = 30 + routeWeight * 140 + (1 - threshold) * 90;
      modFreq = baseFreq * (1.2 + impulse * 0.7 + noise * 0.6);
    }

    if (faultProfile === "11") {
      gainTarget *= 1 - (0.15 + faultIntensity * 0.35);
      cutoff *= 1 - (0.12 + faultIntensity * 0.3);
    } else if (faultProfile === "21") {
      cutoff *= clamp(1 + drift, 0.65, 1.45);
      modFreq *= clamp(1 + drift * (0.4 + faultIntensity), 0.7, 1.4);
    } else if (faultProfile === "31" && burst === 1) {
      gainTarget = clamp(gainTarget * (1.15 + faultIntensity * 0.5), 0.0001, 0.22);
      cutoff *= 1.1 + faultIntensity * 0.4;
      modFreq *= 1.05 + faultIntensity * 0.45;
    }

    audioEngine.master.gain.setTargetAtTime(gainTarget, t, 0.05);
    audioEngine.filter.frequency.setTargetAtTime(cutoff, t, 0.05);
    audioEngine.filter.Q.setTargetAtTime(2 + density * 10, t, 0.07);
    const driveAmount = 40 + drive * 620;
    if (Math.abs(driveAmount - lastDriveValue) > 2) {
      audioEngine.shaper.curve = makeDriveCurve(driveAmount);
      lastDriveValue = driveAmount;
    }
    audioEngine.driveGain.gain.setTargetAtTime(0.8 + drive * 1.5, t, 0.05);
    const wet = clamp(spaceMix + (faultProfile === "31" && burst === 1 ? 0.16 : 0), 0, 0.95);
    audioEngine.wetGain.gain.setTargetAtTime(wet, t, 0.06);
    audioEngine.dryGain.gain.setTargetAtTime(1 - wet, t, 0.06);
    audioEngine.feedbackGain.gain.setTargetAtTime(
      clamp(spaceFeedback + density * 0.18 - jitter * 0.1, 0, 0.93),
      t,
      0.06,
    );
    audioEngine.delayNode.delayTime.setTargetAtTime(
      clamp(0.06 + density * 0.22 + jitter * 0.12, 0.04, 0.55),
      t,
      0.06,
    );
    audioEngine.oscA.frequency.setTargetAtTime(baseFreq, t, 0.05);
    audioEngine.oscB.frequency.setTargetAtTime(modFreq, t, 0.05);
  }

  telemetryMemory.density = density;
  telemetryMemory.jitter = jitter;
  telemetryMemory.inLevel = inLevel;
  telemetryMemory.overloaded = overloaded;
}

buildGrid();
restoreSnapshots();
bindSnapshotActions();
setInterval(frame, 120);
