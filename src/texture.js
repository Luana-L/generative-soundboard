// Texture layer: a drone made of three sawtooth oscillators voiced as a chord
// snapped to the melody's pitch class set. Routed through a lowpass filter
// whose cutoff is modulated by an LFO. Fades in/out smoothly.

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Snap baseMidi up to the nearest pitch in the pcset, then stack two more
// voices roughly a fifth and an octave-plus-third above, also snapped to the
// pcset. Yields a triadic drone that always shares pitches with the melody.
function harmonizedPitches(baseMidi, pcset) {
  if (!pcset || pcset.length === 0) {
    return [baseMidi, baseMidi + 7, baseMidi + 16];
  }
  const sorted = [...new Set(pcset.map((p) => ((p % 12) + 12) % 12))].sort((a, b) => a - b);
  const baseOct = Math.floor(baseMidi / 12) * 12;

  const allCandidates = [];
  for (let oct = 0; oct <= 3; oct++) {
    for (const pc of sorted) allCandidates.push(baseOct + oct * 12 + pc);
  }

  const root = allCandidates.find((m) => m >= baseMidi) ?? allCandidates[0];
  const snapAbove = (above, targetSemis) => {
    const target = above + targetSemis;
    let best = null, bestDist = Infinity;
    for (const m of allCandidates) {
      if (m <= above) continue;
      const d = Math.abs(m - target);
      if (d < bestDist) { bestDist = d; best = m; }
    }
    return best ?? above + targetSemis;
  };

  return [root, snapAbove(root, 7), snapAbove(root, 16)];
}

export class TextureLayer {
  constructor(engine) {
    this.engine = engine;
    this.enabled = false;
    this.targetVolume = 0.15;
    this.outputTrim = 0.35;

    this.gain = null;
    this.filter = null;
    this.lfo = null;
    this.lfoDepth = null;
    this.oscs = [];

    this.baseMidi = 40;
    this.spread = 12;
    this.cutoff = 900;
    this.lfoRate = 0.15;
    this.lfoDepthHz = 1200;
    this.harmony = [0, 2, 4, 7, 9];
    this.voicePitches = harmonizedPitches(this.baseMidi, this.harmony);
  }

  attach() {
    const ctx = this.engine.ctx;

    this.gain = ctx.createGain();
    this.gain.gain.value = 0;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.cutoff;
    this.filter.Q.value = 4;

    // LFO -> depth gain -> filter.frequency
    this.lfo = ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.value = this.lfoRate;

    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = this.lfoDepthHz;

    this.lfo.connect(this.lfoDepth).connect(this.filter.frequency);
    this.lfo.start();

    this.voicePitches = harmonizedPitches(this.baseMidi, this.harmony);
    const detunes = [-this.spread, 0, this.spread];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midiToHz(this.voicePitches[i]);
      osc.detune.value = detunes[i];
      osc.connect(this.filter);
      osc.start();
      this.oscs.push(osc);
    }

    this.filter.connect(this.gain).connect(this.engine.master);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.gain) return;
    const target = on ? this.targetVolume * this.outputTrim : 0;
    this.gain.gain.setTargetAtTime(target, this.engine.ctx.currentTime, 0.4);
  }

  pause() {
    if (!this.gain) return;
    const t = this.engine.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0, t + 0.15);
  }

  resume() {
    if (!this.gain) return;
    const target = this.enabled ? this.targetVolume * this.outputTrim : 0;
    const t = this.engine.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(target, t + 0.4);
  }

  setVolume(v) {
    this.targetVolume = v;
    if (this.enabled && this.gain) {
      this.gain.gain.setTargetAtTime(v * this.outputTrim, this.engine.ctx.currentTime, 0.1);
    }
  }

  setBaseMidi(m) {
    this.baseMidi = m;
    this.applyVoicePitches();
  }

  setHarmony(pcset) {
    this.harmony = pcset && pcset.length ? pcset : this.harmony;
    this.applyVoicePitches();
  }

  applyVoicePitches() {
    this.voicePitches = harmonizedPitches(this.baseMidi, this.harmony);
    if (this.oscs.length !== 3) return;
    const t = this.engine.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this.oscs[i].frequency.setTargetAtTime(midiToHz(this.voicePitches[i]), t, 0.15);
    }
  }

  setSpread(cents) {
    this.spread = cents;
    if (this.oscs.length !== 3) return;
    const t = this.engine.ctx.currentTime;
    this.oscs[0].detune.setTargetAtTime(-cents, t, 0.1);
    this.oscs[2].detune.setTargetAtTime(+cents, t, 0.1);
  }

  setCutoff(hz) {
    this.cutoff = hz;
    if (!this.filter) return;
    this.filter.frequency.setTargetAtTime(hz, this.engine.ctx.currentTime, 0.05);
  }

  setLfoRate(hz) {
    this.lfoRate = hz;
    if (!this.lfo) return;
    this.lfo.frequency.setTargetAtTime(hz, this.engine.ctx.currentTime, 0.05);
  }

  setLfoDepth(hz) {
    this.lfoDepthHz = hz;
    if (!this.lfoDepth) return;
    this.lfoDepth.gain.setTargetAtTime(hz, this.engine.ctx.currentTime, 0.05);
  }
}
