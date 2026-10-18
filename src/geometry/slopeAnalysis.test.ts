import { describe, expect, it } from 'vitest';
import { classifySlope, compareLines, segmentLength, slopeOf } from './slopeAnalysis';

describe('斜率计算', () => {
  it('水平线斜率为 0', () => {
    expect(slopeOf({ x: 0, y: 0.5 }, { x: 1, y: 0.5 })).toBe(0);
    expect(classifySlope({ x: 0, y: 0.5 }, { x: 1, y: 0.5 })).toBe('horizontal');
  });

  it('竖直线斜率不存在（null）', () => {
    expect(slopeOf({ x: 0.5, y: 0 }, { x: 0.5, y: 1 })).toBeNull();
    expect(classifySlope({ x: 0.5, y: 0 }, { x: 0.5, y: 1 })).toBe('vertical');
  });

  it('正斜率判断正确', () => {
    expect(slopeOf({ x: 0, y: 0 }, { x: 1, y: 0.5 })).toBeCloseTo(0.5);
    expect(classifySlope({ x: 0, y: 0 }, { x: 1, y: 0.5 })).toBe('gentle-up');
    expect(classifySlope({ x: 0, y: 0 }, { x: 0.3, y: 0.9 })).toBe('steep-up');
  });

  it('负斜率判断正确', () => {
    expect(classifySlope({ x: 0, y: 1 }, { x: 1, y: 0.5 })).toBe('gentle-down');
    expect(classifySlope({ x: 0, y: 1 }, { x: 0.2, y: 0 })).toBe('steep-down');
  });

  it('线段长度正确（3-4-5 三角形）', () => {
    expect(segmentLength({ x: 0, y: 0 }, { x: 0.3, y: 0.4 })).toBeCloseTo(0.5);
  });
});

describe('两线比较', () => {
  it('陡线比缓线更陡', () => {
    const r = compareLines(
      { x: 0.1, y: 0.4 },
      { x: 0.9, y: 0.6 }, // 缓
      { x: 0.35, y: 0.1 },
      { x: 0.65, y: 0.9 }, // 陡
    );
    expect(r.steeper).toBe('b');
  });

  it('竖直线最陡', () => {
    const r = compareLines(
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 },
      { x: 0, y: 0 },
      { x: 0.1, y: 1 },
    );
    expect(r.steeper).toBe('a');
  });

  it('平行判断：两条水平线平行', () => {
    const r = compareLines(
      { x: 0, y: 0.3 },
      { x: 1, y: 0.3 },
      { x: 0, y: 0.7 },
      { x: 1, y: 0.7 },
    );
    expect(r.parallel).toBe(true);
    expect(r.perpendicular).toBe(false);
  });

  it('垂直判断：斜率乘积为 -1', () => {
    const r = compareLines(
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    );
    expect(r.perpendicular).toBe(true);
  });

  it('垂直判断：水平线与竖直线垂直', () => {
    const r = compareLines(
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 },
    );
    expect(r.perpendicular).toBe(true);
    expect(r.parallel).toBe(false);
  });
});
