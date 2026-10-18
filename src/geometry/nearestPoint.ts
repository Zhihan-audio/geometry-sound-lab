// 点到线段的投影、距离与最近线段计算
import type { GeometryPoint, GeometryShape, Vec2 } from './geometryTypes';

export interface SegmentProjection {
  point: Vec2;
  distance: number;
  t: number; // 0..1，投影点在线段上的参数位置
}

export function projectPointToSegment(p: Vec2, a: Vec2, b: Vec2): SegmentProjection {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 < 1e-18 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * abx, y: a.y + t * aby };
  const distance = Math.hypot(p.x - point.x, p.y - point.y);
  return { point, distance, t };
}

export function pointToSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  return projectPointToSegment(p, a, b).distance;
}

export interface NearestSegmentResult {
  segmentId: string;
  segmentIndex: number;
  a: GeometryPoint;
  b: GeometryPoint;
  point: Vec2;
  distance: number;
  t: number;
}

export function nearestSegmentOnShape(shape: GeometryShape, p: Vec2): NearestSegmentResult | null {
  const byId = new Map(shape.points.map((pt) => [pt.id, pt]));
  let best: NearestSegmentResult | null = null;
  shape.segments.forEach((seg, index) => {
    const a = byId.get(seg.startPointId);
    const b = byId.get(seg.endPointId);
    if (!a || !b) return;
    const proj = projectPointToSegment(p, a, b);
    if (!best || proj.distance < best.distance) {
      best = {
        segmentId: seg.id,
        segmentIndex: index,
        a,
        b,
        point: proj.point,
        distance: proj.distance,
        t: proj.t,
      };
    }
  });
  return best;
}
