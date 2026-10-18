import { describe, expect, it } from 'vitest';
import type { GestureSample } from './models';
import {
  cleanTrace,
  countCorners,
  detectImportantPoints,
  isClosedTrace,
  LiveGestureAnalyzer,
  resampleByArcLength,
  totalArcLength,
  turnAngleAt,
} from './GestureAnalyzer';

// ---------- synthetic trace builders ----------

/** Walk along waypoints with a given step length; timestamps advance dtMs per step */
function walk(waypoints: [number, number][], step = 0.01, dtMs = 10): GestureSample[] {
  const out: GestureSample[] = [];
  let t = 0;
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

const SQUARE: [number, number][] = [
  [0.2, 0.2],
  [0.7, 0.2],
  [0.7, 0.7],
  [0.2, 0.7],
  [0.2, 0.2],
];

const TRIANGLE: [number, number][] = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.5, 0.75],
  [0.2, 0.2],
];

function circleTrace(n = 128, r = 0.3): GestureSample[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a), t: i * 10 };
  });
}

// ---------- offline processing ----------

describe('trace cleaning', () => {
  it('removes duplicate points, keeps first and last', () => {
    const raw: GestureSample[] = [
      { x: 0.1, y: 0.1, t: 0 },
      { x: 0.1, y: 0.1, t: 5 },
      { x: 0.1001, y: 0.1, t: 10 },
      { x: 0.3, y: 0.3, t: 160 },
      { x: 0.5, y: 0.5, t: 320 },
    ];
    const cleaned = cleanTrace(raw);
    expect(cleaned.length).toBe(3);
    expect(cleaned[0]).toMatchObject({ x: 0.1, y: 0.1 });
    expect(cleaned[cleaned.length - 1]).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it('drops teleport spikes (tracking jitter)', () => {
    const raw: GestureSample[] = [
      { x: 0.1, y: 0.5, t: 0 },
      { x: 0.12, y: 0.5, t: 10 },
      { x: 0.9, y: 0.9, t: 15 }, // jumps 0.87 grid units in 5ms → spike
      { x: 0.14, y: 0.5, t: 20 },
    ];
    const cleaned = cleanTrace(raw);
    expect(cleaned.every((s) => s.x < 0.5)).toBe(true);
  });
});

describe('arc-length resampling', () => {
  it('outputs the right point count with even spacing', () => {
    const line = walk(
      [
        [0.1, 0.5],
        [0.9, 0.5],
      ],
      0.013,
    );
    const rs = resampleByArcLength(line, 16);
    expect(rs).toHaveLength(16);
    const gaps: number[] = [];
    for (let i = 1; i < rs.length; i++) {
      gaps.push(Math.hypot(rs[i].x - rs[i - 1].x, rs[i].y - rs[i - 1].y));
    }
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    for (const g of gaps) expect(Math.abs(g - avg)).toBeLessThan(0.005);
  });

  it('same shape drawn fast or slow → identical spatial outline (different timing)', () => {
    const fast = walk(SQUARE, 0.01, 4);
    const slow = walk(SQUARE, 0.01, 40);
    const rf = resampleByArcLength(fast, 32);
    const rlow = resampleByArcLength(slow, 32);
    for (let i = 0; i < 32; i++) {
      expect(rf[i].x).toBeCloseTo(rlow[i].x, 3);
      expect(rf[i].y).toBeCloseTo(rlow[i].y, 3);
    }
    expect(rlow[31].t).toBeGreaterThan(rf[31].t); // gesture timing is preserved
  });
});

describe('closure detection (freehand traces)', () => {
  it('a square trace returning to its start is closed', () => {
    expect(isClosedTrace(walk(SQUARE))).toBe(true);
  });

  it('a straight line is not closed', () => {
    expect(
      isClosedTrace(
        walk([
          [0.1, 0.1],
          [0.9, 0.9],
        ]),
      ),
    ).toBe(false);
  });

  it('a too-small loop does not count as closed (minimum perimeter)', () => {
    const tiny = walk(
      [
        [0.5, 0.5],
        [0.55, 0.5],
        [0.55, 0.55],
        [0.5, 0.55],
        [0.5, 0.5],
      ],
      0.005,
    );
    expect(isClosedTrace(tiny)).toBe(false);
  });
});

describe('important point detection', () => {
  it('turn angle at a right angle is about 90 degrees', () => {
    const l = resampleByArcLength(
      walk([
        [0.2, 0.2],
        [0.6, 0.2],
        [0.6, 0.6],
      ]),
      33,
    );
    const turns = l.map((_, i) => turnAngleAt(l, i));
    expect(Math.max(...turns)).toBeGreaterThan(1.2); // ≈ π/2
  });

  it('a square trace yields 3 interior corners (the start corner counts as start/end)', () => {
    const rs = resampleByArcLength(walk(SQUARE), 64);
    const pts = detectImportantPoints(rs);
    expect(countCorners(pts)).toBe(3);
    expect(pts[0].kinds).toContain('start');
    expect(pts[pts.length - 1].kinds).toContain('end');
  });

  it('a triangle trace yields 2 interior corners', () => {
    const rs = resampleByArcLength(walk(TRIANGLE), 64);
    expect(countCorners(detectImportantPoints(rs))).toBe(2);
  });

  it('a circle has no corners but has Y extrema', () => {
    const rs = resampleByArcLength(circleTrace(), 64);
    const pts = detectImportantPoints(rs);
    expect(countCorners(pts)).toBe(0);
    const kinds = pts.flatMap((p) => p.kinds);
    expect(kinds).toContain('ymax');
    expect(kinds).toContain('ymin');
  });
});

// ---------- live analyzer ----------

describe('live gesture analysis', () => {
  it('straight line: positive speed, near-zero curvature, no corners, no closure', () => {
    const a = new LiveGestureAnalyzer();
    let corners = 0;
    let closed = 0;
    let last = null as ReturnType<LiveGestureAnalyzer['push']> | null;
    for (const s of walk(
      [
        [0.1, 0.5],
        [0.9, 0.5],
      ],
      0.01,
      10,
    )) {
      last = a.push(s);
      if (last.corner) corners++;
      if (last.closed) closed++;
    }
    expect(last!.speed).toBeGreaterThan(0.3);
    expect(last!.curvature).toBeLessThan(0.15);
    expect(corners).toBe(0);
    expect(closed).toBe(0);
  });

  it('L-shaped trace: fires exactly one corner event', () => {
    const a = new LiveGestureAnalyzer();
    let corners = 0;
    for (const s of walk(
      [
        [0.2, 0.2],
        [0.6, 0.2],
        [0.6, 0.6],
      ],
      0.008,
      10,
    )) {
      if (a.push(s).corner) corners++;
    }
    expect(corners).toBe(1);
  });

  it('square loop: fires 3 corners and exactly one closure', () => {
    const a = new LiveGestureAnalyzer();
    let corners = 0;
    let closed = 0;
    for (const s of walk(SQUARE, 0.008, 10)) {
      const f = a.push(s);
      if (f.corner) corners++;
      if (f.closed) closed++;
    }
    expect(corners).toBe(3);
    expect(closed).toBe(1);
  });

  it('arc: curvature clearly higher than a straight line', () => {
    const line = new LiveGestureAnalyzer();
    let lineMax = 0;
    for (const s of walk(
      [
        [0.1, 0.5],
        [0.9, 0.5],
      ],
      0.008,
    )) {
      lineMax = Math.max(lineMax, line.push(s).curvature);
    }
    const circle = new LiveGestureAnalyzer();
    let circleMax = 0;
    for (const s of circleTrace(96, 0.12)) {
      circleMax = Math.max(circleMax, circle.push(s).curvature);
    }
    expect(circleMax).toBeGreaterThan(lineMax + 0.1);
  });

  it('closure can fire again after reset', () => {
    const a = new LiveGestureAnalyzer();
    for (const s of walk(SQUARE, 0.008)) a.push(s);
    a.reset();
    let closed = 0;
    for (const s of walk(SQUARE, 0.008)) {
      if (a.push(s).closed) closed++;
    }
    expect(closed).toBe(1);
  });
});

describe('arc-length utilities', () => {
  it('total arc length is correct', () => {
    expect(
      totalArcLength([
        { x: 0, y: 0, t: 0 },
        { x: 0.3, y: 0.4, t: 10 },
      ]),
    ).toBeCloseTo(0.5);
  });
});
