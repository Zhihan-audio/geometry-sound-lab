import { describe, expect, it } from 'vitest';
import type { GestureSample } from './models';
import { REST } from './models';
import { extractTheme, themeBeats } from './ThemeExtractor';

function walk(waypoints: [number, number][], step = 0.01, dtMs = 10, t0 = 0): GestureSample[] {
  const out: GestureSample[] = [];
  let t = t0;
  for (let w = 0; w < waypoints.length - 1; w++) {
    const [ax, ay] = waypoints[w];
    const [bx, by] = waypoints[w + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(len / step));
    for (let i = 0; i < steps; i++) {
      const f = i / steps;
      out.push({ x: ax + (bx - ax) * f, y: ay + (by - ay) * f, t });
      t += dtMs;
    }
  }
  const last = waypoints[waypoints.length - 1];
  out.push({ x: last[0], y: last[1], t });
  return out;
}

const TRIANGLE: [number, number][] = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.5, 0.8],
  [0.2, 0.2],
];

const OPTS = { scale: 'dorian' as const };

describe('theme extraction', () => {
  it('triangle → 8–12 notes, closed, recognized as triangle-like', () => {
    const theme = extractTheme(walk(TRIANGLE), OPTS)!;
    expect(theme).not.toBeNull();
    const notes = theme.pitches.filter((p) => p !== REST);
    expect(notes.length).toBeGreaterThanOrEqual(8);
    expect(notes.length).toBeLessThanOrEqual(12);
    expect(theme.closed).toBe(true);
    expect(theme.geometryType).toBe('triangle-like');
  });

  it('triangle melodic contour: rise then fall (low→high→low)', () => {
    const theme = extractTheme(walk(TRIANGLE), OPTS)!;
    const notes = theme.pitches.filter((p) => p !== REST);
    const peak = Math.max(...notes);
    const peakIdx = notes.indexOf(peak);
    expect(peakIdx).toBeGreaterThan(0);
    expect(peakIdx).toBeLessThan(notes.length - 1);
    expect(notes[0]).toBeLessThan(peak);
    expect(notes[notes.length - 1]).toBeLessThan(peak);
    expect(theme.contour).toContain(1);
    expect(theme.contour).toContain(-1);
  });

  it('all notes are in scale and within the C3..C6 range', () => {
    const theme = extractTheme(walk(TRIANGLE), OPTS)!;
    for (const p of theme.pitches) {
      if (p === REST) continue;
      expect(p).toBeGreaterThanOrEqual(48);
      expect(p).toBeLessThanOrEqual(84);
      expect([0, 2, 3, 5, 7, 9, 10, 12]).toContain(((p - 48) % 12 + 12) % 12);
    }
  });

  it('geometry defines musical identity: the same triangle fast or slow → same pitches, rhythm and seed', () => {
    const fast = extractTheme(walk(TRIANGLE, 0.01, 4), OPTS)!;
    const slow = extractTheme(walk(TRIANGLE, 0.01, 40), OPTS)!;
    expect(fast.pitches).toEqual(slow.pitches);
    expect(fast.durations).toEqual(slow.durations);
    expect(fast.seed).toBe(slow.seed);
    expect(fast.geometryType).toBe(slow.geometryType);
  });

  it('gesture defines expression: fast drawing yields higher overall velocities than slow', () => {
    const fast = extractTheme(walk(TRIANGLE, 0.01, 4), OPTS)!;
    const slow = extractTheme(walk(TRIANGLE, 0.01, 40), OPTS)!;
    const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(avg(fast.velocities)).toBeGreaterThan(avg(slow.velocities));
  });

  it('different geometry → different seed', () => {
    const tri = extractTheme(walk(TRIANGLE), OPTS)!;
    const line = extractTheme(
      walk([
        [0.1, 0.2],
        [0.9, 0.8],
      ]),
      OPTS,
    )!;
    expect(tri.seed).not.toBe(line.seed);
  });

  it('corners carry accent marks', () => {
    const theme = extractTheme(walk(TRIANGLE), OPTS)!;
    expect(theme.accents.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });

  it('ascending line → pitches never descend (a scale run)', () => {
    const theme = extractTheme(
      walk([
        [0.1, 0.1],
        [0.9, 0.9],
      ]),
      OPTS,
    )!;
    const notes = theme.pitches.filter((p) => p !== REST);
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]).toBeGreaterThanOrEqual(notes[i - 1]);
    }
    expect(theme.closed).toBe(false);
    expect(theme.geometryType).toBe('line-like');
  });

  it('a clear pause in the gesture → a rest', () => {
    const part1 = walk(
      [
        [0.1, 0.3],
        [0.5, 0.3],
      ],
      0.01,
      10,
    );
    const t1 = part1[part1.length - 1].t;
    const part2 = walk(
      [
        [0.5, 0.3],
        [0.5, 0.7],
        [0.9, 0.7],
      ],
      0.01,
      10,
      t1 + 1500, // a 1.5-second pause
    );
    const theme = extractTheme([...part1, ...part2], OPTS)!;
    expect(theme.pitches).toContain(REST);
  });

  it('a too-short trace returns null', () => {
    expect(
      extractTheme(
        [
          { x: 0.5, y: 0.5, t: 0 },
          { x: 0.52, y: 0.5, t: 50 },
        ],
        OPTS,
      ),
    ).toBeNull();
  });

  it('rhythm is quantized to the beat grid', () => {
    const theme = extractTheme(walk(TRIANGLE), OPTS)!;
    for (const d of theme.durations) {
      expect([0.25, 0.375, 0.5, 0.75, 1, 1.5, 2]).toContain(d);
    }
    expect(themeBeats(theme)).toBeGreaterThan(4);
  });

  it('circle → circle-like, no accents', () => {
    const circle: GestureSample[] = Array.from({ length: 129 }, (_, i) => {
      const a = (2 * Math.PI * i) / 128;
      return { x: 0.5 + 0.3 * Math.cos(a), y: 0.5 + 0.3 * Math.sin(a), t: i * 12 };
    });
    const theme = extractTheme(circle, OPTS)!;
    expect(theme.geometryType).toBe('circle-like');
    expect(theme.accents.every((a) => !a)).toBe(true);
  });
});
