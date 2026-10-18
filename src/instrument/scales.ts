// Performance scales for the instrument mode: Y position maps to a scale-degree
// note table (not raw frequency), with hysteresis so tiny hand jitter never
// flutters between two neighbouring notes.
import type { PerformanceScaleId } from './models';

export const PERFORMANCE_SCALES: Record<PerformanceScaleId, number[]> = {
  dorian: [0, 2, 3, 5, 7, 9, 10], // C Dorian: C D Eb F G A Bb
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const PERFORMANCE_SCALE_LABELS: Record<PerformanceScaleId, string> = {
  dorian: 'C Dorian',
  majorPentatonic: 'Major Pentatonic',
  minorPentatonic: 'Minor Pentatonic',
  chromatic: 'Chromatic',
};

export const DEFAULT_TONIC_MIDI = 48; // C3
export const DEFAULT_OCTAVES = 3; // C3 .. C6

/**
 * Ascending MIDI note table spanning `octaves` octaves from the tonic,
 * ending on the top tonic (so y=1 lands exactly on the high octave root).
 */
export function buildNoteTable(
  scale: PerformanceScaleId,
  tonicMidi: number = DEFAULT_TONIC_MIDI,
  octaves: number = DEFAULT_OCTAVES,
): number[] {
  const pcs = PERFORMANCE_SCALES[scale];
  const table: number[] = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const pc of pcs) {
      table.push(tonicMidi + oct * 12 + pc);
    }
  }
  table.push(tonicMidi + octaves * 12);
  return table;
}

/** Nearest table index for a MIDI note (used by theme extraction / variations) */
export function nearestIndexInTable(table: number[], midi: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < table.length; i++) {
    const d = Math.abs(table[i] - midi);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Direct (stateless) y → table index quantization */
export function yToTableIndex(y01: number, tableLength: number): number {
  const y = Math.max(0, Math.min(1, y01));
  return Math.round(y * (tableLength - 1));
}

/**
 * Sticky y → note-index mapping. The note only changes when the continuous
 * position moves clearly past a boundary (0.5 + margin), so hovering on a
 * boundary never flutters between two notes.
 */
export class NoteHysteresis {
  private index: number | null = null;

  constructor(private margin = 0.18) {}

  map(y01: number, tableLength: number): number {
    const pos = Math.max(0, Math.min(1, y01)) * (tableLength - 1);
    if (this.index === null) {
      this.index = Math.round(pos);
      return this.index;
    }
    if (Math.abs(pos - this.index) > 0.5 + this.margin) {
      // Step toward the target one boundary at a time keeps fast sweeps
      // continuous while still filtering boundary jitter.
      this.index = Math.round(pos);
    }
    return this.index;
  }

  get current(): number | null {
    return this.index;
  }

  reset(): void {
    this.index = null;
  }
}
