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
  routingMode: document.getElementById("routingMode"),
};

const cells = [];
let clipMs = 0;
let peak = 0;
let tick = 0;
let prevOut = 0;
let audioEngine = null;

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
  const mode = controls.routingMode.value || "A";

  const impulse = ((tick + phaseOffset) % (rateDivider * 2) === 0) ? 1 : 0;
  const noise = seedNoise(seed + tick * 0.07);
  const extIn = seedNoise(seed * 0.31 + tick * 0.03);

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
      hot = baseActive && (impulse > 0 || mutation || extIn > threshold);
    } else if (mode === "B") {
      hot = baseActive && (diagonalGate || extIn > threshold * 0.8) && noise > 0.18;
    } else {
      hot = baseActive && (mutation || (impulse > 0 && phaseGate) || extIn > threshold * 0.6);
      if (((tick + row) % (rateDivider + 1)) === 0 && noise > 0.4) {
        hot = !hot;
      }
    }

    c.classList.toggle("hot", hot);

    if (hot) {
      activeCount += 1;
      weightedSum += (noise + extIn + impulse) / 3;
    }
  }

  const density = activeCount / cells.length;
  const inLevel = (impulse * 0.5 + noise * 0.3 + extIn * 0.2);
  const rawOut = (weightedSum / Math.max(activeCount, 1)) * density * routeWeight;
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

  ui.clock.textContent = String(120 + Math.floor(density * 28));
  ui.fault.textContent = rawOut > limiter ? "01" : "00";

  if (audioEngine) {
    const t = audioEngine.ctx.currentTime;
    const gainTarget = clamp(outLevel * 0.16, 0.0001, 0.22);
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

    audioEngine.master.gain.setTargetAtTime(gainTarget, t, 0.05);
    audioEngine.filter.frequency.setTargetAtTime(cutoff, t, 0.05);
    audioEngine.filter.Q.setTargetAtTime(2 + density * 10, t, 0.07);
    audioEngine.oscA.frequency.setTargetAtTime(baseFreq, t, 0.05);
    audioEngine.oscB.frequency.setTargetAtTime(modFreq, t, 0.05);
  }
}

buildGrid();
setInterval(frame, 120);
