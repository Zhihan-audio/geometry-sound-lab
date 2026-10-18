import { describe, expect, it } from 'vitest';
import { findIntersections, segmentIntersection } from './intersections';
import { getLibraryShape } from './shapeLibrary';

describe('segment intersection detection', () => {
  it('cross segments intersect at the center', () => {
    const pt = segmentIntersection(
      { x: 0.1, y: 0.5 },
      { x: 0.9, y: 0.5 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.9 },
    );
    expect(pt).not.toBeNull();
    expect(pt!.x).toBeCloseTo(0.5);
    expect(pt!.y).toBeCloseTo(0.5);
  });

  it('parallel lines are not misreported as intersecting', () => {
    const pt = segmentIntersection(
      { x: 0, y: 0.3 },
      { x: 1, y: 0.3 },
      { x: 0, y: 0.7 },
      { x: 1, y: 0.7 },
    );
    expect(pt).toBeNull();
  });

  it('non-intersecting short segments return null', () => {
    const pt = segmentIntersection(
      { x: 0, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0 },
      { x: 1, y: 0.2 },
    );
    expect(pt).toBeNull();
  });

  it('the X shape has one intersection', () => {
    const shape = getLibraryShape('line-x')!;
    const result = findIntersections(shape);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBeCloseTo(0.5);
    expect(result[0].y).toBeCloseTo(0.5);
  });

  it('the parallel-lines shape has no intersections', () => {
    const shape = getLibraryShape('line-parallel')!;
    expect(findIntersections(shape)).toHaveLength(0);
  });

  it('square edges sharing a vertex do not count as an intersection', () => {
    const shape = getLibraryShape('poly-square')!;
    expect(findIntersections(shape)).toHaveLength(0);
  });

  it('T-shaped contact (perpendicular lines) counts as an intersection', () => {
    const shape = getLibraryShape('line-perpendicular')!;
    const result = findIntersections(shape);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBeCloseTo(0.5);
    expect(result[0].y).toBeCloseTo(0.3);
  });
});
