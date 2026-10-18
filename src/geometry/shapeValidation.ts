// Custom shape data validation: used for JSON import and local-storage restore
import type { GeometryPoint, GeometrySegment, GeometryShape, PlaybackDirection } from './geometryTypes';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  shape?: GeometryShape;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const DIRECTIONS: PlaybackDirection[] = ['clockwise', 'counterclockwise', 'forward'];

export function validateShapeData(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(data)) {
    return { ok: false, errors: ['Data is not a valid object'] };
  }

  if (!Array.isArray(data.points)) errors.push('Missing points array');
  if (!Array.isArray(data.segments)) errors.push('Missing segments array');
  if (errors.length > 0) return { ok: false, errors };

  const points: GeometryPoint[] = [];
  const pointIds = new Set<string>();
  for (const [i, raw] of (data.points as unknown[]).entries()) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.x !== 'number' || typeof raw.y !== 'number') {
      errors.push(`Point ${i + 1} is malformed (needs id, x, y)`);
      continue;
    }
    if (pointIds.has(raw.id)) {
      errors.push(`Duplicate point id: ${raw.id}`);
      continue;
    }
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) {
      errors.push(`Point ${raw.id} has invalid coordinates`);
      continue;
    }
    pointIds.add(raw.id);
    points.push({
      id: raw.id,
      x: clamp01(raw.x),
      y: clamp01(raw.y),
      cue: raw.cue === false ? false : undefined,
    });
  }

  const segments: GeometrySegment[] = [];
  const segIds = new Set<string>();
  for (const [i, raw] of (data.segments as unknown[]).entries()) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      typeof raw.startPointId !== 'string' ||
      typeof raw.endPointId !== 'string'
    ) {
      errors.push(`Segment ${i + 1} is malformed (needs id, startPointId, endPointId)`);
      continue;
    }
    if (segIds.has(raw.id)) {
      errors.push(`Duplicate segment id: ${raw.id}`);
      continue;
    }
    if (!pointIds.has(raw.startPointId) || !pointIds.has(raw.endPointId)) {
      errors.push(`Segment ${raw.id} references a missing point`);
      continue;
    }
    segIds.add(raw.id);
    segments.push({
      id: raw.id,
      startPointId: raw.startPointId,
      endPointId: raw.endPointId,
      order: typeof raw.order === 'number' ? raw.order : i,
    });
  }

  if (points.length === 0) errors.push('The shape has no points');
  if (errors.length > 0) return { ok: false, errors };

  const shape: GeometryShape = {
    id: typeof data.id === 'string' && data.id ? data.id : `custom-${Date.now()}`,
    name: typeof data.name === 'string' && data.name ? data.name : 'Untitled Shape',
    type: typeof data.type === 'string' ? data.type : 'custom',
    points,
    segments,
    closed: data.closed === true,
    startPointId:
      typeof data.startPointId === 'string' && pointIds.has(data.startPointId)
        ? data.startPointId
        : undefined,
    playbackDirection: DIRECTIONS.includes(data.playbackDirection as PlaybackDirection)
      ? (data.playbackDirection as PlaybackDirection)
      : 'forward',
    smooth: data.smooth === true,
  };

  return { ok: true, errors: [], shape };
}
