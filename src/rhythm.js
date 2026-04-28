// Rhythm layer
// 
// Euclidean rhythms (Bjorklund's algorithm) drive three drums voices

// Bjorklund algo distributes `pulses` as evenly as possible across `steps`.
// Returns an array of 0/1 of length `steps`.
export function bjorklund(steps, pulses) {
  steps = Math.max(1, Math.floor(steps));
  pulses = Math.max(0, Math.min(steps, Math.floor(pulses)));
  if (pulses === 0) return new Array(steps).fill(0);
  if (pulses === steps) return new Array(steps).fill(1);

  let groups = [];
  for (let i = 0; i < pulses; i++) groups.push([1]);
  let remainders = [];
  for (let i = 0; i < steps - pulses; i++) remainders.push([0]);

  while (remainders.length > 1) {
    const pairs = Math.min(groups.length, remainders.length);
    const merged = [];
    for (let i = 0; i < pairs; i++) merged.push([...groups[i], ...remainders[i]]);
    const leftover = groups.length > remainders.length
      ? groups.slice(pairs)
      : remainders.slice(pairs);
    groups = merged;
    remainders = leftover;
  }

  return [...groups.flat(), ...remainders.flat()];
}

// Format a pattern as "x . x . . x ." with the current step highlighted
export function formatPattern(pattern, currentStep = -1) {
  return pattern
    .map((v, i) => {
      const cls = i === currentStep ? "now" : v ? "on" : "off";
      const ch = v ? "x" : ".";
      return `<span class="${cls}">${ch}</span>`;
    })
    .join(" ");
}

function playKick(ctx, dest, time, vel = 1) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, time);
  osc.frequency.exponentialRampToValueAtTime(40, time + 0.18);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.9 * vel, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.4);
  osc.connect(gain).connect(dest);
  osc.start(time);
  osc.stop(time + 0.45);
}

function playSnare(ctx, dest, time, vel = 1) {
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx, 0.25);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1800;
  bp.Q.value = 0.9;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, time);
  ng.gain.exponentialRampToValueAtTime(0.6 * vel, time + 0.002);
  ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
  noise.connect(bp).connect(ng).connect(dest);
  noise.start(time);
  noise.stop(time + 0.22);

  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.setValueAtTime(220, time);
  body.frequency.exponentialRampToValueAtTime(120, time + 0.08);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.0001, time);
  bg.gain.exponentialRampToValueAtTime(0.25 * vel, time + 0.002);
  bg.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);
  body.connect(bg).connect(dest);
  body.start(time);
  body.stop(time + 0.12);
}

function playHat(ctx, dest, time, vel = 1) {
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx, 0.1);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(0.3 * vel, time + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
  noise.connect(hp).connect(g).connect(dest);
  noise.start(time);
  noise.stop(time + 0.08);
}

// cached noise to generate snare and hat sounds 
const noiseCache = new WeakMap();
function makeNoiseBuffer(ctx, seconds) {
  const key = `${seconds}`;
  let perCtx = noiseCache.get(ctx);
  if (!perCtx) { perCtx = new Map(); noiseCache.set(ctx, perCtx); }
  if (perCtx.has(key)) return perCtx.get(key);
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  perCtx.set(key, buf);
  return buf;
}

const VOICES = {
  kick: playKick,
  snare: playSnare,
  hat: playHat,
};

export class RhythmLayer {
  constructor(engine) {
    this.engine = engine;
    this.tracks = {
      kick:  { steps: 16, pulses: 4,  pattern: bjorklund(16, 4)  },
      snare: { steps: 16, pulses: 2,  pattern: bjorklund(16, 2)  },
      hat:   { steps: 16, pulses: 11, pattern: bjorklund(16, 8) },
    };
    this.enabled = false;
    this.gain = null;
    this.onPatternChange = null;
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
    const target = on ? this.targetVolume ?? 0.7 : 0;
    this.gain.gain.setTargetAtTime(target, this.engine.ctx.currentTime, 0.02);
  }

  setVolume(v) {
    this.targetVolume = v;
    if (this.enabled && this.gain) {
      this.gain.gain.setTargetAtTime(v, this.engine.ctx.currentTime, 0.02);
    }
  }

  setTrack(voice, steps, pulses) {
    const t = this.tracks[voice];
    if (!t) return;
    t.steps = steps;
    t.pulses = pulses;
    t.pattern = bjorklund(steps, pulses);
    if (this.onPatternChange) this.onPatternChange(voice, t.pattern);
  }

  // Tick triggers any voice whose pattern has a 1 at (step % length)
  tick(step, time) {
    if (!this.enabled || !this.gain) return;
    for (const [voice, track] of Object.entries(this.tracks)) {
      const pos = step % track.pattern.length;
      if (track.pattern[pos]) {
        VOICES[voice](this.engine.ctx, this.gain, time);
      }
    }
  }
}
