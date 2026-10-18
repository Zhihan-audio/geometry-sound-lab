// Gesture analysis for the instrument mode.
// Live part: per-sample features (speed, heading, curvature, corner, closure)
// Offline part: trace cleaning, arc-length resampling, important-point detection.
// Everything here is pure math — no audio, no DOM — and fully unit-testable.
import type { GestureSample, LiveFeatures } from './models';

// ---------- shared helpers ----------

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Smallest absolute difference between two angles (radians) */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function totalArcLength(samples: readonly GestureSample[]): number {
  let len = 0;
  for (let i = 1; i < samples.length; i++) len += dist(samples[i - 1], samples[i]);
  return len;
}

// ---------- live analyzer ----------

const HISTORY_ARC = 0.09; // how much recent path the live analyzer looks back on
const HEADING_SEG = 0.03; // arc length of each heading probe segment
const CORNER_ANGLE = 0.9; // rad (~52°) between adjacent probe segments
const CORNER_REFRACTORY_ARC = 0.06;
const CLOSE_RADIUS = 0.05;
const CLOSE_MIN_ARC = 0.5;
const SPEED_EMA = 0.3;
const CURVATURE_NORM = 18; // rad per unit arc that maps to curvature = 1

interface ArcPoint {
  x: number;
  y: number;
  t: number;
  cum: number; // cumulative arc length
}

/**
 * Stateful realtime analyzer: push each incoming sample, get back the current
 * musical-control features plus corner / closure events (rising edges).
 */
export class LiveGestureAnalyzer {
  private points: ArcPoint[] = [];
  private start: GestureSample | null = null;
  private speedEma = 0;
  private lastHeading: number | null = null;
  private lastCornerArc = -Infinity;
  private closedFired = false;

  get arcLength(): number {
    return this.points.length > 0 ? this.points[this.points.length - 1].cum : 0;
  }

  /** Position at `back` arc-length units behind the current end (interpolated) */
  private positionAt(back: number): ArcPoint | null {
    const pts = this.points;
    if (pts.length < 2) return null;
    const target = pts[pts.length - 1].cum - back;
    if (target <= pts[0].cum) return null;
    for (let i = pts.length - 1; i > 0; i--) {
      if (pts[i - 1].cum <= target) {
        const a = pts[i - 1];
        const b = pts[i];
        const span = b.cum - a.cum;
        const f = span > 1e-9 ? (target - a.cum) / span : 0;
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          t: a.t + (b.t - a.t) * f,
          cum: target,
        };
      }
    }
    return null;
  }

  push(sample: GestureSample): LiveFeatures {
    const prev = this.points[this.points.length - 1];
    const stepLen = prev ? Math.hypot(sample.x - prev.x, sample.y - prev.y) : 0;
    const cum = prev ? prev.cum + stepLen : 0;
    this.points.push({ x: sample.x, y: sample.y, t: sample.t, cum });
    if (!this.start) this.start = sample;

    // Trim history beyond the lookback window (keep a couple extra points)
    while (
      this.points.length > 3 &&
      this.points[this.points.length - 1].cum - this.points[1].cum > HISTORY_ARC
    ) {
      this.points.shift();
    }

    // Speed: instantaneous distance/time, EMA-smoothed
    if (prev) {
      const dt = Math.max(1, sample.t - prev.t) / 1000;
      const inst = stepLen / dt;
      this.speedEma = this.speedEma + SPEED_EMA * (inst - this.speedEma);
    }

    // Heading probes at two adjacent arc segments behind the pen
    const pMid = this.positionAt(HEADING_SEG);
    const pFar = this.positionAt(HEADING_SEG * 2);
    let heading: number | null = this.lastHeading;
    let curvature = 0;
    let corner = false;

    if (pMid) {
      heading = Math.atan2(sample.y - pMid.y, sample.x - pMid.x);
      this.lastHeading = heading;
    }
    if (pMid && pFar && heading !== null) {
      const prevHeading = Math.atan2(pMid.y - pFar.y, pMid.x - pFar.x);
      const turn = Math.abs(angleDiff(heading, prevHeading));
      curvature = Math.min(1, turn / HEADING_SEG / CURVATURE_NORM);
      if (turn > CORNER_ANGLE && cum - this.lastCornerArc > CORNER_REFRACTORY_ARC) {
        corner = true;
        this.lastCornerArc = cum;
      }
    }

    // Closure: pen returned to the start after enough travelled distance
    let closed = false;
    if (
      !this.closedFired &&
      this.start &&
      cum > CLOSE_MIN_ARC &&
      Math.hypot(sample.x - this.start.x, sample.y - this.start.y) < CLOSE_RADIUS
    ) {
      closed = true;
      this.closedFired = true;
    }

    return {
      x: sample.x,
      y: sample.y,
      speed: this.speedEma,
      angle: heading,
      curvature,
      corner,
      closed,
    };
  }

  reset(): void {
    this.points = [];
    this.start = null;
    this.speedEma = 0;
    this.lastHeading = null;
    this.lastCornerArc = -Infinity;
    this.closedFired = false;
  }
}

// ---------- offline trace processing ----------

const DUP_EPS = 0.002;
const SPIKE_SPEED = 8; // grid units / second
const SPIKE_DIST = 0.08;

/**
 * Clean a raw trace: drop duplicates and teleport spikes, then apply one pass
 * of gentle 3-point smoothing that preserves both endpoints.
 */
export function cleanTrace(samples: readonly GestureSample[]): GestureSample[] {
  const deduped: GestureSample[] = [];
  for (const s of samples) {
    const prev = deduped[deduped.length - 1];
    if (prev && dist(prev, s) < DUP_EPS) continue;
    if (prev) {
      const dt = Math.max(1, s.t - prev.t) / 1000;
      const d = dist(prev, s);
      if (d > SPIKE_DIST && d / dt > SPIKE_SPEED) continue; // tracking glitch
    }
    deduped.push({ ...s });
  }
  if (deduped.length < 3) return deduped;
  const out: GestureSample[] = [deduped[0]];
  for (let i = 1; i < deduped.length - 1; i++) {
    out.push({
      x: (deduped[i - 1].x + deduped[i].x + deduped[i + 1].x) / 3,
      y: (deduped[i - 1].y + deduped[i].y + deduped[i + 1].y) / 3,
      t: deduped[i].t,
    });
  }
  out.push(deduped[deduped.length - 1]);
  return out;
}

/**
 * Resample the trace to `n` points spaced uniformly along the path's true
 * length (arc-length parameterization) — the same shape drawn quickly or
 * slowly yields the same spatial contour; timestamps are interpolated so
 * gesture timing survives for rhythm extraction.
 */
export function resampleByArcLength(samples: readonly GestureSample[], n: number): GestureSample[] {
  if (samples.length === 0 || n <= 0) return [];
  if (samples.length === 1 || n === 1) return [{ ...samples[0] }];

  const cum: number[] = [0];
  for (let i = 1; i < samples.length; i++) {
    cum.push(cum[i - 1] + dist(samples[i - 1], samples[i]));
  }
  const total = cum[cum.length - 1];
  if (total < 1e-9) return Array.from({ length: n }, () => ({ ...samples[0] }));

  const out: GestureSample[] = [];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (seg < samples.length - 1 && cum[seg] < target) seg++;
    const a = samples[seg - 1];
    const b = samples[seg];
    const span = cum[seg] - cum[seg - 1];
    const f = span > 1e-9 ? (target - cum[seg - 1]) / span : 0;
    out.push({
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      t: a.t + (b.t - a.t) * f,
    });
  }
  return out;
}

export function isClosedTrace(
  samples: readonly GestureSample[],
  opts: { minArc?: number; closeRadius?: number } = {},
): boolean {
  if (samples.length < 3) return false;
  const minArc = opts.minArc ?? 0.4;
  const closeRadius = opts.closeRadius ?? 0.06;
  return (
    totalArcLength(samples) >= minArc &&
    dist(samples[0], samples[samples.length - 1]) <= closeRadius
  );
}

export type ImportantKind = 'start' | 'end' | 'corner' | 'ymax' | 'ymin';

export interface ImportantPoint {
  index: number;
  kinds: ImportantKind[];
  /** Turn angle at this point (rad), 0 for non-corners */
  turn: number;
}

/** Turn angle at index i of an (ideally resampled) trace using ±k neighbours */
export function turnAngleAt(samples: readonly GestureSample[], i: number, k = 2): number {
  if (i - k < 0 || i + k >= samples.length) return 0;
  const inV = Math.atan2(samples[i].y - samples[i - k].y, samples[i].x - samples[i - k].x);
  const outV = Math.atan2(samples[i + k].y - samples[i].y, samples[i + k].x - samples[i].x);
  return Math.abs(angleDiff(outV, inV));
}

const OFFLINE_CORNER_ANGLE = 0.75; // rad
const CORNER_SUPPRESS = 3; // indices of non-max suppression
const EXTREMUM_PROMINENCE = 0.045;

/**
 * Find musically important points on a resampled trace: endpoints, corners
 * (local maxima of turn angle), and local Y extrema (melodic peaks/valleys).
 */
export function detectImportantPoints(samples: readonly GestureSample[]): ImportantPoint[] {
  const n = samples.length;
  if (n === 0) return [];
  const byIndex = new Map<number, ImportantPoint>();
  const add = (index: number, kind: ImportantKind, turn = 0) => {
    const existing = byIndex.get(index);
    if (existing) {
      if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
      existing.turn = Math.max(existing.turn, turn);
    } else {
      byIndex.set(index, { index, kinds: [kind], turn });
    }
  };

  add(0, 'start');
  add(n - 1, 'end');

  // Corners: local maxima of turn angle above threshold, with suppression
  const turns = samples.map((_, i) => turnAngleAt(samples, i));
  let lastCorner = -Infinity;
  for (let i = 2; i < n - 2; i++) {
    if (turns[i] < OFFLINE_CORNER_ANGLE) continue;
    let isMax = true;
    for (let j = Math.max(0, i - CORNER_SUPPRESS); j <= Math.min(n - 1, i + CORNER_SUPPRESS); j++) {
      if (turns[j] > turns[i]) {
        isMax = false;
        break;
      }
    }
    if (isMax && i - lastCorner > CORNER_SUPPRESS) {
      add(i, 'corner', turns[i]);
      lastCorner = i;
    }
  }

  // Local Y extrema with prominence (melodic peaks and valleys)
  for (let i = 1; i < n - 1; i++) {
    const y = samples[i].y;
    if (y >= samples[i - 1].y && y >= samples[i + 1].y) {
      const drop = Math.min(
        y - Math.min(...samples.slice(Math.max(0, i - 6), i).map((s) => s.y), y),
        y - Math.min(...samples.slice(i + 1, Math.min(n, i + 7)).map((s) => s.y), y),
      );
      if (drop >= EXTREMUM_PROMINENCE) add(i, 'ymax');
    } else if (y <= samples[i - 1].y && y <= samples[i + 1].y) {
      const rise = Math.min(
        Math.max(...samples.slice(Math.max(0, i - 6), i).map((s) => s.y), y) - y,
        Math.max(...samples.slice(i + 1, Math.min(n, i + 7)).map((s) => s.y), y) - y,
      );
      if (rise >= EXTREMUM_PROMINENCE) add(i, 'ymin');
    }
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** Count offline-detected corners (excluding endpoints) */
export function countCorners(points: ImportantPoint[]): number {
  return points.filter((p) => p.kinds.includes('corner')).length;
}
