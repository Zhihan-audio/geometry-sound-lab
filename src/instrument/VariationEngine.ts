// Variation engine: transformation instead of replacement.
// Every variation works in scale-degree space (never leaves the key), is
// driven by a deterministic PRNG seeded from the theme's geometry seed, and
// must keep the theme recognizable (contour / rhythm / material guarantees
// hold by construction; a guard double-checks them).
import type { MusicalTheme, MusicalVariation, VariationType } from './models';
import { REST } from './models';
import { buildNoteTable, nearestIndexInTable } from './scales';

/** Deterministic PRNG (mulberry32) — same seed, same variations */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/** Sign sequence of melodic steps, rests skipped */
export function contourOf(pitches: readonly number[]): number[] {
  const contour: number[] = [];
  let prev: number | null = null;
  for (const p of pitches) {
    if (p === REST) continue;
    if (prev !== null) contour.push(Math.sign(p - prev));
    prev = p;
  }
  return contour;
}

/** Fraction of matching contour steps (aligned from the start) */
export function contourSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  let same = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
  return same / Math.max(a.length, b.length);
}

interface DegreeNote {
  degree: number | null; // null = rest
  duration: number;
  velocity: number;
  accent: boolean;
}

function toDegrees(theme: MusicalTheme, table: number[]): DegreeNote[] {
  return theme.pitches.map((p, i) => ({
    degree: p === REST ? null : nearestIndexInTable(table, p),
    duration: theme.durations[i],
    velocity: theme.velocities[i],
    accent: theme.accents[i],
  }));
}

function fromDegrees(
  notes: DegreeNote[],
  table: number[],
  theme: MusicalTheme,
  type: VariationType,
  strength: number,
): MusicalVariation {
  const clampIdx = (d: number) => Math.max(0, Math.min(table.length - 1, d));
  return {
    sourceSeed: theme.seed,
    transformationType: type,
    variationStrength: strength,
    pitches: notes.map((n) => (n.degree === null ? REST : table[clampIdx(n.degree)])),
    durations: notes.map((n) => n.duration),
    velocities: notes.map((n) => n.velocity),
    accents: notes.map((n) => n.accent),
  };
}

const DEFAULT_STRENGTH = 0.35;

/** Variation 1 — register / transposition: contour and rhythm fully kept */
function transpose(notes: DegreeNote[], rng: () => number, strength: number, pcsPerOctave: number): DegreeNote[] {
  let offset = pick(rng, [2, 3, -2, -3]);
  if (strength > 0.5 && rng() < 0.5) {
    offset += (offset > 0 ? 1 : -1) * pcsPerOctave; // register shift up/down one octave
  }
  return notes.map((n) => ({ ...n, degree: n.degree === null ? null : n.degree + offset }));
}

/** Variation 2 — rhythmic: pitches kept, durations transformed on the grid */
function rhythmic(notes: DegreeNote[], rng: () => number, strength: number): DegreeNote[] {
  const factor = rng() < 0.5 ? 2 : 0.5; // augmentation / diminution
  let out = notes.map((n) => ({
    ...n,
    duration: Math.max(0.25, Math.min(4, n.duration * factor)),
  }));
  if (strength >= 0.5 && out.length >= 3) {
    // Light syncopation: swap one adjacent duration pair
    const at = 1 + Math.floor(rng() * (out.length - 2));
    const d = out[at].duration;
    out[at] = { ...out[at], duration: out[at + 1]?.duration ?? d };
    if (out[at + 1]) out[at + 1] = { ...out[at + 1], duration: d };
  }
  if (strength > 0.7 && out.length >= 4) {
    const at = 1 + Math.floor(rng() * (out.length - 2));
    out = [
      ...out.slice(0, at),
      { degree: null, duration: 0.25, velocity: 0, accent: false },
      ...out.slice(at),
    ];
  }
  return out;
}

/** Variation 3 — fragmentation: a 3-note core fragment built into a sequence */
function fragment(notes: DegreeNote[], rng: () => number, strength: number): DegreeNote[] {
  const sounding = notes.filter((n) => n.degree !== null);
  if (sounding.length < 3) return notes.map((n) => ({ ...n }));

  // Choose the most important window: prefer accents and the melodic peak
  let bestStart = 0;
  let bestScore = -Infinity;
  const peak = Math.max(...sounding.map((n) => n.degree as number));
  for (let i = 0; i + 3 <= sounding.length; i++) {
    const win = sounding.slice(i, i + 3);
    const score =
      win.filter((n) => n.accent).length * 3 +
      (win.some((n) => n.degree === peak) ? 2 : 0) +
      rng() * 0.1;
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }
  const frag = sounding.slice(bestStart, bestStart + 3);
  const steps = strength > 0.6 ? [0, 1, 2, 1] : [0, 1, 2]; // ascending sequence
  const direction = rng() < 0.5 ? 1 : -1;
  const out: DegreeNote[] = [];
  for (const s of steps) {
    for (const n of frag) {
      out.push({ ...n, degree: (n.degree as number) + s * direction });
    }
  }
  // Settle: lengthen the final note so the phrase breathes
  const last = out[out.length - 1];
  out[out.length - 1] = { ...last, duration: Math.min(2, last.duration * 2) };
  return out;
}

/**
 * Variation 4 — inversion: intervals mirrored around the first note, rhythm
 * kept. The mirrored line is then shifted by whole octaves back into range
 * (keeping the first note's pitch class), so a theme that starts at the very
 * bottom of the register never collapses onto the floor.
 */
function invert(notes: DegreeNote[], tableLength: number, pcsPerOctave: number): DegreeNote[] {
  const first = notes.find((n) => n.degree !== null);
  if (!first) return notes.map((n) => ({ ...n }));
  const center = first.degree as number;
  let mirrored = notes.map((n) => ({
    ...n,
    degree: n.degree === null ? null : 2 * center - n.degree,
  }));
  const degs = mirrored.filter((n) => n.degree !== null).map((n) => n.degree as number);
  const min = Math.min(...degs);
  const max = Math.max(...degs);
  let shift = 0;
  if (min < 0) shift = Math.ceil(-min / pcsPerOctave) * pcsPerOctave;
  else if (max > tableLength - 1) shift = -Math.ceil((max - (tableLength - 1)) / pcsPerOctave) * pcsPerOctave;
  if (shift !== 0) {
    mirrored = mirrored.map((n) => ({
      ...n,
      degree: n.degree === null ? null : n.degree + shift,
    }));
  }
  return mirrored;
}

/** Variation 5 — retrograde: the theme read backwards (a clear structural move) */
function retrograde(notes: DegreeNote[]): DegreeNote[] {
  return [...notes].reverse().map((n) => ({ ...n }));
}

/** Variation 6 — ornamentation: in-scale passing notes between wide steps */
function ornament(notes: DegreeNote[], rng: () => number, strength: number): DegreeNote[] {
  const maxInsertions = 1 + Math.round(strength * 2); // 1..3
  const out: DegreeNote[] = [];
  let inserted = 0;
  for (let i = 0; i < notes.length; i++) {
    const cur = notes[i];
    out.push({ ...cur });
    const next = notes[i + 1];
    if (
      inserted < maxInsertions &&
      cur.degree !== null &&
      next?.degree != null &&
      Math.abs(next.degree - cur.degree) >= 2 &&
      cur.duration >= 0.5 &&
      rng() < 0.75
    ) {
      // Steal a sixteenth from the current note for a passing tone
      out[out.length - 1] = { ...cur, duration: cur.duration - 0.25 };
      out.push({
        degree: Math.round((cur.degree + next.degree) / 2),
        duration: 0.25,
        velocity: Math.max(0.25, cur.velocity * 0.7),
        accent: false,
      });
      inserted++;
    }
  }
  return out;
}

/**
 * Recognizability guard. Construction should already guarantee these; the
 * guard is the safety net that keeps the engine from drifting into a random
 * melody generator if a transformation is ever changed carelessly.
 */
export function preservesIdentity(
  variation: MusicalVariation,
  theme: MusicalTheme,
  type: VariationType,
): boolean {
  const themeContour = contourOf(theme.pitches);
  const varContour = contourOf(variation.pitches);
  switch (type) {
    case 'transposition':
      return contourSimilarity(themeContour, varContour) >= 0.99;
    case 'rhythmic':
      return (
        variation.pitches.filter((p) => p !== REST).join(',') ===
        theme.pitches.filter((p) => p !== REST).join(',')
      );
    case 'ornamentation': {
      // Theme notes must survive, in order, as a subsequence
      const themeNotes = theme.pitches.filter((p) => p !== REST);
      const varNotes = variation.pitches.filter((p) => p !== REST);
      let j = 0;
      for (const p of varNotes) {
        if (j < themeNotes.length && p === themeNotes[j]) j++;
      }
      return j === themeNotes.length;
    }
    case 'inversion':
      return contourSimilarity(themeContour.map((c) => -c), varContour) >= 0.8;
    case 'retrograde':
      return contourSimilarity([...themeContour].reverse().map((c) => -c), varContour) >= 0.8;
    case 'fragmentation':
      return variation.pitches.filter((p) => p !== REST).length >= 3;
  }
}

export function generateVariation(
  theme: MusicalTheme,
  type: VariationType,
  strength: number = DEFAULT_STRENGTH,
  rng: () => number = mulberry32(theme.seed),
): MusicalVariation {
  const s = Math.max(0, Math.min(1, strength));
  const table = buildNoteTable(theme.scale, theme.tonicMidi);
  const pcsPerOctave = Math.round((table.length - 1) / 3);
  const degrees = toDegrees(theme, table);

  let transformed: DegreeNote[];
  switch (type) {
    case 'transposition':
      transformed = transpose(degrees, rng, s, pcsPerOctave);
      break;
    case 'rhythmic':
      transformed = rhythmic(degrees, rng, s);
      break;
    case 'fragmentation':
      transformed = fragment(degrees, rng, s);
      break;
    case 'inversion':
      transformed = invert(degrees, table.length, pcsPerOctave);
      break;
    case 'retrograde':
      transformed = retrograde(degrees);
      break;
    case 'ornamentation':
      transformed = ornament(degrees, rng, s);
      break;
  }

  const variation = fromDegrees(transformed, table, theme, type, s);
  if (!preservesIdentity(variation, theme, type)) {
    console.warn(`Variation '${type}' failed the identity guard — using transposition instead`);
    return fromDegrees(transpose(degrees, rng, 0.2, pcsPerOctave), table, theme, 'transposition', 0.2);
  }
  return variation;
}
