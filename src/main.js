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
const tuneSaveBtn = $("#tune-save");
const tunePlaySeqBtn = $("#tune-play-seq");
const tunePlayTogetherBtn = $("#tune-play-together");
const tuneSaveNote = $("#tune-save-note");
const tuneStatus = $("#tune-status");
const tuneTabs = $$(".tune-tab");
const tunePages = [null, null, null];
const tunePagesSaved = [false, false, false];
let activeTunePage = 0;
let defaultTuneState = null;
let playMode = "off"; // "off" | "sequence" | "together"
let playCursor = 0;
const togetherLayerSets = [0, 1, 2].map(() => ({
  rhythm: new RhythmLayer(engine),
  melody: new MelodyLayer(engine),
  texture: new TextureLayer(engine),
  attached: false,
}));

const LAYER_NAMES = ["rhythm", "melody", "texture"];

function startEverything() {
  engine.start();
  // Layers are attached when we get AudioContext for the first time.
  if (!rhythm.gain)  rhythm.attach();
  if (!melody.gain)  melody.attach();
  if (!texture.gain) texture.attach();
  if (playMode === "together") ensureTogetherLayersAttached();
  rhythm.onPatternChange = (voice) => renderPattern(voice);
  for (const v of ["kick", "snare", "hat"]) renderPattern(v);
  startBtn.textContent = "stop";
  startBtn.classList.add("running");
  statusText.innerHTML = "running — toggle layers, tweak parameters";
}

function stopEverything() {
  if (playMode === "together") disableTogetherLayers();
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
  if (playMode === "sequence" && step % 16 === 0) {
    playNextTunePage();
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
  if (melody.mode !== "ca" || !melody.enabled) {
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

function captureCurrentState() {
  return {
    transport: {
      bpm: $("#bpm").value,
      master: $("#master").value,
    },
    toggles: LAYER_NAMES.reduce((acc, name) => {
      const btn = document.querySelector(`.toggle[data-target="${name}"]`);
      acc[name] = btn?.getAttribute("aria-pressed") === "true";
      return acc;
    }, {}),
    rhythm: ["kick", "snare", "hat"].reduce((acc, voice) => {
      acc[voice] = {
        steps: document.querySelector(`.steps[data-voice="${voice}"]`).value,
        pulses: document.querySelector(`.pulses[data-voice="${voice}"]`).value,
      };
      return acc;
    }, {}),
    melody: {
      mode: $("#melody-mode").value,
      pcset: $("#pcset").value,
      order: $("#melody-order").value,
      tn: $("#tn").value,
      invert: $("#invert").checked,
      density: $("#density").value,
      speed: $("#melody-speed").value,
      fmindex: $("#fmindex").value,
      fmratio: $("#fmratio").value,
      volume: document.querySelector('.layer[data-layer="melody"] .vol').value,
      send: document.querySelector('.layer[data-layer="melody"] .send').value,
    },
    texture: {
      volume: document.querySelector('.layer[data-layer="texture"] .vol').value,
      send: document.querySelector('.layer[data-layer="texture"] .send').value,
      base: $("#tex-base").value,
      spread: $("#tex-spread").value,
      cutoff: $("#tex-cutoff").value,
      lfoRate: $("#tex-lforate").value,
      lfoDepth: $("#tex-lfodepth").value,
    },
    rhythmFx: {
      volume: document.querySelector('.layer[data-layer="rhythm"] .vol').value,
      send: document.querySelector('.layer[data-layer="rhythm"] .send').value,
    },
  };
}

function applyStateToUI(state) {
  if (!state) return;
  $("#bpm").value = state.transport.bpm;
  $("#master").value = state.transport.master;
  for (const name of LAYER_NAMES) setToggle(name, Boolean(state.toggles[name]), { apply: false });

  for (const voice of ["kick", "snare", "hat"]) {
    document.querySelector(`.steps[data-voice="${voice}"]`).value = state.rhythm[voice].steps;
    document.querySelector(`.pulses[data-voice="${voice}"]`).value = state.rhythm[voice].pulses;
  }
  document.querySelector('.layer[data-layer="rhythm"] .vol').value = state.rhythmFx.volume;
  document.querySelector('.layer[data-layer="rhythm"] .send').value = state.rhythmFx.send;

  $("#melody-mode").value = state.melody.mode;
  $("#pcset").value = state.melody.pcset;
  $("#melody-order").value = state.melody.order;
  $("#tn").value = state.melody.tn;
  $("#tn-val").textContent = state.melody.tn;
  $("#invert").checked = state.melody.invert;
  $("#density").value = state.melody.density;
  $("#melody-speed").value = state.melody.speed;
  $("#melody-speed-val").textContent = `${parseFloat(state.melody.speed).toFixed(2)}x`;
  $("#fmindex").value = state.melody.fmindex;
  $("#fmratio").value = state.melody.fmratio;
  document.querySelector('.layer[data-layer="melody"] .vol').value = state.melody.volume;
  document.querySelector('.layer[data-layer="melody"] .send').value = state.melody.send;

  document.querySelector('.layer[data-layer="texture"] .vol').value = state.texture.volume;
  document.querySelector('.layer[data-layer="texture"] .send').value = state.texture.send;
  $("#tex-base").value = state.texture.base;
  $("#tex-spread").value = state.texture.spread;
  $("#tex-cutoff").value = state.texture.cutoff;
  $("#tex-lforate").value = state.texture.lfoRate;
  $("#tex-lfodepth").value = state.texture.lfoDepth;
}

function getStateForPage(idx) {
  return tunePages[idx] ?? defaultTuneState;
}

function ensureTogetherLayersAttached() {
  for (const set of togetherLayerSets) {
    if (set.attached) continue;
    set.rhythm.attach();
    set.melody.attach();
    set.texture.attach();
    set.attached = true;
  }
}

function disableTogetherLayers() {
  for (const set of togetherLayerSets) {
    set.rhythm.setEnabled(false);
    set.melody.setEnabled(false);
    set.texture.setEnabled(false);
    set.texture.pause();
  }
}

function applyStateToLayerSet(set, state) {
  if (!state) return;
  set.rhythm.setVolume(parseFloat(state.rhythmFx.volume));
  set.rhythm.setSend?.(parseFloat(state.rhythmFx.send));
  for (const voice of ["kick", "snare", "hat"]) {
    set.rhythm.setTrack(
      voice,
      parseInt(state.rhythm[voice].steps, 10),
      parseInt(state.rhythm[voice].pulses, 10),
    );
  }

  set.melody.setPcset(state.melody.pcset.split(",").map(Number));
  set.melody.setOrderMode(state.melody.order);
  set.melody.setTn(parseInt(state.melody.tn, 10));
  set.melody.setInvert(Boolean(state.melody.invert));
  const density = Math.min(1, parseFloat(state.melody.density) * parseFloat(state.melody.speed));
  set.melody.setDensity(density);
  set.melody.setFmIndex(parseFloat(state.melody.fmindex));
  set.melody.setFmRatio(parseFloat(state.melody.fmratio));
  set.melody.setMode(state.melody.mode);
  set.melody.setVolume(parseFloat(state.melody.volume));
  set.melody.setSend(parseFloat(state.melody.send));

  set.texture.setBaseMidi(parseInt(state.texture.base, 10));
  set.texture.setHarmony(set.melody.getEffectivePcset());
  set.texture.setSpread(parseFloat(state.texture.spread));
  set.texture.setCutoff(parseFloat(state.texture.cutoff));
  set.texture.setLfoRate(parseFloat(state.texture.lfoRate));
  set.texture.setLfoDepth(parseFloat(state.texture.lfoDepth));
  set.texture.setVolume(parseFloat(state.texture.volume));
  set.texture.setSend(parseFloat(state.texture.send));

  set.rhythm.setEnabled(Boolean(state.toggles.rhythm));
  set.melody.setEnabled(Boolean(state.toggles.melody));
  set.texture.setEnabled(Boolean(state.toggles.texture));
}

function startTogetherMode() {
  if (!engine.running) startEverything();
  ensureTogetherLayersAttached();
  rhythm.setEnabled(false);
  melody.setEnabled(false);
  texture.setEnabled(false);
  for (let i = 0; i < togetherLayerSets.length; i++) {
    applyStateToLayerSet(togetherLayerSets[i], getStateForPage(i));
  }
}

function markActiveTunePage() {
  tuneTabs.forEach((btn) => {
    const idx = parseInt(btn.dataset.slot, 10);
    btn.classList.toggle("active", idx === activeTunePage);
  });
  if (tuneStatus) tuneStatus.textContent = `editing page ${activeTunePage + 1}`;
}

function updatePlayAvailability() {
  const savedCount = tunePagesSaved.filter(Boolean).length;
  const allSaved = savedCount === tunePagesSaved.length;
  if (tuneSaveNote) {
    tuneSaveNote.textContent = allSaved
      ? "all pages saved — play modes unlocked"
      : `save all 3 pages to unlock play modes (${savedCount}/3 saved)`;
  }
  if (playMode !== "off") return;
  if (tunePlaySeqBtn) tunePlaySeqBtn.disabled = !allSaved;
  if (tunePlayTogetherBtn) tunePlayTogetherBtn.disabled = !allSaved;
}

function saveActiveTunePage() {
  tunePages[activeTunePage] = captureCurrentState();
  tunePagesSaved[activeTunePage] = true;
  updatePlayAvailability();
  statusText.innerHTML = `saved page ${activeTunePage + 1}`;
}

function switchTunePage(nextPage) {
  if (nextPage === activeTunePage) return;
  tunePages[activeTunePage] = captureCurrentState();
  activeTunePage = nextPage;
  const nextState = tunePages[activeTunePage];
  applyStateToUI(nextState ?? defaultTuneState);
  applyMusicSettings();
  clearPending();
  renderCaHistory(0);
  markActiveTunePage();
  statusText.innerHTML = `loaded page ${activeTunePage + 1}`;
}

function playNextTunePage() {
  const nextPage = playCursor % tunePages.length;
  playCursor += 1;
  if (nextPage === activeTunePage) return;
  switchTunePage(nextPage);
}

function ensurePlaybackReadyForPageModes() {
  if (!engine.running) {
    startEverything();
    for (const t of LAYER_NAMES) setToggle(t, true);
  }
  // Keep the active page state in sync with current UI before mode starts.
  tunePages[activeTunePage] = captureCurrentState();
  applyMusicSettings();
  clearPending();
}

function stopPlayModes() {
  if (playMode === "together") {
    disableTogetherLayers();
    applyMusicSettings();
  }
  playMode = "off";
  if (tunePlaySeqBtn) tunePlaySeqBtn.textContent = "play sequence";
  if (tunePlayTogetherBtn) tunePlayTogetherBtn.textContent = "play together";
  setUiLocked(false);
  updatePlayAvailability();
}

function setUiLocked(locked) {
  const controls = $$("button, input, select");
  controls.forEach((el) => { el.disabled = locked; });
  if (!locked) return;
  if (playMode === "sequence" && tunePlaySeqBtn) tunePlaySeqBtn.disabled = false;
  if (playMode === "together" && tunePlayTogetherBtn) tunePlayTogetherBtn.disabled = false;
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
const melodyOrderSel = $("#melody-order");
const melodySpeedRange = $("#melody-speed");
const melodySpeedVal = $("#melody-speed-val");
const tnRange  = $("#tn");
const tnVal    = $("#tn-val");
const invertCb = $("#invert");
const densityRange = $("#density");

tnRange.addEventListener("input", () => {
  const n = parseInt(tnRange.value, 10);
  tnVal.textContent = n;
});

function getMelodyDensityValue() {
  const base = parseFloat(densityRange.value);
  const speed = parseFloat(melodySpeedRange?.value ?? "1");
  return Math.min(1, base * speed);
}

function applyMusicSettings() {
  engine.setBpm(parseFloat($("#bpm").value));
  engine.setMasterGain(parseFloat($("#master").value));

  $$(".layer").forEach((el) => {
    const which = el.dataset.layer;
    const layer = layerMap[which];
    const vol = el.querySelector(".vol");
    if (vol) layer.setVolume(parseFloat(vol.value));
    const send = el.querySelector(".send");
    if (send && layer.setSend) layer.setSend(parseFloat(send.value));
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
  melody.setOrderMode(melodyOrderSel.value);
  melody.setTn(parseInt(tnRange.value, 10));
  melody.setInvert(invertCb.checked);
  melody.setDensity(getMelodyDensityValue());
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

melodySpeedRange?.addEventListener("input", () => {
  const speed = parseFloat(melodySpeedRange.value);
  if (melodySpeedVal) melodySpeedVal.textContent = `${speed.toFixed(2)}x`;
  const density = getMelodyDensityValue();
  melody.setDensity(density);
  statusText.innerHTML = `melody speed ${speed.toFixed(2)}x (density ${density.toFixed(2)})`;
  markPending();
});

tuneTabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    const idx = parseInt(btn.dataset.slot, 10);
    switchTunePage(idx);
  });
});

tuneSaveBtn?.addEventListener("click", () => {
  saveActiveTunePage();
});

tunePlaySeqBtn?.addEventListener("click", () => {
  if (tunePlaySeqBtn.disabled) return;
  if (playMode === "sequence") {
    stopPlayModes();
    statusText.innerHTML = "stopped page sequence";
    return;
  }
  if (playMode === "together") stopPlayModes();
  ensurePlaybackReadyForPageModes();
  playMode = "sequence";
  playCursor = activeTunePage + 1;
  if (tunePlaySeqBtn) tunePlaySeqBtn.textContent = "stop sequence";
  if (tunePlayTogetherBtn) tunePlayTogetherBtn.textContent = "play together";
  setUiLocked(true);
  statusText.innerHTML = "playing pages in sequence";
});

tunePlayTogetherBtn?.addEventListener("click", () => {
  if (tunePlayTogetherBtn.disabled) return;
  if (playMode === "together") {
    stopPlayModes();
    statusText.innerHTML = "stopped play together";
    return;
  }
  if (playMode === "sequence") stopPlayModes();
  ensurePlaybackReadyForPageModes();
  playMode = "together";
  playCursor = activeTunePage + 1;
  startTogetherMode();
  if (tunePlayTogetherBtn) tunePlayTogetherBtn.textContent = "stop together";
  if (tunePlaySeqBtn) tunePlaySeqBtn.textContent = "play sequence";
  setUiLocked(true);
  statusText.innerHTML = "playing all pages together (simultaneous)";
});

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
tunePages[0] = captureCurrentState();
defaultTuneState = captureCurrentState();
markActiveTunePage();
updatePlayAvailability();
