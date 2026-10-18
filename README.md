# Geometry Sound Lab

**A desktop and web app that teaches geometry to blind and low-vision students through sound — and turns drawing into music.**

A single voice travels along the outline of a shape: left–right position becomes stereo panning, height becomes musical pitch, and short cue sounds mark corners, crossings, and closure. Students can *hear* a triangle, trace a circle with arrow keys, practice with spoken quizzes — and in Instrument mode, the act of drawing a shape becomes a musical performance that the app develops into a short composition.

The idea came from seven months of volunteer tutoring with blind middle school students, and the design was shaped by their feedback across two rounds of testing.

> 🎧 **Try it in your browser (headphones recommended):** _[live demo link — enable GitHub Pages to activate]_

## What it does

- **Hear geometry.** Whole-shape playback, edge-by-edge study (direction, slope, and length spoken aloud), and free exploration with the arrow keys. The grid is a real coordinate plane with its origin at the center.
- **Practice by ear.** Four stages of listening quizzes — sound position, lines, whole shapes, geometric relationships — fully operable by keyboard, with questions, choices, and explanations spoken aloud.
- **Teach with it.** A teacher editor for drawing custom shapes, entering exact coordinates, and saving or sharing shape files.
- **Play it like an instrument.** Trace a shape with a mouse, touch, or a hand in front of the camera (on-device hand tracking, fully offline). Height picks notes from a scale, corners strike accents, closing a shape plays a cadence. The app extracts a short musical theme from the drawing — the *same* shape always yields the same melody — and develops it into a seven-section composition using six classical variation techniques, with a spoken explanation mode that alternates narration and live musical examples.
- **Blind-first by design.** Self-voicing interface (startup orientation, a 13-step voice tour, spoken controls), screen-reader-friendly markup, every feature reachable by keyboard, speech at 1.5× by default with a 0.5–3× range, and cue sounds spread across the spectrum so events are easy to tell apart. English and Chinese, fully offline.

## Quick start

```bash
npm install        # Node.js >= 20.19
npm run dev        # desktop app (Vite + Electron)
npm run dev:web    # browser only, http://localhost:5173
npm run test       # 179 unit tests (Vitest)
npm run build      # production build
npm run dist:mac   # macOS installers (dmg + zip)
```

## How the sound mapping works

Coordinates are normalized to `x, y ∈ [0, 1]` internally; the interface displays and speaks them as a centered coordinate plane (−5 … +5 grid units).

```
pan  = x * 2 - 1                          # stereo position, left to right
midi = minMidi + y * (maxMidi - minMidi)  # C3..C6 by default, quantized to a scale
freq = 440 * 2^((midi - 69) / 12)
```

Straight edges are quantized to scale notes so students hear *steps*; smooth curves (circles, arcs, sine waves) automatically use a continuous glide so their shape stays recognizable. Corners click at 2093 Hz, crossings pulse at 587 Hz, closure plays a rising arpeggio — every cue lives in its own register.

## Tech

Electron 37 · React 19 · TypeScript 5.8 · Vite 7 · Web Audio API (no audio libraries) · MediaPipe hand tracking (bundled, offline) · Vitest — **179 automated tests** covering geometry, sonification, scheduling, theme extraction, and variation logic. The audio engine, geometry math, and instrument pipeline are pure modules, independent of the UI.

Developed with AI assistance, directed and tested by the author; design decisions were driven by feedback from blind student testers.

## License

MIT © Zhihan Pan
