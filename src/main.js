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

function setToggle(target, on) {
  const btn = document.querySelector(`.toggle[data-target="${target}"]`);
  if (!btn) return;
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "on" : "off";
  btn.closest(".layer").classList.toggle("active", on);
  layerMap[target].setEnabled(on);
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

$("#bpm").addEventListener("input", (e) => engine.setBpm(parseFloat(e.target.value)));
$("#master").addEventListener("input", (e) => engine.setMasterGain(parseFloat(e.target.value)));

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
    if (next && !engine.running) startEverything();
    setToggle(target, next);
    if (!next && engine.running && allTogglesOff()) stopEverything();
  });
});

// Per-layer volume sliders.
$$(".layer").forEach((el) => {
  const which = el.dataset.layer;
  const layer = layerMap[which];
  const vol = el.querySelector(".vol");
  if (vol) vol.addEventListener("input", (e) => layer.setVolume(parseFloat(e.target.value)));
});

// ---- Rhythm controls ----
function renderPattern(voice) {
  const el = document.querySelector(`.pattern[data-voice="${voice}"]`);
  if (!el) return;
  el.innerHTML = formatPattern(rhythm.tracks[voice].pattern);
}

$$(".euclid .steps, .euclid .pulses").forEach((input) => {
  input.addEventListener("input", () => {
    const voice = input.dataset.voice;
    const steps  = parseInt(document.querySelector(`.steps[data-voice="${voice}"]`).value, 10);
    const pulses = parseInt(document.querySelector(`.pulses[data-voice="${voice}"]`).value, 10);
    rhythm.setTrack(voice, steps, pulses);
    renderPattern(voice);
  });
});

// Initial pattern render.
for (const v of ["kick", "snare", "hat"]) renderPattern(v);

// ---- Melody controls ----
const pcsetSel = $("#pcset");
const tnRange  = $("#tn");
const tnVal    = $("#tn-val");
const invertCb = $("#invert");

pcsetSel.addEventListener("change", () => {
  const set = pcsetSel.value.split(",").map(Number);
  melody.setPcset(set);
});
tnRange.addEventListener("input", () => {
  const n = parseInt(tnRange.value, 10);
  tnVal.textContent = n;
  melody.setTn(n);
});
invertCb.addEventListener("change", () => melody.setInvert(invertCb.checked));
$("#density").addEventListener("input", (e) => melody.setDensity(parseFloat(e.target.value)));
$("#fmindex").addEventListener("input", (e) => melody.setFmIndex(parseFloat(e.target.value)));
$("#fmratio").addEventListener("input", (e) => melody.setFmRatio(parseFloat(e.target.value)));

// ---- Texture controls ----
$("#tex-base").addEventListener("input",     (e) => texture.setBaseMidi(parseInt(e.target.value, 10)));
$("#tex-spread").addEventListener("input",   (e) => texture.setSpread(parseFloat(e.target.value)));
$("#tex-cutoff").addEventListener("input",   (e) => texture.setCutoff(parseFloat(e.target.value)));
$("#tex-lforate").addEventListener("input",  (e) => texture.setLfoRate(parseFloat(e.target.value)));
$("#tex-lfodepth").addEventListener("input", (e) => texture.setLfoDepth(parseFloat(e.target.value)));
