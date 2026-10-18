import { describe, expect, it } from 'vitest';
import type { MusicalTheme } from './models';
import { REST } from './models';
import {
  contourOf,
  contourSimilarity,
  generateVariation,
  mulberry32,
  preservesIdentity,
} from './VariationEngine';
import { buildNoteTable } from './scales';

// A hand-built triangle theme: low → rise → peak → fall → low (C Dorian)
const THEME: MusicalTheme = {
  pitches: [48, 51, 55, 60, 67, 60, 55, 50, 48],
  durations: [0.5, 0.5, 0.5, 1, 1, 0.5, 0.5, 0.5, 1],
  velocities: [0.6, 0.65, 0.7, 0.8, 0.9, 0.7, 0.65, 0.6, 0.6],
  accents: [false, false, true, false, true, false, true, false, false],
  contour: [1, 1, 1, 1, -1, -1, -1, -1],
  geometryType: 'triangle-like',
  seed: 123456789,
  scale: 'dorian',
  tonicMidi: 48,
  bpm: 88,
  closed: true,
};

const TABLE = buildNoteTable('dorian', 48);
const inScale = (p: number) => p === REST || TABLE.includes(p);

describe('determinism', () => {
  it('the same seed generates the identical variation', () => {
    const a = generateVariation(THEME, 'transposition', 0.4, mulberry32(THEME.seed));
    const b = generateVariation(THEME, 'transposition', 0.4, mulberry32(THEME.seed));
    expect(a.pitches).toEqual(b.pitches);
    expect(a.durations).toEqual(b.durations);
  });

  it('mulberry32 sequence is reproducible and stays within 0..1', () => {
    const r1 = mulberry32(7);
    const r2 = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('the six variation types', () => {
  it('transposition: contour and rhythm fully preserved, still in scale', () => {
    const v = generateVariation(THEME, 'transposition', 0.35);
    expect(contourOf(v.pitches)).toEqual(contourOf(THEME.pitches));
    expect(v.durations).toEqual(THEME.durations);
    expect(v.pitches.some((p, i) => p !== THEME.pitches[i])).toBe(true);
    expect(v.pitches.every(inScale)).toBe(true);
  });

  it('low-strength transposition makes no octave leaps', () => {
    const v = generateVariation(THEME, 'transposition', 0);
    // each note's scale-degree shift should be small (≤3 degrees ≈ within 5 semitones)
    for (let i = 0; i < v.pitches.length; i++) {
      expect(Math.abs(v.pitches[i] - THEME.pitches[i])).toBeLessThanOrEqual(7);
    }
  });

  it('rhythmic: pitches unchanged, durations augmented or diminished', () => {
    const v = generateVariation(THEME, 'rhythmic', 0.3);
    expect(v.pitches).toEqual(THEME.pitches);
    const sum = v.durations.reduce((a, b) => a + b, 0);
    const orig = THEME.durations.reduce((a, b) => a + b, 0);
    expect(sum === orig * 2 || sum === orig * 0.5 || Math.abs(sum - orig * 0.5) < 0.6).toBe(true);
  });

  it('fragmentation: builds a melodic sequence from theme material, still in scale', () => {
    const v = generateVariation(THEME, 'fragmentation', 0.45);
    expect(v.pitches.length).toBeGreaterThanOrEqual(9); // 3-note fragment × ≥3 repeats
    expect(v.pitches.every(inScale)).toBe(true);
    // the fragment's interval pattern recurs (sequence): notes 1–3 and 4–6 share internal intervals
    const d1 = v.pitches[1] - v.pitches[0];
    const d2 = v.pitches[2] - v.pitches[1];
    const d4 = v.pitches[4] - v.pitches[3];
    const d5 = v.pitches[5] - v.pitches[4];
    expect(Math.abs(d1 - d4)).toBeLessThanOrEqual(2); // degree-based sequencing allows small semitone deviations
    expect(Math.abs(d2 - d5)).toBeLessThanOrEqual(2);
  });

  it('inversion: contour mirrored, rhythm preserved', () => {
    const v = generateVariation(THEME, 'inversion', 0.35);
    expect(v.durations).toEqual(THEME.durations);
    const mirrored = contourOf(THEME.pitches).map((c) => -c);
    expect(contourSimilarity(mirrored, contourOf(v.pitches))).toBeGreaterThanOrEqual(0.8);
    // inverted around the first note, shifted back into range by octaves: first note keeps its pitch class
    expect((((v.pitches[0] - THEME.pitches[0]) % 12) + 12) % 12).toBe(0);
  });

  it('retrograde: both notes and rhythm reversed', () => {
    const v = generateVariation(THEME, 'retrograde', 0.35);
    expect(v.pitches).toEqual([...THEME.pitches].reverse());
    expect(v.durations).toEqual([...THEME.durations].reverse());
  });

  it('ornamentation: theme notes kept in order as a subsequence, ≤3 in-scale passing notes inserted', () => {
    const v = generateVariation(THEME, 'ornamentation', 0.5);
    expect(v.pitches.length).toBeGreaterThan(THEME.pitches.length);
    expect(v.pitches.length).toBeLessThanOrEqual(THEME.pitches.length + 3);
    expect(v.pitches.every(inScale)).toBe(true);
    expect(preservesIdentity(v, THEME, 'ornamentation')).toBe(true);
    // total duration unchanged (passing notes steal their time)
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    expect(sum(v.durations)).toBeCloseTo(sum(THEME.durations));
  });
});

describe('identity guard', () => {
  it('all six variation types pass the identity check', () => {
    for (const type of [
      'transposition',
      'rhythmic',
      'fragmentation',
      'inversion',
      'retrograde',
      'ornamentation',
    ] as const) {
      const v = generateVariation(THEME, type, 0.35);
      expect(preservesIdentity(v, THEME, type)).toBe(true);
    }
  });

  it('a theme containing rests still varies correctly', () => {
    const withRest: MusicalTheme = {
      ...THEME,
      pitches: [48, 51, REST, 55, 60, 55, 48],
      durations: [0.5, 0.5, 0.5, 0.5, 1, 0.5, 1],
      velocities: [0.6, 0.6, 0, 0.7, 0.8, 0.7, 0.6],
      accents: [false, false, false, true, false, false, false],
    };
    for (const type of ['transposition', 'inversion', 'retrograde', 'ornamentation'] as const) {
      const v = generateVariation(withRest, type, 0.35);
      expect(v.pitches.every(inScale)).toBe(true);
    }
  });
});
