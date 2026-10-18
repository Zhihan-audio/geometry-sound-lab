import { describe, expect, it } from 'vitest';
import { LiveMusicalMapper } from './MusicalMapper';
import type { LiveFeatures } from './models';

const feat = (over: Partial<LiveFeatures>): LiveFeatures => ({
  x: 0.5,
  y: 0.5,
  speed: 0.5,
  angle: 0,
  curvature: 0,
  corner: false,
  closed: false,
  ...over,
});

function settle(mapper: LiveMusicalMapper, f: LiveFeatures, n = 60) {
  let out = mapper.map(f);
  for (let i = 0; i < n; i++) out = mapper.map(f);
  return out;
}

describe('live musical mapping', () => {
  it('Y position maps to an in-scale note (C Dorian, C3..C6)', () => {
    const m = new LiveMusicalMapper('dorian');
    expect(settle(m, feat({ y: 0 })).midi).toBe(48);
    expect(settle(new LiveMusicalMapper('dorian'), feat({ y: 1 })).midi).toBe(84);
    const mid = settle(new LiveMusicalMapper('dorian'), feat({ y: 0.5 })).midi;
    expect([0, 2, 3, 5, 7, 9, 10]).toContain(((mid - 48) % 12 + 12) % 12); // in scale
  });

  it('pan is limited to ±0.75, never fully hard-panned', () => {
    const m = new LiveMusicalMapper('dorian');
    expect(settle(m, feat({ x: 0 })).pan).toBeCloseTo(-0.75);
    expect(settle(new LiveMusicalMapper('dorian'), feat({ x: 1 })).pan).toBeCloseTo(0.75);
    expect(settle(new LiveMusicalMapper('dorian'), feat({ x: 0.5 })).pan).toBeCloseTo(0);
  });

  it('speed → dynamics: faster is louder, slower is softer, with a floor (slow stays audible)', () => {
    const slow = settle(new LiveMusicalMapper('dorian'), feat({ speed: 0.05 }));
    const fast = settle(new LiveMusicalMapper('dorian'), feat({ speed: 2.5 }));
    expect(fast.gain).toBeGreaterThan(slow.gain + 0.2);
    expect(slow.gain).toBeGreaterThan(0.25); // never silent
    expect(fast.gain).toBeLessThanOrEqual(1);
  });

  it('dynamics change smoothly (no single-step jumps)', () => {
    const m = new LiveMusicalMapper('dorian');
    settle(m, feat({ speed: 0.05 }));
    const before = m.map(feat({ speed: 0.05 })).gain;
    const after = m.map(feat({ speed: 3 })).gain; // one frame of sudden speed change
    expect(Math.abs(after - before)).toBeLessThan(0.15);
  });

  it('direction → subtle brightness shift: upward brighter, downward darker', () => {
    const up = settle(new LiveMusicalMapper('dorian'), feat({ angle: Math.PI / 2 }));
    const down = settle(new LiveMusicalMapper('dorian'), feat({ angle: -Math.PI / 2 }));
    expect(up.brightness).toBeGreaterThan(down.brightness);
    expect(up.brightness - down.brightness).toBeLessThan(0.35); // a subtle shade, not a timbre change
  });

  it('curvature → mod depth: straight lines clean, curves flowing', () => {
    const straight = settle(new LiveMusicalMapper('dorian'), feat({ curvature: 0 }));
    const curved = settle(new LiveMusicalMapper('dorian'), feat({ curvature: 0.9 }));
    expect(straight.modDepth).toBeLessThan(0.1);
    expect(curved.modDepth).toBeGreaterThan(0.6);
  });

  it('switching scale updates the note table and resets hysteresis', () => {
    const m = new LiveMusicalMapper('dorian');
    expect(m.noteTable).toHaveLength(22);
    m.setScale('majorPentatonic');
    expect(m.noteTable).toHaveLength(16);
    expect(settle(m, feat({ y: 0 })).midi).toBe(48);
  });
});
