// Melody layer: builds a pitch collection from a pitch class set under
// transposition and inversion, then plays randomized notes.
//
// Pitch class set theory operations on pc set S, where each p in [0,11]:
//   Tn(S)  = { (p + n) mod 12 : p in S }
//   TnI(S) = { (n - p) mod 12 : p in S }
//
// We expand the resulting pc set across two octaves above the base note
// to form an actual pitch pool the melody draws from.

const BASE_MIDI = 60; // middle C

export function transpose(pcset, n) {
  return pcset.map((p) => ((p + n) % 12 + 12) % 12);
}

export function invert(pcset, n) {
  return pcset.map((p) => ((n - p) % 12 + 12) % 12);
}

// Convert pc set to MIDI pitches across `octaves` starting at `baseMidi`.
function expandPitches(pcset, baseMidi, octaves = 2) {
  const pitches = [];
  const sorted = [...new Set(pcset)].sort((a, b) => a - b);
  for (let o = 0; o < octaves; o++) {
    for (const pc of sorted) pitches.push(baseMidi + 12 * o + pc);
  }
  return pitches;
}

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class MelodyLayer {
  constructor(engine) {
    this.engine = engine;
    this.enabled = false;
    this.gain = null;

    // Pitch class set state.
    this.pcset = [0, 2, 4, 5, 7, 9, 11];
    this.tn = 0;
    this.invertOn = false;
    this.pitchPool = expandPitches(this.pcset, BASE_MIDI);

    // Generation parameters.
    this.density = 0.6;     // probability a 16th-note step plays a note
    this.fmIndex = 220;     // modulation depth in Hz
    this.fmRatio = 2;       // modulator:carrier frequency ratio
    this.lastPitchIndex = 0;
    this.targetVolume = 0.5;
    this.orderMode = "walk"; // "walk" | "seq"
    this.sequenceIndex = 0;

    // Cellular-automaton mode: a 16-cell row has live cells that fire notes
    // and pitch is drawn from the pool by cell index.
    this.mode = "walk";     // "walk" | "ca"
    this.caRule = 110;
    this.caState = new Array(16).fill(0);
    this.caHistory = [];
    this.caHistoryMax = 4;
    this.seedCa();
  }

  attach() {
    const ctx = this.engine.ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.engine.master);
    this.send = ctx.createGain();
    this.send.gain.value = 0;
    this.gain.connect(this.send);
    this.send.connect(this.engine.fxInput);
    this.engine.onTick((step, time) => this.tick(step, time));
  }

  setSend(v) {
    if (!this.send) return;
    this.send.gain.setTargetAtTime(v, this.engine.ctx.currentTime, 0.05);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.gain) return;
    const target = on ? this.targetVolume : 0;
    this.gain.gain.setTargetAtTime(target, this.engine.ctx.currentTime, 0.02);
  }

  setVolume(v) {
    this.targetVolume = v;
    if (this.enabled && this.gain) {
      this.gain.gain.setTargetAtTime(v, this.engine.ctx.currentTime, 0.02);
    }
  }

  setPcset(pcset) { this.pcset = pcset; this.recomputePool(); }
  setOrderMode(mode) {
    this.orderMode = mode === "seq" ? "seq" : "walk";
    this.sequenceIndex = 0;
  }
  setTn(n)        { this.tn = n;        this.recomputePool(); }
  setInvert(on)   { this.invertOn = on; this.recomputePool(); }
  setDensity(d)   { this.density = d; }
  setFmIndex(i)   { this.fmIndex = i; }
  setFmRatio(r)   { this.fmRatio = r; }

  setMode(mode) {
    this.mode = mode === "ca" ? "ca" : "walk";
    if (this.mode === "ca") this.seedCa();
  }

  // Sparse random seed; ~25% of cells alive. Avoids the all-zero attractor.
  seedCa() {
    this.caState = new Array(16).fill(0).map(() => (Math.random() < 0.25 ? 1 : 0));
    if (this.caState.every((x) => x === 0)) this.caState[Math.floor(Math.random() * 16)] = 1;
    this.caHistory = [[...this.caState]];
  }

  stepCa() {
    const N = this.caState.length;
    const next = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      const left   = this.caState[(i - 1 + N) % N];
      const center = this.caState[i];
      const right  = this.caState[(i + 1) % N];
      const idx    = (left << 2) | (center << 1) | right;
      next[i] = (this.caRule >> idx) & 1;
    }
    if (next.every((x) => x === 0) || next.every((x) => x === 1)) {
      next[Math.floor(Math.random() * N)] ^= 1;
    }
    this.caState = next;
    this.caHistory.push([...next]);
    if (this.caHistory.length > this.caHistoryMax) this.caHistory.shift();
  }

  recomputePool() {
    this.effectivePcset = this.computeEffectivePcset();
    this.pitchPool = expandPitches(this.effectivePcset, BASE_MIDI);
  }

  computeEffectivePcset() {
    let s = transpose(this.pcset, this.tn);
    if (this.invertOn) s = invert(s, this.tn);
    return s;
  }

  getEffectivePcset() {
    return this.effectivePcset ?? this.computeEffectivePcset();
  }

  // Random walk through the pitch pool
  pickNextPitch() {
    const pool = this.pitchPool;
    if (pool.length === 0) return null;
    const leap = Math.random() < 0.15;
    const span = leap ? 4 : 2;
    const delta = Math.floor(Math.random() * (2 * span + 1)) - span;
    this.lastPitchIndex = Math.max(0, Math.min(pool.length - 1, this.lastPitchIndex + delta));
    return pool[this.lastPitchIndex];
  }

  pickNextSequentialPitch() {
    const orderedPcset = this.getEffectivePcset();
    if (!orderedPcset.length) return null;

    const pc = orderedPcset[this.sequenceIndex % orderedPcset.length];
    this.sequenceIndex = (this.sequenceIndex + 1) % 1024;
    return BASE_MIDI + pc;
  }

  tick(step, time) {
    if (!this.enabled || !this.gain) return;

    if (this.mode === "ca") {
      const N = this.caState.length;
      const pos = step % N;
      if (pos === 0) this.stepCa();
      if (step % 4 !== 0) return;

      const pool = this.pitchPool;
      if (pool.length === 0) return;
      const beatSec = 60 / this.engine.bpm;
      const dur = beatSec * 0.95;
      const startCell = (Math.floor(pos / 4)) * 4;
      for (let j = 0; j < 4; j++) {
        const cellIdx = startCell + j;
        if (!this.caState[cellIdx]) continue;
        if (Math.random() > this.density) continue;
        const pitch = pool[cellIdx % pool.length];
        this.playFmVoice(midiToHz(pitch), time, dur);
      }
      return;
    }

    if (Math.random() > this.density) return;
    const stepDur = this.engine.stepDuration();
    const beats = Math.random() < 0.7 ? 1 : Math.random() < 0.5 ? 2 : 3;
    const dur = stepDur * beats * 0.95;

    const midi = this.orderMode === "seq"
      ? this.pickNextSequentialPitch()
      : this.pickNextPitch();
    if (midi == null) return;
    this.playFmVoice(midiToHz(midi), time, dur);
  }

  // FM synthesis. `attack` controls fade-in time.
  playFmVoice(carrierHz, time, duration, attack = 0.01) {
    const ctx = this.engine.ctx;

    const carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.value = carrierHz;

    const modulator = ctx.createOscillator();
    modulator.type = "sine";
    modulator.frequency.value = carrierHz * this.fmRatio;

    const modIndex = ctx.createGain();
    modIndex.gain.setValueAtTime(0, time);
    modIndex.gain.linearRampToValueAtTime(this.fmIndex, time + attack);
    modIndex.gain.exponentialRampToValueAtTime(Math.max(1, this.fmIndex * 0.2), time + duration);

    modulator.connect(modIndex).connect(carrier.frequency);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.5, time + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    carrier.connect(amp).connect(this.gain);

    modulator.start(time);
    carrier.start(time);
    modulator.stop(time + duration + 0.05);
    carrier.stop(time + duration + 0.05);
  }
}
