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
  texture.resume();
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
});

// ---- Layer toggles ----
$$(".toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.target;
    const next = btn.getAttribute("aria-pressed") !== "true";
    setToggle(target, next, { apply: false });
    statusText.innerHTML = engine.running
      ? "changes pending — click update music"
      : "changes pending — press start, then update music";
  });
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

  texture.setBaseMidi(parseInt($("#tex-base").value, 10));
  texture.setSpread(parseFloat($("#tex-spread").value));
  texture.setCutoff(parseFloat($("#tex-cutoff").value));
  texture.setLfoRate(parseFloat($("#tex-lforate").value));
  texture.setLfoDepth(parseFloat($("#tex-lfodepth").value));

  if (engine.running && allTogglesOff()) stopEverything();
}

updateMusicBtn.addEventListener("click", () => {
  applyMusicSettings();
  statusText.innerHTML = engine.running
    ? "music updated — parameters applied"
    : "settings updated — press start to hear changes";
});

applyMusicSettings();
