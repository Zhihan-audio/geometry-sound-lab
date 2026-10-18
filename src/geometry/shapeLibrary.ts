// Built-in shape library: basic lines, polygons, circles & curves, graphs & functions
import type { GeometryPoint, GeometrySegment, GeometryShape } from './geometryTypes';

type Coord = [number, number];

interface ShapeOpts {
  closed?: boolean;
  smooth?: boolean;
  description?: string;
  type?: string;
}

/** Shape made of one or more polyline paths; `closed` only applies to single-path shapes */
function makeShape(id: string, name: string, paths: Coord[][], opts: ShapeOpts = {}): GeometryShape {
  const points: GeometryPoint[] = [];
  const segments: GeometrySegment[] = [];
  let order = 0;

  paths.forEach((coords, pathIdx) => {
    const ids: string[] = [];
    coords.forEach(([x, y], i) => {
      const pid = `${id}-P${pathIdx}-${i}`;
      points.push({ id: pid, x, y, cue: opts.smooth ? false : undefined });
      ids.push(pid);
    });
    for (let i = 0; i < ids.length - 1; i++) {
      segments.push({
        id: `${id}-S${pathIdx}-${i}`,
        startPointId: ids[i],
        endPointId: ids[i + 1],
        order: order++,
      });
    }
    if (opts.closed && ids.length >= 3) {
      segments.push({
        id: `${id}-S${pathIdx}-close`,
        startPointId: ids[ids.length - 1],
        endPointId: ids[0],
        order: order++,
      });
    }
  });

  return {
    id,
    name,
    type: opts.type ?? (opts.closed ? 'polygon' : 'line'),
    points,
    segments,
    closed: opts.closed ?? false,
    playbackDirection: opts.closed ? 'clockwise' : 'forward',
    smooth: opts.smooth,
    description: opts.description,
  };
}

function pointShape(id: string, name: string, x: number, y: number, description?: string): GeometryShape {
  return {
    id,
    name,
    type: 'point',
    points: [{ id: `${id}-P0`, x, y }],
    segments: [],
    closed: false,
    playbackDirection: 'forward',
    description,
  };
}

function regularPolygon(id: string, name: string, n: number, r = 0.35, description?: string): GeometryShape {
  const coords: Coord[] = [];
  for (let k = 0; k < n; k++) {
    const angle = Math.PI / 2 + (2 * Math.PI * k) / n;
    coords.push([0.5 + r * Math.cos(angle), 0.5 + r * Math.sin(angle)]);
  }
  return makeShape(id, name, [coords], { closed: true, description });
}

function sampledCurve(
  id: string,
  name: string,
  fn: (t: number) => Coord,
  samples: number,
  closed: boolean,
  description?: string,
): GeometryShape {
  const coords: Coord[] = [];
  const count = closed ? samples : samples + 1;
  for (let k = 0; k < count; k++) {
    coords.push(fn(k / samples));
  }
  return makeShape(id, name, [coords], { closed, smooth: true, type: 'curve', description });
}

// ---------- Basic points and lines ----------

const basicLines: GeometryShape[] = [
  pointShape('point-single', 'Single Point', 0.5, 0.5, 'One point right in the middle'),
  makeShape('line-horizontal', 'Horizontal Line', [[[0.1, 0.5], [0.9, 0.5]]], {
    description: 'A flat line from left to right — the pitch stays the same',
  }),
  makeShape('line-vertical', 'Vertical Line', [[[0.5, 0.1], [0.5, 0.9]]], {
    description: 'A line from bottom to top — the sound stays centered while the pitch climbs',
  }),
  makeShape('line-rising', 'Rising Line', [[[0.1, 0.1], [0.9, 0.9]]], {
    description: 'From bottom-left to top-right — the pitch rises as the sound moves right',
  }),
  makeShape('line-falling', 'Falling Line', [[[0.1, 0.9], [0.9, 0.1]]], {
    description: 'From top-left to bottom-right — the pitch falls as the sound moves right',
  }),
  makeShape('line-gentle', 'Gentle Slope', [[[0.1, 0.4], [0.9, 0.6]]], {
    description: 'A rising line with a gentle, easy slope',
  }),
  makeShape('line-steep', 'Steep Slope', [[[0.35, 0.1], [0.65, 0.9]]], {
    description: 'A rising line with a steep, fast slope',
  }),
  makeShape('line-polyline', 'Zigzag Line', [[[0.1, 0.2], [0.35, 0.7], [0.6, 0.35], [0.9, 0.8]]], {
    description: 'A zigzag line that changes direction at three corners',
  }),
  makeShape(
    'line-cross',
    'Cross (+)',
    [
      [[0.15, 0.5], [0.85, 0.5]],
      [[0.5, 0.15], [0.5, 0.85]],
    ],
    { type: 'multiline', description: 'A horizontal and a vertical line crossing in the middle' },
  ),
  makeShape(
    'line-x',
    'X Cross',
    [
      [[0.1, 0.1], [0.9, 0.9]],
      [[0.1, 0.9], [0.9, 0.1]],
    ],
    { type: 'multiline', description: 'Two slanted lines crossing in the middle like an X' },
  ),
  makeShape(
    'line-parallel',
    'Parallel Lines',
    [
      [[0.1, 0.35], [0.9, 0.35]],
      [[0.1, 0.65], [0.9, 0.65]],
    ],
    { type: 'multiline', description: 'Two flat lines that never touch' },
  ),
  makeShape(
    'line-perpendicular',
    'Perpendicular Lines',
    [
      [[0.1, 0.3], [0.9, 0.3]],
      [[0.5, 0.3], [0.5, 0.85]],
    ],
    { type: 'multiline', description: 'A vertical line standing straight up on a horizontal line' },
  ),
];

// ---------- Polygons ----------

const polygons: GeometryShape[] = [
  makeShape('poly-triangle', 'Triangle', [[[0.15, 0.2], [0.85, 0.25], [0.45, 0.8]]], {
    closed: true,
    description: 'A triangle with three sides and three corners',
  }),
  makeShape('poly-right-triangle', 'Right Triangle', [[[0.15, 0.15], [0.75, 0.15], [0.15, 0.75]]], {
    closed: true,
    description: 'A triangle with a square corner at the bottom left',
  }),
  makeShape(
    'poly-equilateral',
    'Equilateral Triangle',
    [[[0.15, 0.2], [0.85, 0.2], [0.5, 0.2 + 0.7 * Math.sin(Math.PI / 3)]]],
    { closed: true, description: 'A triangle whose three sides are all the same length' },
  ),
  makeShape('poly-square', 'Square', [[[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]], {
    closed: true,
    description: 'Four equal sides and four square corners',
  }),
  makeShape('poly-rectangle', 'Rectangle', [[[0.1, 0.3], [0.9, 0.3], [0.9, 0.7], [0.1, 0.7]]], {
    closed: true,
    description: 'A rectangle that is wider than it is tall',
  }),
  makeShape('poly-trapezoid', 'Trapezoid', [[[0.15, 0.25], [0.85, 0.25], [0.68, 0.7], [0.32, 0.7]]], {
    closed: true,
    description: 'A shape with a short top and a long bottom',
  }),
  makeShape('poly-rhombus', 'Rhombus', [[[0.5, 0.12], [0.8, 0.5], [0.5, 0.88], [0.2, 0.5]]], {
    closed: true,
    description: 'A diamond shape with four equal sides',
  }),
  regularPolygon('poly-pentagon', 'Pentagon', 5, 0.35, 'A regular five-sided shape'),
  regularPolygon('poly-hexagon', 'Hexagon', 6, 0.35, 'A regular six-sided shape'),
];

// ---------- Circles & curves ----------

const curves: GeometryShape[] = [
  sampledCurve(
    'curve-circle',
    'Circle',
    (t) => {
      const a = 2 * Math.PI * t;
      return [0.5 + 0.35 * Math.cos(a), 0.5 + 0.35 * Math.sin(a)];
    },
    64,
    true,
    'A smooth, round circle — no corners at all',
  ),
  sampledCurve(
    'curve-ellipse',
    'Ellipse',
    (t) => {
      const a = 2 * Math.PI * t;
      return [0.5 + 0.4 * Math.cos(a), 0.5 + 0.24 * Math.sin(a)];
    },
    64,
    true,
    'A stretched circle, wider than it is tall',
  ),
];

// ---------- Graphs & functions ----------

const functions: GeometryShape[] = [
  makeShape(
    'fn-axes',
    'Coordinate Axes',
    [
      [[0.05, 0.5], [0.95, 0.5]],
      [[0.5, 0.05], [0.5, 0.95]],
    ],
    { type: 'multiline', description: 'The x-axis and y-axis crossing at the origin' },
  ),
  makeShape('fn-linear-up', 'Rising Linear Graph', [[[0.1, 0.2], [0.9, 0.8]]], {
    description: 'A straight-line graph with a positive slope',
  }),
  makeShape('fn-linear-down', 'Falling Linear Graph', [[[0.1, 0.8], [0.9, 0.2]]], {
    description: 'A straight-line graph with a negative slope',
  }),
  makeShape('fn-vshape', 'V Shape', [[[0.1, 0.8], [0.5, 0.15], [0.9, 0.8]]], {
    description: 'Falls down, hits a corner, then rises back up like a V',
  }),
  sampledCurve(
    'fn-parabola',
    'Parabola',
    (t) => {
      const x = 0.1 + 0.8 * t;
      const y = 0.15 + 2.6 * Math.pow(x - 0.5, 2);
      return [x, Math.min(1, y)];
    },
    48,
    false,
    'A smooth curve that dips down and comes back up',
  ),
  sampledCurve(
    'fn-sine',
    'Sine Wave',
    (t) => {
      const x = 0.1 + 0.8 * t;
      const y = 0.5 + 0.3 * Math.sin(((x - 0.1) / 0.8) * Math.PI * 3);
      return [x, y];
    },
    72,
    false,
    'A smooth wave that goes up and down like gentle hills',
  ),
];

export interface ShapeCategory {
  id: string;
  name: string;
  emoji: string;
  shapes: GeometryShape[];
}

export const shapeCategories: ShapeCategory[] = [
  { id: 'basic-lines', name: 'Basic Lines', emoji: '📏', shapes: basicLines },
  { id: 'polygons', name: 'Polygons', emoji: '🔷', shapes: polygons },
  { id: 'curves', name: 'Circles & Curves', emoji: '⭕', shapes: curves },
  { id: 'functions', name: 'Graphs & Functions', emoji: '📈', shapes: functions },
];

const allShapes = new Map<string, GeometryShape>();
for (const cat of shapeCategories) {
  for (const s of cat.shapes) allShapes.set(s.id, s);
}

export function getLibraryShape(id: string): GeometryShape | undefined {
  return allShapes.get(id);
}

export const DEFAULT_SHAPE_ID = 'line-horizontal';

/** Single-segment lines selectable in the Slope Lab */
export const slopeCompareLines: GeometryShape[] = [
  getLibraryShape('line-horizontal')!,
  getLibraryShape('line-vertical')!,
  getLibraryShape('line-rising')!,
  getLibraryShape('line-falling')!,
  getLibraryShape('line-gentle')!,
  getLibraryShape('line-steep')!,
  getLibraryShape('fn-linear-up')!,
  getLibraryShape('fn-linear-down')!,
];
