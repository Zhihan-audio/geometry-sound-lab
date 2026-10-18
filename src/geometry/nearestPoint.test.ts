import { describe, expect, it } from 'vitest';
import { nearestSegmentOnShape, pointToSegmentDistance, projectPointToSegment } from './nearestPoint';
import { getLibraryShape } from './shapeLibrary';

describe('点到线段距离', () => {
  it('垂足在线段中间', () => {
    const d = pointToSegmentDistance({ x: 0.5, y: 0.6 }, { x: 0, y: 0.5 }, { x: 1, y: 0.5 });
    expect(d).toBeCloseTo(0.1);
  });

  it('垂足超出端点时取端点距离', () => {
    const d = pointToSegmentDistance({ x: 1.3, y: 0.5 }, { x: 0, y: 0.5 }, { x: 1, y: 0.5 });
    expect(d).toBeCloseTo(0.3);
  });

  it('投影参数 t 正确', () => {
    const proj = projectPointToSegment({ x: 0.25, y: 0.9 }, { x: 0, y: 0.5 }, { x: 1, y: 0.5 });
    expect(proj.t).toBeCloseTo(0.25);
    expect(proj.point.x).toBeCloseTo(0.25);
    expect(proj.point.y).toBeCloseTo(0.5);
  });

  it('零长度线段距离为到端点的距离', () => {
    const d = pointToSegmentDistance({ x: 0.4, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 });
    expect(d).toBeCloseTo(0.1);
  });
});

describe('最近线段', () => {
  it('十字图形：靠近水平线时返回水平线段', () => {
    const shape = getLibraryShape('line-cross')!;
    const r = nearestSegmentOnShape(shape, { x: 0.3, y: 0.52 });
    expect(r).not.toBeNull();
    // 水平线段的两个端点 y 都是 0.5
    expect(r!.a.y).toBeCloseTo(0.5);
    expect(r!.b.y).toBeCloseTo(0.5);
    expect(r!.distance).toBeCloseTo(0.02);
  });

  it('十字图形：靠近竖直线时返回竖直线段', () => {
    const shape = getLibraryShape('line-cross')!;
    const r = nearestSegmentOnShape(shape, { x: 0.52, y: 0.8 });
    expect(r).not.toBeNull();
    expect(r!.a.x).toBeCloseTo(0.5);
    expect(r!.b.x).toBeCloseTo(0.5);
  });
});
