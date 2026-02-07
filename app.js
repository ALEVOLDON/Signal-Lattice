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
  threshold: document.getElementById("threshold"),
  limiter: document.getElementById("limiter"),
  routeWeight: document.getElementById("routeWeight"),
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
};

const cells = [];
const snapshotState = document.getElementById("snapshotState");
let clipMs = 0;
let peak = 0;
let tick = 0;
let prevOut = 0;
let audioEngine = null;
const telemetryMemory = { density: 0, jitter: 0, inLevel: 0, overloaded: false };
const snapshotStore = { "1": null, "2": null, "3": null };
const snapshotStorageKey = "signal-lattice-snapshots-v1";

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
      threshold: Number(controls.threshold.value),
      limiter: Number(controls.limiter.value),
      routeWeight: Number(controls.routeWeight.value),
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
  controls.threshold.value = String(clamp(Number(state.threshold) || 0.35, 0, 1));
  controls.limiter.value = String(clamp(Number(state.limiter) || 0.8, 0, 1));
  controls.routeWeight.value = String(clamp(Number(state.routeWeight) || 160, 0, 255));
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
        schema: "signal-lattice-snapshot-pack-v1",
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
      const slots = parsed && parsed.slots ? parsed.slots : null;
      if (!slots || typeof slots !== "object") {
        setSnapshotState("IMPORT FAIL");
        input.value = "";
        return;
      }

      for (const slot of ["1", "2", "3"]) {
        snapshotStore[slot] = slots[slot] || null;
      }
      persistSnapshots();
      setSnapshotState("IMPORT OK");
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
  const filter = ctx.createBiquadFilter();
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();

  master.gain.value = 0.0001;
  filter.type = "bandpass";
  filter.frequency.value = 220;
  filter.Q.value = 6;

  oscA.type = "sawtooth";
  oscA.frequency.value = 110;
  oscB.type = "square";
  oscB.frequency.value = 55;

  oscA.connect(filter);
  oscB.connect(filter);
  filter.connect(master);
  master.connect(ctx.destination);

  oscA.start();
  oscB.start();

  audioEngine = { ctx, master, filter, oscA, oscB };
  ui.audioState.textContent = "LIVE";
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

function frame() {
  tick += 1;

  const rateDivider = clamp(Number(controls.rateDivider.value) || 1, 1, 16);
  const phaseOffset = clamp(Number(controls.phaseOffset.value) || 0, 0, 31);
  const threshold = clamp(Number(controls.threshold.value) || 0.35, 0, 1);
  const limiter = clamp(Number(controls.limiter.value) || 0.8, 0, 1);
  const routeWeight = clamp(Number(controls.routeWeight.value) || 160, 0, 255) / 255;
  const seed = Number(controls.mutationSeed.value) || 0;
  const selectedFaultProfile = controls.faultProfile.value || "00";
  const faultIntensity = clamp(Number(controls.faultIntensity.value) || 55, 0, 100) / 100;
  const faultProfile = resolveFaultProfile(selectedFaultProfile, controls.faultAuto.checked, faultIntensity);
  const mode = controls.routingMode.value || "A";

  const impulse = ((tick + phaseOffset) % (rateDivider * 2) === 0) ? 1 : 0;
  const noise = seedNoise(seed + tick * 0.07);
  const extIn = seedNoise(seed * 0.31 + tick * 0.03);
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
