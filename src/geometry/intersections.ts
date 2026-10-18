// 线段交点检测
import type { GeometryShape, Vec2 } from './geometryTypes';

const EPS = 1e-9;
const COINCIDE_EPS = 1e-6;

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/**
 * 两条线段的交点；平行、共线或不相交时返回 null。
 * 端点接触（T 形交点）也算相交。
 */
export function segmentIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const denom = cross(d1x, d1y, d2x, d2y);
  if (Math.abs(denom) < EPS) return null; // 平行或共线

  const wx = b1.x - a1.x;
  const wy = b1.y - a1.y;
  const t = cross(wx, wy, d2x, d2y) / denom;
  const u = cross(wx, wy, d1x, d1y) / denom;
  const TOL = 1e-9;
  if (t < -TOL || t > 1 + TOL || u < -TOL || u > 1 + TOL) return null;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

export interface IntersectionPoint {
  x: number;
  y: number;
  segmentIds: [string, string];
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < COINCIDE_EPS && Math.abs(a.y - b.y) < COINCIDE_EPS;
}

/**
 * 找出图形内所有线段交点。
 * 跳过共享顶点的相邻线段；若交点恰好是两条线段的公共端点坐标（顶点连接），不算交点。
 */
export function findIntersections(shape: GeometryShape): IntersectionPoint[] {
  const byId = new Map(shape.points.map((p) => [p.id, p]));
  const result: IntersectionPoint[] = [];

  for (let i = 0; i < shape.segments.length; i++) {
    for (let j = i + 1; j < shape.segments.length; j++) {
      const s1 = shape.segments[i];
      const s2 = shape.segments[j];
      if (
        s1.startPointId === s2.startPointId ||
        s1.startPointId === s2.endPointId ||
        s1.endPointId === s2.startPointId ||
        s1.endPointId === s2.endPointId
      ) {
        continue; // 相邻线段共享顶点
      }
      const a1 = byId.get(s1.startPointId);
      const a2 = byId.get(s1.endPointId);
      const b1 = byId.get(s2.startPointId);
      const b2 = byId.get(s2.endPointId);
      if (!a1 || !a2 || !b1 || !b2) continue;

      const pt = segmentIntersection(a1, a2, b1, b2);
      if (!pt) continue;

      // 交点是两条线段各自的端点（坐标重合的顶点连接）→ 不算交点
      const isEndpointOf1 = samePoint(pt, a1) || samePoint(pt, a2);
      const isEndpointOf2 = samePoint(pt, b1) || samePoint(pt, b2);
      if (isEndpointOf1 && isEndpointOf2) continue;

      if (!result.some((r) => samePoint(r, pt))) {
        result.push({ x: pt.x, y: pt.y, segmentIds: [s1.id, s2.id] });
      }
    }
  }
  return result;
}
