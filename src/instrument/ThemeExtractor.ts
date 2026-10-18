// Theme extraction: turns a completed gesture trace into a short, memorable
// musical motif (8–12 notes). The GEOMETRY decides the pitches and rhythm
// skeleton (via arc-length resampling — drawing fast or slow gives the same
// contour); the GESTURE decides only the expression (velocities, rests).
import type { GestureSample, MusicalTheme, PerformanceScaleId } from './models';
import { REST } from './models';
import {
  cleanTrace,
  countCorners,
  detectImportantPoints,
  isClosedTrace,
  resampleByArcLength,
  totalArcLength,
  turnAngleAt,
  type ImportantPoint,
} from './GestureAnalyzer';
import { buildNoteTable, DEFAULT_OCTAVES, DEFAULT_TONIC_MIDI, yToTableIndex } from './scales';

export interface ExtractOptions {
  scale: PerformanceScaleId;
  tonicMidi?: number;
  octaves?: number;
  bpm?: number;
  minNotes?: number;
  maxNotes?: number;
}

const RESAMPLE_N = 64;
const MIN_ARC = 0.15;
const TOTAL_BEATS = 8;
const BEAT_GRID = [0.25, 0.375, 0.5, 0.75, 1, 1.5, 2];
const PAUSE_REST_MS = 600;

function quantizeBeats(beats: number): number {
  let best = BEAT_GRID[0];
  let bestDist = Infinity;
  for (const g of BEAT_GRID) {
    const d = Math.abs(g - beats);
    if (d < bestDist) {
      bestDist = d;
      best = g;
    }
  }
  return best;
}

/** FNV-1a hash — deterministic seed from geometry (never from timing) */
function hashNumbers(values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function classifyGeometry(
  closed: boolean,
  corners: number,
  meanTurn: number,
): string {
  if (closed) {
    if (corners <= 1) return 'circle-like';
    if (corners === 2) return 'triangle-like';
    if (corners === 3) return 'quadrilateral-like';
    return 'polygon-like';
  }
  if (corners === 0) return meanTurn < 0.06 ? 'line-like' : 'arc-like';
  return 'zigzag-like';
}

/** Importance score used when there are more candidate points than notes */
function importanceScore(p: ImportantPoint): number {
  let score = 0;
  if (p.kinds.includes('start') || p.kinds.includes('end')) score += 100;
  if (p.kinds.includes('corner')) score += 3 + p.turn;
  if (p.kinds.includes('ymax') || p.kinds.includes('ymin')) score += 2;
  return score;
}

/**
 * Select the motif's note indices on the resampled trace: all important points,
 * capped at maxNotes by importance, padded to minNotes by splitting the longest
 * gaps (which, on an arc-length resampled trace, are the longest segments).
 */
export function selectNoteIndices(
  important: ImportantPoint[],
  totalPoints: number,
  minNotes: number,
  maxNotes: number,
): number[] {
  let chosen = [...important];
  if (chosen.length > maxNotes) {
    chosen = chosen
      .slice()
      .sort((a, b) => importanceScore(b) - importanceScore(a))
      .slice(0, maxNotes)
      .sort((a, b) => a.index - b.index);
  }
  const indices = chosen.map((p) => p.index);
  const cap = Math.min(minNotes, totalPoints);
  while (indices.length < cap) {
    let widest = 0;
    let at = -1;
    for (let i = 1; i < indices.length; i++) {
      const gap = indices[i] - indices[i - 1];
      if (gap > widest) {
        widest = gap;
        at = i;
      }
    }
    if (at < 0 || widest < 2) break;
    indices.splice(at, 0, indices[at - 1] + Math.floor(widest / 2));
  }
  return indices;
}

/**
 * Extract a musical theme from a raw gesture trace.
 * Returns null when the trace is too small to mean anything.
 */
export function extractTheme(
  raw: readonly GestureSample[],
  opts: ExtractOptions,
): MusicalTheme | null {
  const tonicMidi = opts.tonicMidi ?? DEFAULT_TONIC_MIDI;
  const octaves = opts.octaves ?? DEFAULT_OCTAVES;
  const bpm = opts.bpm ?? 88;
  const minNotes = opts.minNotes ?? 8;
  const maxNotes = opts.maxNotes ?? 12;

  const cleaned = cleanTrace(raw);
  if (cleaned.length < 6 || totalArcLength(cleaned) < MIN_ARC) return null;

  const closed = isClosedTrace(cleaned);
  const rs = resampleByArcLength(cleaned, RESAMPLE_N);
  const important = detectImportantPoints(rs);
  const corners = countCorners(important);
  const meanTurn =
    rs.reduce((sum, _s, i) => sum + turnAngleAt(rs, i), 0) / Math.max(1, rs.length);

  const noteIndices = selectNoteIndices(important, RESAMPLE_N, minNotes, maxNotes);
  const importantByIndex = new Map(important.map((p) => [p.index, p]));
  const table = buildNoteTable(opts.scale, tonicMidi, octaves);

  const pitches: number[] = [];
  const durations: number[] = [];
  const velocities: number[] = [];
  const accents: boolean[] = [];

  // Median inter-note gesture time — used to hear real pauses
  const gaps: number[] = [];
  for (let i = 1; i < noteIndices.length; i++) {
    gaps.push(rs[noteIndices[i]].t - rs[noteIndices[i - 1]].t);
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0;

  const arcPerIndex = 1 / (RESAMPLE_N - 1);
  let restsInserted = 0;

  for (let i = 0; i < noteIndices.length; i++) {
    const idx = noteIndices[i];
    const sample = rs[idx];

    // Pitch: geometry only (Y position quantized to the scale)
    pitches.push(table[yToTableIndex(sample.y, table.length)]);

    // Duration: proportional to the segment's true length, quantized
    const gapIndices = i < noteIndices.length - 1 ? noteIndices[i + 1] - idx : 0;
    const rawBeats =
      i < noteIndices.length - 1
        ? (gapIndices / (RESAMPLE_N - 1)) * TOTAL_BEATS
        : 1; // final note: one settled beat
    durations.push(quantizeBeats(Math.max(0.25, rawBeats)));

    // Velocity: expression from local gesture speed
    const prev = rs[Math.max(0, idx - 1)];
    const next = rs[Math.min(RESAMPLE_N - 1, idx + 1)];
    const dt = Math.max(1, next.t - prev.t) / 1000;
    const speed = (2 * arcPerIndex * totalArcLength(cleaned)) / dt;
    velocities.push(Math.max(0.3, Math.min(1, 0.45 + 0.5 * Math.tanh(speed / 0.9))));

    accents.push(importantByIndex.get(idx)?.kinds.includes('corner') ?? false);

    // A real pause in the gesture becomes a musical rest (max 2)
    if (
      i < noteIndices.length - 1 &&
      restsInserted < 2 &&
      medianGap > 0 &&
      gaps[i] > Math.max(PAUSE_REST_MS, 2.5 * medianGap)
    ) {
      pitches.push(REST);
      durations.push(0.5);
      velocities.push(0);
      accents.push(false);
      restsInserted++;
    }
  }

  // Contour: sign of each melodic step (rests skipped)
  const contour: number[] = [];
  let prevPitch: number | null = null;
  for (const p of pitches) {
    if (p === REST) continue;
    if (prevPitch !== null) contour.push(Math.sign(p - prevPitch));
    prevPitch = p;
  }

  // Deterministic seed from the geometry alone: rounded resampled Y contour
  const seed = hashNumbers([
    ...rs.map((s) => Math.round(s.y * 10)),
    closed ? 1 : 0,
    corners,
  ]);

  return {
    pitches,
    durations,
    velocities,
    accents,
    contour,
    geometryType: classifyGeometry(closed, corners, meanTurn),
    seed,
    scale: opts.scale,
    tonicMidi,
    bpm,
    closed,
  };
}

/** Total theme length in beats (rests included) */
export function themeBeats(theme: Pick<MusicalTheme, 'durations'>): number {
  return theme.durations.reduce((a, b) => a + b, 0);
}
