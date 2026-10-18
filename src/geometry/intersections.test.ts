import { describe, expect, it } from 'vitest';
import { findIntersections, segmentIntersection } from './intersections';
import { getLibraryShape } from './shapeLibrary';

describe('线段交点检测', () => {
  it('十字交叉在中心相交', () => {
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

  it('平行线不会误判为相交', () => {
    const pt = segmentIntersection(
      { x: 0, y: 0.3 },
      { x: 1, y: 0.3 },
      { x: 0, y: 0.7 },
      { x: 1, y: 0.7 },
    );
    expect(pt).toBeNull();
  });

  it('不相交的短线段返回 null', () => {
    const pt = segmentIntersection(
      { x: 0, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0 },
      { x: 1, y: 0.2 },
    );
    expect(pt).toBeNull();
  });

  it('X 形图形有一个交点', () => {
    const shape = getLibraryShape('line-x')!;
    const result = findIntersections(shape);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBeCloseTo(0.5);
    expect(result[0].y).toBeCloseTo(0.5);
  });

  it('平行线图形没有交点', () => {
    const shape = getLibraryShape('line-parallel')!;
    expect(findIntersections(shape)).toHaveLength(0);
  });

  it('正方形相邻边共享顶点不算交点', () => {
    const shape = getLibraryShape('poly-square')!;
    expect(findIntersections(shape)).toHaveLength(0);
  });

  it('T 形接触（垂直线）算作交点', () => {
    const shape = getLibraryShape('line-perpendicular')!;
    const result = findIntersections(shape);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBeCloseTo(0.5);
    expect(result[0].y).toBeCloseTo(0.3);
  });
});
