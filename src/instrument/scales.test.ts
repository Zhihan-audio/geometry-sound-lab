import { describe, expect, it } from 'vitest';
import {
  buildNoteTable,
  nearestIndexInTable,
  NoteHysteresis,
  PERFORMANCE_SCALES,
  yToTableIndex,
} from './scales';

describe('performance scale tables', () => {
  it('C Dorian degrees are correct (C D Eb F G A Bb)', () => {
    expect(PERFORMANCE_SCALES.dorian).toEqual([0, 2, 3, 5, 7, 9, 10]);
  });

  it('note table spans C3 to C6, tonic at both ends', () => {
    const table = buildNoteTable('dorian', 48, 3);
    expect(table[0]).toBe(48); // C3
    expect(table[table.length - 1]).toBe(84); // C6
    expect(table).toHaveLength(7 * 3 + 1);
    // strictly ascending
    for (let i = 1; i < table.length; i++) {
      expect(table[i]).toBeGreaterThan(table[i - 1]);
    }
  });

  it('pentatonic table has the right length', () => {
    expect(buildNoteTable('majorPentatonic', 48, 3)).toHaveLength(5 * 3 + 1);
  });

  it('y=0 is the lowest note, y=1 the highest', () => {
    const table = buildNoteTable('dorian');
    expect(table[yToTableIndex(0, table.length)]).toBe(48);
    expect(table[yToTableIndex(1, table.length)]).toBe(84);
  });

  it('nearestIndexInTable finds the nearest note', () => {
    const table = buildNoteTable('dorian', 48, 1); // C3..C4
    expect(table[nearestIndexInTable(table, 48)]).toBe(48);
    expect(table[nearestIndexInTable(table, 49)]).toBeLessThanOrEqual(50);
    expect(table[nearestIndexInTable(table, 84)]).toBe(60); // out of range clamps to the top
  });
});

describe('note hysteresis (anti-jitter)', () => {
  const LEN = 22; // dorian 3 octaves

  it('the first mapping takes the nearest note directly', () => {
    const h = new NoteHysteresis();
    expect(h.map(0.5, LEN)).toBe(Math.round(0.5 * (LEN - 1)));
  });

  it('slight jitter near a note boundary does not switch notes', () => {
    const h = new NoteHysteresis(0.18);
    const idx = h.map(10 / (LEN - 1), LEN); // lands exactly on note 10
    expect(idx).toBe(10);
    // boundary at 10.5: jitter between 10.45 ↔ 10.55 (plain quantization would keep flipping)
    expect(h.map(10.45 / (LEN - 1), LEN)).toBe(10);
    expect(h.map(10.55 / (LEN - 1), LEN)).toBe(10);
    expect(h.map(10.6 / (LEN - 1), LEN)).toBe(10); // still within 0.5+0.18
  });

  it('switches notes after clearly crossing the boundary', () => {
    const h = new NoteHysteresis(0.18);
    h.map(10 / (LEN - 1), LEN);
    expect(h.map(10.75 / (LEN - 1), LEN)).toBe(11);
  });

  it('a large move jumps straight to the target note (fast sweeps unrestricted)', () => {
    const h = new NoteHysteresis();
    h.map(0, LEN);
    expect(h.map(1, LEN)).toBe(LEN - 1);
  });

  it('starts fresh after reset', () => {
    const h = new NoteHysteresis();
    h.map(0.9, LEN);
    h.reset();
    expect(h.current).toBeNull();
    expect(h.map(0.1, LEN)).toBe(Math.round(0.1 * (LEN - 1)));
  });
});
