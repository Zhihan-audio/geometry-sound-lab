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

/** Square drawn counterclockwise: bottom-left → bottom-right → top-right → top-left */
function square(): GeometryShape {
  return {
    id: 'sq',
    name: 'Square',
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

describe('open-line start-point selection', () => {
  it('starts at the leftmost endpoint (corrects a reversed drawing direction)', () => {
    const shape = line('l1', 0.9, 0.5, 0.1, 0.5); // drawn right-to-left
    const plan = buildTraversal(shape);
    expect(plan.legs[0].from.x).toBeCloseTo(0.1);
    expect(plan.legs[0].to.x).toBeCloseTo(0.9);
  });

  it('a vertical line starts at the lower endpoint', () => {
    const shape = line('l2', 0.5, 0.9, 0.5, 0.1); // drawn top-to-bottom
    const plan = buildTraversal(shape);
    expect(plan.legs[0].from.y).toBeCloseTo(0.1);
    expect(plan.legs[0].to.y).toBeCloseTo(0.9);
  });

  it('a teacher-specified start point wins', () => {
    const shape = line('l3', 0.1, 0.5, 0.9, 0.5);
    const plan = buildTraversal(shape, { startPointId: 'b' });
    expect(plan.legs[0].from.x).toBeCloseTo(0.9);
  });
});

describe('closed-shape start point and direction', () => {
  it('starts at the leftmost vertex; same x takes the higher one', () => {
    const plan = buildTraversal(square(), { direction: 'clockwise' });
    // the leftmost vertices are bl(0.2,0.2) and tl(0.2,0.8); the higher tl wins
    expect(plan.legs[0].from.id).toBe('tl');
  });

  it('clockwise playback order is correct (top-left → top-right → bottom-right → bottom-left)', () => {
    const plan = buildTraversal(square(), { direction: 'clockwise' });
    const ids = plan.legs.map((l) => l.from.id);
    expect(ids).toEqual(['tl', 'tr', 'br', 'bl']);
    expect(plan.legs[3].to.id).toBe('tl'); // back to the start
  });

  it('counterclockwise playback order is correct (top-left → bottom-left → bottom-right → top-right)', () => {
    const plan = buildTraversal(square(), { direction: 'counterclockwise' });
    const ids = plan.legs.map((l) => l.from.id);
    expect(ids).toEqual(['tl', 'bl', 'br', 'tr']);
  });

  it('a closed path has as many legs as vertices', () => {
    const plan = buildTraversal(square());
    expect(plan.legs).toHaveLength(4);
    expect(plan.paths[0].closed).toBe(true);
  });
});

describe('multi-path shapes', () => {
  it('the cross shape splits into two paths', () => {
    const shape = getLibraryShape('line-cross')!;
    const plan = buildTraversal(shape);
    expect(plan.paths).toHaveLength(2);
    expect(plan.pathStartLegIndex).toEqual([0, 1]);
  });
});

describe('closure check and stats', () => {
  it('closure is detected correctly', () => {
    expect(checkClosure(square())).toBe(true);
    expect(checkClosure(getLibraryShape('line-polyline')!)).toBe(false);
    expect(checkClosure(getLibraryShape('curve-circle')!)).toBe(true);
  });

  it('vertex and edge counts are correct', () => {
    const stats = shapeStats(square());
    expect(stats.vertexCount).toBe(4);
    expect(stats.edgeCount).toBe(4);
    expect(stats.closed).toBe(true);
    expect(stats.totalLength).toBeCloseTo(2.4);
  });

  it('circle sample points are not counted as vertices', () => {
    const stats = shapeStats(getLibraryShape('curve-circle')!);
    expect(stats.vertexCount).toBe(0);
    expect(stats.closed).toBe(true);
  });

  it('a single-point shape has no paths', () => {
    const shape = getLibraryShape('point-single')!;
    expect(extractRawPaths(shape)).toHaveLength(0);
    const plan = buildTraversal(shape);
    expect(plan.legs).toHaveLength(0);
  });
});
