# generative-soundboard

An interactive WebAudio "mini algorave" soundboard. Three generative layers — rhythm, melody, texture — run on a shared transport and can be toggled, mixed, and reshaped live. Loosely inspired by [strudel.cc](https://strudel.cc/), but built from scratch on the raw WebAudio API.

🔊 **Live demo:** [luana-l.github.io/generative-soundboard](https://luana-l.github.io/generative-soundboard/)

📝 **Write-up:** [luana-l.github.io/generative-soundboard/blog.html](https://luana-l.github.io/generative-soundboard/blog.html)

## Layers

- **rhythm** — three drum voices (kick, snare, hat) driven by independent [Euclidean rhythms](https://louridas.github.io/rwa/assignments/musical-rhythms/) generated with Bjorklund's algorithm, so that k notes are evenly distributed over n time steps. Allows steps and pulses to be adjusted per voice; and pattern is recomputed live
- **melody** — two modes: a **random walk** through pitches drawn from a **pitch class set** under transposition and inversion, or **cellular automaton (eno)** — see below. Each note is rendered with FM synthesis
- **texture** — three detuned sawtooth oscillators voiced as a chord snapped to the melody's effective pitch class set, routed through a lowpass filter whose cutoff is modulated by an LFO. Slow fades in/out

## Brian Eno influence

Brian eno frames generative composers as a *gardener* who plants conditions and lets the system unfold rather than dictating every note. A recurring technique: a tiny rule set, applied repeatedly, produces the output, never quite the same.

Two pieces of this project lean on that idea:

- **Melody → cellular automaton (eno) mode**: a 16-cell binary row evolves as a one-dimensional elementary CA similar to the one Eno cites when discussing Conway's Game of Life. Each step of the bar reads one cell: if alive, a note fires; the pitch is drawn from the active pcset by cell index.
- **Texture as harmonic environment**: rather than letting the drone clash with the melody, `texture.setHarmony(pcset)` snaps its three voices to the melody's transposed/inverted pcset. This mimics Eno's habit of designing the environment and letting parts coexist rather than choreographing them.

All three layers route through their own `GainNode`, then a master `GainNode`, then to `destination`.

## Project structure

```
index.html          UI shell
styles.css          UI styling
src/audio-engine.js Shared AudioContext, master bus, lookahead scheduler
src/rhythm.js       Bjorklund Euclidean rhythm + drum synthesis
src/melody.js       Pitch class set ops + FM synthesis voice
src/texture.js      Detuned-saw with LFO-modulated filter
src/main.js         DOM wiring
```

## Features

- FM synthesis
- Per-layer `GainNode` routing into a master `GainNode` into `destination`.
- `AudioParam` ADSR envelopes via `setTargetAtTime` for smooth volume / cutoff / detune ramps.
- **Pitch class set theory** in `melody.js` — transposition and inversion operations on pitch class sets
- A lookahead scheduler in `audio-engine.js` (`scheduler()` + `setInterval` clock) that schedules events
- **Bjorklund's algorithm** for Euclidean rhythms in `rhythm.js` — distributes `k` pulses as evenly as possible across `n` steps by iteratively merging remainder groups into front groups.
- **Cellular Automata** in `melody.js` — a 16-cell row evolves one generation per bar to produce constantly mutating melodic patterns.

## Authors

Built by **Luana Liao** and **Minseul Kim**. Much of the project was pair-programmed — sketching the audio graph, debugging timing, and shaping the UI together — with each of us also taking lead on individual layers and features.

## Credits

- Inspired by [strudel.cc](https://strudel.cc/) — the in-browser live-coding environment that made us want to try this from scratch.
- Euclidean rhythms / Bjorklund's algorithm learned from [Panos Louridas — Real World Algorithms: Musical Rhythms](https://louridas.github.io/rwa/assignments/musical-rhythms/).
- Generative-music framing (the "gardener" idea, cellular automata as composition) drawn from Brian Eno's talks and writing.
- Thanks to our professor **Mark Santolucito**.