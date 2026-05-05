// Connects UI to audio engine and layers, and handles global controls

import { AudioEngine } from "./audio-engine.js";
import { RhythmLayer, formatPattern } from "./rhythm.js";
import { MelodyLayer } from "./melody.js";
import { TextureLayer } from "./texture.js";

const engine = new AudioEngine();
const rhythm = new RhythmLayer(engine);
const melody = new MelodyLayer(engine);
const texture = new TextureLayer(engine);

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const layerMap = { rhythm, melody, texture };

// ---- Transport ----
const startBtn = $("#start");
const updateMusicBtn = $("#update-music");
const statusText = $("#status-text");
const beatLed = $("#beat-led");

const LAYER_NAMES = ["rhythm", "melody", "texture"];

function startEverything() {
  engine.start();
  // Layers are attached when we get AudioContext for the first time.
  if (!rhythm.gain)  rhythm.attach();
  if (!melody.gain)  melody.attach();
  if (!texture.gain) texture.attach();
  rhythm.onPatternChange = (voice) => renderPattern(voice);
  for (const v of ["kick", "snare", "hat"]) renderPattern(v);
  startBtn.textContent = "stop";
  startBtn.classList.add("running");
  statusText.innerHTML = "running — toggle layers, tweak parameters";
}

function stopEverything() {
  texture.pause();
  engine.stop();
  startBtn.textContent = "start";
  startBtn.classList.remove("running");
  statusText.innerHTML = "stopped";
}

function setToggle(target, on, { apply = true } = {}) {
  const btn = document.querySelector(`.toggle[data-target="${target}"]`);
  if (!btn) return;
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "on" : "off";
  btn.closest(".layer").classList.toggle("active", on);
  if (apply) layerMap[target].setEnabled(on);
}

function allTogglesOff() {
  return LAYER_NAMES.every((t) => {
    const btn = document.querySelector(`.toggle[data-target="${t}"]`);
    return btn?.getAttribute("aria-pressed") !== "true";
  });
}

startBtn.addEventListener("click", () => {
  if (!engine.running) {
    startEverything();
    for (const t of LAYER_NAMES) setToggle(t, true);
  } else {
    for (const t of LAYER_NAMES) setToggle(t, false);
    stopEverything();
  }
});

// Use the engine's tick stream to flash beat LED on every quarter note.
let ledStep = 0;
const flashLed = () => {
  beatLed.classList.add("pulse");
  setTimeout(() => beatLed.classList.remove("pulse"), 70);
};

engine.tickHandlers.add((step) => {
  if (step % 4 === 0) {
    requestAnimationFrame(flashLed);
    ledStep = step;
  }
  // Update rhythm pattern highlight on every step.
  for (const v of ["kick", "snare", "hat"]) {
    const el = document.querySelector(`.pattern[data-voice="${v}"]`);
    if (!el || !rhythm.tracks[v]) continue;
    const len = rhythm.tracks[v].pattern.length;
    el.innerHTML = formatPattern(rhythm.tracks[v].pattern, step % len);
  }
  renderCaHistory(step);
});

function renderCaHistory(step) {
  const section = document.querySelector("#ca-history");
  const grid = document.querySelector("#ca-grid");
  if (!section || !grid) return;
  if (melody.mode !== "ca") {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const hist = melody.caHistory;
  const N = melody.caState.length;
  const curStep = step % N;
  const curBeat = Math.floor(curStep / 4);
  const beatStartCell = curBeat * 4;
  const lastIdx = hist.length - 1;
  let html = "";
  for (let i = 0; i < hist.length; i++) {
    const row = hist[i];
    const isCurrent = i === lastIdx;
    html += `<div class="ca-row${isCurrent ? " current" : ""}">`;
    for (let j = 0; j < row.length; j++) {
      const alive = row[j] ? "on" : "off";
      const now = isCurrent && j >= beatStartCell && j < beatStartCell + 4 ? " now" : "";
      html += `<span class="ca-cell ${alive}${now}"></span>`;
    }
    html += "</div>";
  }
  grid.innerHTML = html;
}

// ---- Layer toggles ----
$$(".toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.target;
    const next = btn.getAttribute("aria-pressed") !== "true";
    setToggle(target, next, { apply: false });
    markPending();
  });
});

// ---- Pending-change indicator ----
function markPending() {
  document.body.classList.add("pending");
  updateMusicBtn.classList.add("pending");
  statusText.innerHTML = engine.running
    ? "changes pending — click <em>update music</em>"
    : "changes pending — press <em>start</em>, then <em>update music</em>";
}

function clearPending() {
  document.body.classList.remove("pending");
  updateMusicBtn.classList.remove("pending");
}

// Any input in the board or transport (other than the start button) flags pending.
$$(".board input, .board select, .transport input").forEach((el) => {
  el.addEventListener("input", markPending);
  el.addEventListener("change", markPending);
});

// Per-layer volume sliders are staged until "update music".

// ---- Rhythm controls ----
function renderPattern(voice) {
  const el = document.querySelector(`.pattern[data-voice="${voice}"]`);
  if (!el) return;
  el.innerHTML = formatPattern(rhythm.tracks[voice].pattern);
}

// Initial pattern render.
for (const v of ["kick", "snare", "hat"]) renderPattern(v);
renderCaHistory(0);

// ---- Melody controls ----
const pcsetSel = $("#pcset");
const tnRange  = $("#tn");
const tnVal    = $("#tn-val");
const invertCb = $("#invert");

tnRange.addEventListener("input", () => {
  const n = parseInt(tnRange.value, 10);
  tnVal.textContent = n;
});

function applyMusicSettings() {
  engine.setBpm(parseFloat($("#bpm").value));
  engine.setMasterGain(parseFloat($("#master").value));

  $$(".layer").forEach((el) => {
    const which = el.dataset.layer;
    const layer = layerMap[which];
    const vol = el.querySelector(".vol");
    if (vol) layer.setVolume(parseFloat(vol.value));
  });

  for (const target of LAYER_NAMES) {
    const btn = document.querySelector(`.toggle[data-target="${target}"]`);
    const on = btn?.getAttribute("aria-pressed") === "true";
    layerMap[target].setEnabled(on);
  }

  for (const voice of ["kick", "snare", "hat"]) {
    const steps = parseInt(document.querySelector(`.steps[data-voice="${voice}"]`).value, 10);
    const pulses = parseInt(document.querySelector(`.pulses[data-voice="${voice}"]`).value, 10);
    rhythm.setTrack(voice, steps, pulses);
    renderPattern(voice);
  }

  melody.setPcset(pcsetSel.value.split(",").map(Number));
  melody.setTn(parseInt(tnRange.value, 10));
  melody.setInvert(invertCb.checked);
  melody.setDensity(parseFloat($("#density").value));
  melody.setFmIndex(parseFloat($("#fmindex").value));
  melody.setFmRatio(parseFloat($("#fmratio").value));
  melody.setMode($("#melody-mode").value);

  texture.setBaseMidi(parseInt($("#tex-base").value, 10));
  texture.setHarmony(melody.getEffectivePcset());
  texture.setSpread(parseFloat($("#tex-spread").value));
  texture.setCutoff(parseFloat($("#tex-cutoff").value));
  texture.setLfoRate(parseFloat($("#tex-lforate").value));
  texture.setLfoDepth(parseFloat($("#tex-lfodepth").value));

  if (engine.running && allTogglesOff()) stopEverything();
}

updateMusicBtn.addEventListener("click", () => {
  applyMusicSettings();
  clearPending();
  renderCaHistory(0);
  statusText.innerHTML = engine.running
    ? "music updated — parameters applied"
    : "settings updated — press start to hear changes";
});

applyMusicSettings();
clearPending();
