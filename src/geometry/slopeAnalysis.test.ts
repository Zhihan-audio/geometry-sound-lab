import { describe, expect, it } from 'vitest';
import { classifySlope, compareLines, segmentLength, slopeOf } from './slopeAnalysis';

describe('slope computation', () => {
  it('a horizontal line has slope 0', () => {
    expect(slopeOf({ x: 0, y: 0.5 }, { x: 1, y: 0.5 })).toBe(0);
    expect(classifySlope({ x: 0, y: 0.5 }, { x: 1, y: 0.5 })).toBe('horizontal');
  });

  it('a vertical line has no slope (null)', () => {
    expect(slopeOf({ x: 0.5, y: 0 }, { x: 0.5, y: 1 })).toBeNull();
    expect(classifySlope({ x: 0.5, y: 0 }, { x: 0.5, y: 1 })).toBe('vertical');
  });

  it('positive slopes are classified correctly', () => {
    expect(slopeOf({ x: 0, y: 0 }, { x: 1, y: 0.5 })).toBeCloseTo(0.5);
    expect(classifySlope({ x: 0, y: 0 }, { x: 1, y: 0.5 })).toBe('gentle-up');
    expect(classifySlope({ x: 0, y: 0 }, { x: 0.3, y: 0.9 })).toBe('steep-up');
  });

  it('negative slopes are classified correctly', () => {
    expect(classifySlope({ x: 0, y: 1 }, { x: 1, y: 0.5 })).toBe('gentle-down');
    expect(classifySlope({ x: 0, y: 1 }, { x: 0.2, y: 0 })).toBe('steep-down');
  });

  it('segment length is correct (3-4-5 triangle)', () => {
    expect(segmentLength({ x: 0, y: 0 }, { x: 0.3, y: 0.4 })).toBeCloseTo(0.5);
  });
});

describe('two-line comparison', () => {
  it('a steep line is steeper than a gentle one', () => {
    const r = compareLines(
      { x: 0.1, y: 0.4 },
      { x: 0.9, y: 0.6 }, // gentle
      { x: 0.35, y: 0.1 },
      { x: 0.65, y: 0.9 }, // steep
    );
    expect(r.steeper).toBe('b');
  });

  it('a vertical line is the steepest', () => {
    const r = compareLines(
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 },
      { x: 0, y: 0 },
      { x: 0.1, y: 1 },
    );
    expect(r.steeper).toBe('a');
  });

  it('parallel check: two horizontal lines are parallel', () => {
    const r = compareLines(
      { x: 0, y: 0.3 },
      { x: 1, y: 0.3 },
      { x: 0, y: 0.7 },
      { x: 1, y: 0.7 },
    );
    expect(r.parallel).toBe(true);
    expect(r.perpendicular).toBe(false);
  });

  it('perpendicular check: slope product is -1', () => {
    const r = compareLines(
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    );
    expect(r.perpendicular).toBe(true);
  });

  it('perpendicular check: a horizontal and a vertical line are perpendicular', () => {
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
