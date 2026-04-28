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
  }

  attach() {
    const ctx = this.engine.ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.engine.master);
    this.engine.onTick((step, time) => this.tick(step, time));
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
  setTn(n)        { this.tn = n;        this.recomputePool(); }
  setInvert(on)   { this.invertOn = on; this.recomputePool(); }
  setDensity(d)   { this.density = d; }
  setFmIndex(i)   { this.fmIndex = i; }
  setFmRatio(r)   { this.fmRatio = r; }

  recomputePool() {
    let s = transpose(this.pcset, this.tn);
    if (this.invertOn) s = invert(s, this.tn);
    this.pitchPool = expandPitches(s, BASE_MIDI);
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

  tick(step, time) {
    if (!this.enabled || !this.gain) return;
    if (Math.random() > this.density) return;

    // Vary note length: usually a 16th (one step), sometimes longer.
    const stepDur = this.engine.stepDuration();
    const beats = Math.random() < 0.7 ? 1 : Math.random() < 0.5 ? 2 : 3;
    const dur = stepDur * beats * 0.95;

    const midi = this.pickNextPitch();
    if (midi == null) return;
    this.playFmVoice(midiToHz(midi), time, dur);
  }

  // FM synthesis
  playFmVoice(carrierHz, time, duration) {
    const ctx = this.engine.ctx;

    const carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.value = carrierHz;

    const modulator = ctx.createOscillator();
    modulator.type = "sine";
    modulator.frequency.value = carrierHz * this.fmRatio;

    const modIndex = ctx.createGain();
    modIndex.gain.setValueAtTime(0, time);
    modIndex.gain.linearRampToValueAtTime(this.fmIndex, time + 0.01);
    modIndex.gain.exponentialRampToValueAtTime(Math.max(1, this.fmIndex * 0.2), time + duration);

    modulator.connect(modIndex).connect(carrier.frequency);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.5, time + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    carrier.connect(amp).connect(this.gain);

    modulator.start(time);
    carrier.start(time);
    modulator.stop(time + duration + 0.05);
    carrier.stop(time + duration + 0.05);
  }
}
