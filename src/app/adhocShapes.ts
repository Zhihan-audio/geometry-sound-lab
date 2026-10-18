// Ad-hoc shapes built at runtime (used by Practice questions and the Slope Lab)
import type { GeometryShape, Vec2 } from '../geometry/geometryTypes';

export function makePointShape(id: string, name: string, x: number, y: number): GeometryShape {
  return {
    id,
    name,
    type: 'point',
    points: [{ id: `${id}-P`, x, y }],
    segments: [],
    closed: false,
    playbackDirection: 'forward',
  };
}

export function makeLineShape(id: string, name: string, a: Vec2, b: Vec2): GeometryShape {
  return {
    id,
    name,
    type: 'line',
    points: [
      { id: `${id}-A`, x: a.x, y: a.y },
      { id: `${id}-B`, x: b.x, y: b.y },
    ],
    segments: [{ id: `${id}-S`, startPointId: `${id}-A`, endPointId: `${id}-B`, order: 0 }],
    closed: false,
    playbackDirection: 'forward',
  };
}

/** A shape made of two separate lines: they play one after another with a pause between */
export function makeTwoLineShape(
  id: string,
  name: string,
  line1: [Vec2, Vec2],
  line2: [Vec2, Vec2],
): GeometryShape {
  return {
    id,
    name,
    type: 'multiline',
    points: [
      { id: `${id}-A1`, x: line1[0].x, y: line1[0].y },
      { id: `${id}-A2`, x: line1[1].x, y: line1[1].y },
      { id: `${id}-B1`, x: line2[0].x, y: line2[0].y },
      { id: `${id}-B2`, x: line2[1].x, y: line2[1].y },
    ],
    segments: [
      { id: `${id}-S1`, startPointId: `${id}-A1`, endPointId: `${id}-A2`, order: 0 },
      { id: `${id}-S2`, startPointId: `${id}-B1`, endPointId: `${id}-B2`, order: 1 },
    ],
    closed: false,
    playbackDirection: 'forward',
  };
}
