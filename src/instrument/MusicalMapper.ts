// Maps live gesture features to continuous instrument parameters.
// Pitch (from Y, scale-quantized with hysteresis) is always the primary
// information; speed / direction / curvature only modulate dynamics and
// timbre within conservative ranges so the instrument stays ONE instrument.
import type { InstrumentParams, LiveFeatures, PerformanceScaleId } from './models';
import { buildNoteTable, DEFAULT_OCTAVES, DEFAULT_TONIC_MIDI, NoteHysteresis } from './scales';

const PAN_LIMIT = 0.75;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class LiveMusicalMapper {
  private table: number[];
  private hysteresis = new NoteHysteresis();
  private gainEma = 0.45;
  private brightEma = 0.5;
  private modEma = 0;

  constructor(
    scale: PerformanceScaleId,
    private tonicMidi: number = DEFAULT_TONIC_MIDI,
    private octaves: number = DEFAULT_OCTAVES,
  ) {
    this.table = buildNoteTable(scale, tonicMidi, octaves);
  }

  get noteTable(): number[] {
    return this.table;
  }

  setScale(scale: PerformanceScaleId): void {
    this.table = buildNoteTable(scale, this.tonicMidi, this.octaves);
    this.hysteresis.reset();
  }

  map(f: LiveFeatures): InstrumentParams {
    const noteIndex = this.hysteresis.map(f.y, this.table.length);
    const midi = this.table[noteIndex];

    // Stereo position: mapped but never hard left/right
    const pan = Math.max(-1, Math.min(1, f.x * 2 - 1)) * PAN_LIMIT;

    // Dynamics: nonlinear (tanh) with a floor so slow strokes stay audible,
    // then smoothed so speed changes can never pop
    const targetGain = 0.32 + 0.6 * Math.tanh(f.speed / 0.9);
    this.gainEma += 0.15 * (targetGain - this.gainEma);

    // Brightness: speed opens the filter; direction adds a subtle tilt
    // (upward strokes slightly brighter, downward slightly darker)
    const dirTilt = f.angle === null ? 0 : Math.sin(f.angle);
    const targetBright = clamp01(0.35 + 0.45 * Math.tanh(f.speed / 1.1) + 0.12 * dirTilt);
    this.brightEma += 0.12 * (targetBright - this.brightEma);

    // Curvature: straight lines are clean; curves add gentle modulation
    this.modEma += 0.2 * (f.curvature - this.modEma);

    const harmonic = clamp01(0.15 + 0.4 * Math.tanh(f.speed / 1.2));

    return {
      midi,
      noteIndex,
      pan,
      gain: clamp01(this.gainEma),
      brightness: clamp01(this.brightEma),
      modDepth: clamp01(this.modEma),
      harmonic,
    };
  }

  reset(): void {
    this.hysteresis.reset();
    this.gainEma = 0.45;
    this.brightEma = 0.5;
    this.modEma = 0;
  }
}
