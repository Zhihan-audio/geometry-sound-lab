import { describe, expect, it } from 'vitest';
import type { GeometryShape } from './geometryTypes';
import { buildTraversal, checkClosure, extractRawPaths, shapeStats } from './traversal';
import { getLibraryShape } from './shapeLibrary';

function line(id: string, x1: number, y1: number, x2: number, y2: number): GeometryShape {
  return {
    id,
    name: id,
    type: 'line',
    points: [
      { id: 'a', x: x1, y: y1 },
      { id: 'b', x: x2, y: y2 },
    ],
    segments: [{ id: 's', startPointId: 'a', endPointId: 'b', order: 0 }],
    closed: false,
    playbackDirection: 'forward',
  };
}

/** 逆时针作图的正方形：左下 → 右下 → 右上 → 左上 */
function square(): GeometryShape {
  return {
    id: 'sq',
    name: '正方形',
    type: 'polygon',
    points: [
      { id: 'bl', x: 0.2, y: 0.2 },
      { id: 'br', x: 0.8, y: 0.2 },
      { id: 'tr', x: 0.8, y: 0.8 },
      { id: 'tl', x: 0.2, y: 0.8 },
    ],
    segments: [
      { id: 's0', startPointId: 'bl', endPointId: 'br', order: 0 },
      { id: 's1', startPointId: 'br', endPointId: 'tr', order: 1 },
      { id: 's2', startPointId: 'tr', endPointId: 'tl', order: 2 },
      { id: 's3', startPointId: 'tl', endPointId: 'bl', order: 3 },
    ],
    closed: true,
    playbackDirection: 'clockwise',
  };
}

describe('开放线条起点选择', () => {
  it('从最左端点开始（作图方向相反也纠正）', () => {
    const shape = line('l1', 0.9, 0.5, 0.1, 0.5); // 从右往左作图
    const plan = buildTraversal(shape);
    expect(plan.legs[0].from.x).toBeCloseTo(0.1);
    expect(plan.legs[0].to.x).toBeCloseTo(0.9);
  });

  it('竖直线从较低端点开始', () => {
    const shape = line('l2', 0.5, 0.9, 0.5, 0.1); // 从上往下作图
    const plan = buildTraversal(shape);
    expect(plan.legs[0].from.y).toBeCloseTo(0.1);
    expect(plan.legs[0].to.y).toBeCloseTo(0.9);
  });

  it('教师指定起点优先', () => {
    const shape = line('l3', 0.1, 0.5, 0.9, 0.5);
    const plan = buildTraversal(shape, { startPointId: 'b' });
    expect(plan.legs[0].from.x).toBeCloseTo(0.9);
  });
});

describe('闭合图形起点与方向', () => {
  it('起点为最左顶点，横坐标相同取较高顶点', () => {
    const plan = buildTraversal(square(), { direction: 'clockwise' });
    // 最左的两个顶点是 bl(0.2,0.2) 和 tl(0.2,0.8)，取较高的 tl
    expect(plan.legs[0].from.id).toBe('tl');
  });

  it('顺时针播放顺序正确（左上 → 右上 → 右下 → 左下）', () => {
    const plan = buildTraversal(square(), { direction: 'clockwise' });
    const ids = plan.legs.map((l) => l.from.id);
    expect(ids).toEqual(['tl', 'tr', 'br', 'bl']);
    expect(plan.legs[3].to.id).toBe('tl'); // 回到起点
  });

  it('逆时针播放顺序正确（左上 → 左下 → 右下 → 右上）', () => {
    const plan = buildTraversal(square(), { direction: 'counterclockwise' });
    const ids = plan.legs.map((l) => l.from.id);
    expect(ids).toEqual(['tl', 'bl', 'br', 'tr']);
  });

  it('闭合路径腿数等于顶点数', () => {
    const plan = buildTraversal(square());
    expect(plan.legs).toHaveLength(4);
    expect(plan.paths[0].closed).toBe(true);
  });
});

describe('多路径图形', () => {
  it('十字图形拆分为两条路径', () => {
    const shape = getLibraryShape('line-cross')!;
    const plan = buildTraversal(shape);
    expect(plan.paths).toHaveLength(2);
    expect(plan.pathStartLegIndex).toEqual([0, 1]);
  });
});

describe('闭合验证与统计', () => {
  it('闭合图形验证正确', () => {
    expect(checkClosure(square())).toBe(true);
    expect(checkClosure(getLibraryShape('line-polyline')!)).toBe(false);
    expect(checkClosure(getLibraryShape('curve-circle')!)).toBe(true);
  });

  it('顶点数量和边数统计正确', () => {
    const stats = shapeStats(square());
    expect(stats.vertexCount).toBe(4);
    expect(stats.edgeCount).toBe(4);
    expect(stats.closed).toBe(true);
    expect(stats.totalLength).toBeCloseTo(2.4);
  });

  it('圆形采样点不计入顶点数量', () => {
    const stats = shapeStats(getLibraryShape('curve-circle')!);
    expect(stats.vertexCount).toBe(0);
    expect(stats.closed).toBe(true);
  });

  it('单点图形没有路径', () => {
    const shape = getLibraryShape('point-single')!;
    expect(extractRawPaths(shape)).toHaveLength(0);
    const plan = buildTraversal(shape);
    expect(plan.legs).toHaveLength(0);
  });
});
