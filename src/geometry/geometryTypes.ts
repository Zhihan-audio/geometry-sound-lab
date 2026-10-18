// Geometry data structure definitions

export interface Vec2 {
  x: number;
  y: number;
}

export interface GeometryPoint {
  id: string;
  x: number; // 0..1, 0 = leftmost
  y: number; // 0..1, 0 = bottom
  /** Whether this point triggers the vertex cue sound; false for curve sample points, default true */
  cue?: boolean;
}

export interface GeometrySegment {
  id: string;
  startPointId: string;
  endPointId: string;
  order: number;
}

export type PlaybackDirection = 'clockwise' | 'counterclockwise' | 'forward';

export interface GeometryShape {
  id: string;
  name: string;
  type: string;
  points: GeometryPoint[];
  segments: GeometrySegment[];
  closed: boolean;
  startPointId?: string;
  playbackDirection: PlaybackDirection;
  /** Smooth curve (circle, parabola, etc.): no per-vertex pauses; duration spans the whole path */
  smooth?: boolean;
  /** Supplementary description for screen readers */
  description?: string;
}
