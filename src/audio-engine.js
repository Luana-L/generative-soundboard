// Shared AudioContext, master bus, and a lookahead scheduler clock.

const LOOKAHEAD_MS = 25;        // scheduler wakeup interval
const SCHEDULE_AHEAD_S = 0.1;   // how far ahead to queue events
const STEPS_PER_BEAT = 4;       // 16th-note resolution

function makeReverbIR(ctx, seconds = 2.4) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bpm = 110;
    this.stepIndex = 0;
    this.nextStepTime = 0;
    this.timer = null;
    this.running = false;
    this.tickHandlers = new Set();
  }

  // Lazy-construct context on first user gesture
  ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);

    this.fxInput = this.ctx.createGain();
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = makeReverbIR(this.ctx, 2.4);
    this.reverbOutputGain = this.ctx.createGain();
    this.reverbOutputGain.gain.value = 0.7;
    this.fxInput.connect(this.reverb);
    this.reverb.connect(this.reverbOutputGain);
    this.reverbOutputGain.connect(this.master);
  }

  setMasterGain(value) {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  setBpm(bpm) {
    this.bpm = Math.max(40, Math.min(220, bpm));
  }

  // Register a per-step callback. Receives (stepIndex, audioTime).
  onTick(handler) {
    this.tickHandlers.add(handler);
    return () => this.tickHandlers.delete(handler);
  }

  start() {
    this.ensureContext();
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (this.running) return;
    this.running = true;
    this.stepIndex = 0;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.scheduler(), LOOKAHEAD_MS);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Step duration at the current BPM (one 16th note).
  stepDuration() {
    return 60 / this.bpm / STEPS_PER_BEAT;
  }

  // Scheduler loop runs timer and queues audio events before they need to play
  scheduler() {
    if (!this.running) return;
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD_S;
    while (this.nextStepTime < horizon) {
      for (const handler of this.tickHandlers) {
        handler(this.stepIndex, this.nextStepTime);
      }
      this.stepIndex = (this.stepIndex + 1) % 1024;
      this.nextStepTime += this.stepDuration();
    }
  }
}

export const STEPS = STEPS_PER_BEAT;
