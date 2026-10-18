// Scale quantization: snap continuous MIDI pitches to a fixed scale
export type ScaleId = 'chromatic' | 'major' | 'pentatonic' | 'wholeTone';

export const SCALES: Record<ScaleId, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11], // C major
  pentatonic: [0, 2, 4, 7, 9], // pentatonic scale
  wholeTone: [0, 2, 4, 6, 8, 10], // whole-tone scale
};

export const SCALE_LABELS: Record<ScaleId, string> = {
  chromatic: 'Chromatic (all notes)',
  major: 'C Major',
  pentatonic: 'Pentatonic',
  wholeTone: 'Whole tone',
};

/** Quantize to the nearest in-scale note; ties resolve to the lower note */
export function quantizeMidi(midi: number, scale: ScaleId): number {
  const pcs = SCALES[scale] ?? SCALES.chromatic;
  const base = Math.floor(midi);
  let best = base;
  let bestDist = Infinity;
  for (let k = base - 12; k <= base + 12; k++) {
    const pc = ((k % 12) + 12) % 12;
    if (!pcs.includes(pc)) continue;
    const dist = Math.abs(k - midi);
    if (dist < bestDist) {
      bestDist = dist;
      best = k;
    }
  }
  return best;
}
