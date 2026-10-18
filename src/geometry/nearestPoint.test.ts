import { describe, expect, it } from 'vitest';
import { nearestSegmentOnShape, pointToSegmentDistance, projectPointToSegment } from './nearestPoint';
import { getLibraryShape } from './shapeLibrary';

describe('point-to-segment distance', () => {
  it('perpendicular foot lies within the segment', () => {
    const d = pointToSegmentDistance({ x: 0.5, y: 0.6 }, { x: 0, y: 0.5 }, { x: 1, y: 0.5 });
    expect(d).toBeCloseTo(0.1);
  });

  it('uses the endpoint distance when the foot falls past an endpoint', () => {
    const d = pointToSegmentDistance({ x: 1.3, y: 0.5 }, { x: 0, y: 0.5 }, { x: 1, y: 0.5 });
    expect(d).toBeCloseTo(0.3);
  });

  it('projection parameter t is correct', () => {
    const proj = projectPointToSegment({ x: 0.25, y: 0.9 }, { x: 0, y: 0.5 }, { x: 1, y: 0.5 });
    expect(proj.t).toBeCloseTo(0.25);
    expect(proj.point.x).toBeCloseTo(0.25);
    expect(proj.point.y).toBeCloseTo(0.5);
  });

  it('zero-length segment distance equals the distance to its endpoint', () => {
    const d = pointToSegmentDistance({ x: 0.4, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 });
    expect(d).toBeCloseTo(0.1);
  });
});

describe('nearest segment', () => {
  it('cross shape: returns the horizontal segment when near the horizontal line', () => {
    const shape = getLibraryShape('line-cross')!;
    const r = nearestSegmentOnShape(shape, { x: 0.3, y: 0.52 });
    expect(r).not.toBeNull();
    // both endpoints of the horizontal segment have y = 0.5
    expect(r!.a.y).toBeCloseTo(0.5);
    expect(r!.b.y).toBeCloseTo(0.5);
    expect(r!.distance).toBeCloseTo(0.02);
  });

  it('cross shape: returns the vertical segment when near the vertical line', () => {
    const shape = getLibraryShape('line-cross')!;
    const r = nearestSegmentOnShape(shape, { x: 0.52, y: 0.8 });
    expect(r).not.toBeNull();
    expect(r!.a.x).toBeCloseTo(0.5);
    expect(r!.b.x).toBeCloseTo(0.5);
  });
});
