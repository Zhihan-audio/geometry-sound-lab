// 图形遍历：路径提取、起点选择、顺/逆时针排序，生成播放用的“腿”序列
import type {
  GeometryPoint,
  GeometryShape,
  PlaybackDirection,
} from './geometryTypes';
import { segmentLength } from './slopeAnalysis';

export interface TraversalLeg {
  from: GeometryPoint;
  to: GeometryPoint;
  segmentId: string;
  pathIndex: number;
}

export interface TraversalPath {
  pointIds: string[]; // 有序顶点；闭合路径不重复起点
  closed: boolean;
}

export interface TraversalPlan {
  paths: TraversalPath[];
  legs: TraversalLeg[];
  /** 每条路径第一条腿在 legs 中的下标 */
  pathStartLegIndex: number[];
}

export interface TraversalOptions {
  direction?: PlaybackDirection;
  startPointId?: string;
}

const XY_EPS = 1e-9;

/** 按 order 把线段串成一条或多条连续路径 */
export function extractRawPaths(shape: GeometryShape): TraversalPath[] {
  const segs = [...shape.segments].sort((a, b) => a.order - b.order);
  const paths: TraversalPath[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length >= 2) {
      const closed = current[0] === current[current.length - 1];
      paths.push({ pointIds: closed ? current.slice(0, -1) : [...current], closed });
    }
    current = [];
  };

  for (const seg of segs) {
    if (current.length === 0) {
      current.push(seg.startPointId, seg.endPointId);
    } else if (seg.startPointId === current[current.length - 1]) {
      current.push(seg.endPointId);
    } else {
      flush();
      current.push(seg.startPointId, seg.endPointId);
    }
  }
  flush();
  return paths;
}

function pointById(shape: GeometryShape, id: string): GeometryPoint {
  const p = shape.points.find((pt) => pt.id === id);
  if (!p) throw new Error(`Shape data is missing point: ${id}`);
  return p;
}

export function signedArea(points: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** 开放路径：优先最左端点；横坐标相同取较低端点；教师指定起点优先 */
function orientOpenPath(shape: GeometryShape, ids: string[], startPointId?: string): string[] {
  const first = ids[0];
  const last = ids[ids.length - 1];
  if (startPointId === first) return ids;
  if (startPointId === last) return [...ids].reverse();

  const a = pointById(shape, first);
  const b = pointById(shape, last);
  const startAtFirst =
    a.x < b.x - XY_EPS || (Math.abs(a.x - b.x) <= XY_EPS && a.y <= b.y + XY_EPS);
  return startAtFirst ? ids : [...ids].reverse();
}

/** 闭合路径：调整为目标方向，并旋转到起点（最左顶点，横坐标相同取较高顶点） */
function orientClosedPath(
  shape: GeometryShape,
  ids: string[],
  direction: PlaybackDirection,
  startPointId?: string,
): string[] {
  let ordered = [...ids];
  if (direction !== 'forward') {
    const pts = ordered.map((id) => pointById(shape, id));
    const ccw = signedArea(pts) > 0;
    if ((direction === 'clockwise' && ccw) || (direction === 'counterclockwise' && !ccw)) {
      ordered = ordered.reverse();
    }
  }

  let startId = startPointId && ordered.includes(startPointId) ? startPointId : undefined;
  if (!startId) {
    let best = ordered[0];
    for (const id of ordered) {
      const p = pointById(shape, id);
      const q = pointById(shape, best);
      if (p.x < q.x - XY_EPS || (Math.abs(p.x - q.x) <= XY_EPS && p.y > q.y + XY_EPS)) {
        best = id;
      }
    }
    startId = best;
  }
  const k = ordered.indexOf(startId);
  return [...ordered.slice(k), ...ordered.slice(0, k)];
}

export function buildTraversal(shape: GeometryShape, options: TraversalOptions = {}): TraversalPlan {
  const direction = options.direction ?? shape.playbackDirection ?? 'forward';
  const startPointId = options.startPointId ?? shape.startPointId;

  // 建立“两个端点 → 线段 id”的查找表（正反两个方向）
  const segLookup = new Map<string, string>();
  for (const seg of shape.segments) {
    segLookup.set(`${seg.startPointId}|${seg.endPointId}`, seg.id);
    segLookup.set(`${seg.endPointId}|${seg.startPointId}`, seg.id);
  }

  const raw = extractRawPaths(shape);
  const paths: TraversalPath[] = [];
  const legs: TraversalLeg[] = [];
  const pathStartLegIndex: number[] = [];

  raw.forEach((path, pathIndex) => {
    const orientedIds = path.closed
      ? orientClosedPath(shape, path.pointIds, direction, startPointId)
      : orientOpenPath(shape, path.pointIds, startPointId);

    paths.push({ pointIds: orientedIds, closed: path.closed });
    pathStartLegIndex.push(legs.length);

    const legCount = path.closed ? orientedIds.length : orientedIds.length - 1;
    for (let i = 0; i < legCount; i++) {
      const fromId = orientedIds[i];
      const toId = orientedIds[(i + 1) % orientedIds.length];
      const segmentId = segLookup.get(`${fromId}|${toId}`) ?? '';
      legs.push({
        from: pointById(shape, fromId),
        to: pointById(shape, toId),
        segmentId,
        pathIndex,
      });
    }
  });

  return { paths, legs, pathStartLegIndex };
}

export interface ShapeStats {
  vertexCount: number;
  edgeCount: number;
  pathCount: number;
  closed: boolean;
  totalLength: number;
}

export function shapeStats(shape: GeometryShape): ShapeStats {
  const byId = new Map(shape.points.map((p) => [p.id, p]));
  let totalLength = 0;
  for (const seg of shape.segments) {
    const a = byId.get(seg.startPointId);
    const b = byId.get(seg.endPointId);
    if (a && b) totalLength += segmentLength(a, b);
  }
  const raw = extractRawPaths(shape);
  return {
    vertexCount: shape.points.filter((p) => p.cue !== false).length,
    edgeCount: shape.segments.length,
    pathCount: raw.length,
    closed: raw.length > 0 && raw.every((p) => p.closed),
    totalLength,
  };
}

/** 闭合图形验证：所有路径是否都真正闭合 */
export function checkClosure(shape: GeometryShape): boolean {
  const raw = extractRawPaths(shape);
  return raw.length > 0 && raw.every((p) => p.closed);
}
