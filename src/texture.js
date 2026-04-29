// Texture layer: a drone made of three sawtooth oscillators
// summed and routed through a lowpass filter whose cutoff is modulated by an
// LFO. The whole thing fades in/out smoothly.

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class TextureLayer {
  constructor(engine) {
    this.engine = engine;
    this.enabled = false;
    this.targetVolume = 0.4;

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

    const detunes = [-this.spread, 0, this.spread];
    const baseHz = midiToHz(this.baseMidi);
    for (const d of detunes) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = baseHz;
      osc.detune.value = d;
      osc.connect(this.filter);
      osc.start();
      this.oscs.push(osc);
    }

    this.filter.connect(this.gain).connect(this.engine.master);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.gain) return;
    const target = on ? this.targetVolume : 0;
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
    const target = this.enabled ? this.targetVolume : 0;
    const t = this.engine.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(target, t + 0.4);
  }

  setVolume(v) {
    this.targetVolume = v;
    if (this.enabled && this.gain) {
      this.gain.gain.setTargetAtTime(v, this.engine.ctx.currentTime, 0.1);
    }
  }

  setBaseMidi(m) {
    this.baseMidi = m;
    const baseHz = midiToHz(m);
    const t = this.engine.ctx.currentTime;
    for (const osc of this.oscs) {
      osc.frequency.setTargetAtTime(baseHz, t, 0.1);
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
