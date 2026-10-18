// Shape traversal: path extraction, start-point selection, clockwise/counterclockwise ordering, building the "leg" sequence for playback
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
  pointIds: string[]; // ordered vertices; a closed path does not repeat its start
  closed: boolean;
}

export interface TraversalPlan {
  paths: TraversalPath[];
  legs: TraversalLeg[];
  /** Index into legs of each path's first leg */
  pathStartLegIndex: number[];
}

export interface TraversalOptions {
  direction?: PlaybackDirection;
  startPointId?: string;
}

const XY_EPS = 1e-9;

/** Chain segments by order into one or more continuous paths */
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

/** Open path: prefer the leftmost endpoint; same x takes the lower one; a teacher-specified start wins */
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

/** Closed path: adjust to the target direction and rotate to the start (leftmost vertex; same x takes the higher one) */
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

  // Build an "endpoint pair → segment id" lookup table (both directions)
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

/** Closure check: whether every path is truly closed */
export function checkClosure(shape: GeometryShape): boolean {
  const raw = extractRawPaths(shape);
  return raw.length > 0 && raw.every((p) => p.closed);
}
