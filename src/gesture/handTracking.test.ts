import { describe, expect, it } from 'vitest';
import {
  landmarkToGrid,
  PinchDetector,
  PointSmoother,
  PresenceDebouncer,
} from './handTracking';

describe('hand coordinate mapping', () => {
  it('mirrors horizontally: moving your hand to your right moves the sound right', () => {
    // x=0.2 in the camera frame (left side of the frame) = the user's right side
    expect(landmarkToGrid({ x: 0.2, y: 0.5 }).x).toBeCloseTo(0.8);
  });

  it('flips vertically: raising the hand increases y (higher pitch)', () => {
    expect(landmarkToGrid({ x: 0.5, y: 0.1 }).y).toBeCloseTo(0.9);
    expect(landmarkToGrid({ x: 0.5, y: 0.9 }).y).toBeCloseTo(0.1);
  });

  it('out-of-range coordinates are clamped to 0..1', () => {
    const p = landmarkToGrid({ x: -0.3, y: 1.4 });
    expect(p.x).toBe(1);
    expect(p.y).toBe(0);
  });
});

describe('smoothing filter', () => {
  it('the first frame uses the input value directly', () => {
    const s = new PointSmoother(0.3);
    expect(s.push({ x: 0.4, y: 0.6 })).toEqual({ x: 0.4, y: 0.6 });
  });

  it('later frames converge toward the target (suppressing jitter)', () => {
    const s = new PointSmoother(0.5);
    s.push({ x: 0, y: 0 });
    const p1 = s.push({ x: 1, y: 1 });
    expect(p1.x).toBeCloseTo(0.5);
    const p2 = s.push({ x: 1, y: 1 });
    expect(p2.x).toBeCloseTo(0.75);
  });

  it('after reset it starts over from the first frame', () => {
    const s = new PointSmoother(0.5);
    s.push({ x: 0, y: 0 });
    s.reset();
    expect(s.push({ x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
  });
});

describe('pinch detection (with hysteresis)', () => {
  const far = { x: 0.5, y: 0.5 };
  const near = { x: 0.52, y: 0.5 }; // distance 0.02 < 0.06 → pinched
  const mid = { x: 0.58, y: 0.5 }; // distance 0.08: between the two thresholds

  it('thumb and index coming together triggers one pinch (rising edge)', () => {
    const d = new PinchDetector();
    expect(d.update(far, { x: 0.9, y: 0.5 })).toBe(false);
    expect(d.update(far, near)).toBe(true); // fires
    expect(d.update(far, near)).toBe(false); // staying pinched does not fire again
    expect(d.isPinched).toBe(true);
  });

  it('hysteresis: a slight release does not reset; a clear release does', () => {
    const d = new PinchDetector();
    d.update(far, near); // pinch
    d.update(far, mid); // 0.08 < 0.1, still counts as pinched
    expect(d.isPinched).toBe(true);
    d.update(far, { x: 0.75, y: 0.5 }); // 0.25 > 0.1 → released
    expect(d.isPinched).toBe(false);
    expect(d.update(far, near)).toBe(true); // can fire again
  });
});

describe('hand presence/absence debouncing', () => {
  it('needs several consecutive frames to switch state', () => {
    const p = new PresenceDebouncer(3);
    expect(p.update(true)).toBe(false);
    expect(p.update(true)).toBe(false);
    expect(p.update(true)).toBe(true); // confirmed present on frame 3
    expect(p.update(false)).toBe(true); // a single lost frame does not switch
    expect(p.update(true)).toBe(true);
    expect(p.update(false)).toBe(true);
    expect(p.update(false)).toBe(true);
    expect(p.update(false)).toBe(false); // confirmed gone only after 3 consecutive lost frames
  });
});
