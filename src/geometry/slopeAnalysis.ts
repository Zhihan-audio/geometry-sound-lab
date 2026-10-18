// 斜率分析：斜率计算、分类与两线比较
import type { Vec2 } from './geometryTypes';

export const EPS = 1e-9;

export function segmentLength(a: Vec2, b: Vec2): number {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}

/** 斜率；竖直线返回 null（斜率不存在） */
export function slopeOf(a: Vec2, b: Vec2): number | null {
  const dx = b.x - a.x;
  if (Math.abs(dx) < EPS) return null;
  return (b.y - a.y) / dx;
}

export type SlopeClass =
  | 'horizontal'
  | 'vertical'
  | 'gentle-up'
  | 'steep-up'
  | 'gentle-down'
  | 'steep-down';

/** |斜率| >= 1 视为陡，否则为缓 */
export function classifySlope(a: Vec2, b: Vec2): SlopeClass {
  const m = slopeOf(a, b);
  if (m === null) return 'vertical';
  if (Math.abs(m) < EPS) return 'horizontal';
  if (m > 0) return Math.abs(m) >= 1 ? 'steep-up' : 'gentle-up';
  return Math.abs(m) >= 1 ? 'steep-down' : 'gentle-down';
}

export function slopeClassLabel(cls: SlopeClass): string {
  switch (cls) {
    case 'horizontal':
      return 'flat horizontal line, slope 0';
    case 'vertical':
      return 'vertical line, slope undefined';
    case 'gentle-up':
      return 'gentle rising line, positive slope';
    case 'steep-up':
      return 'steep rising line, positive slope';
    case 'gentle-down':
      return 'gentle falling line, negative slope';
    case 'steep-down':
      return 'steep falling line, negative slope';
  }
}

export interface LineComparison {
  aClass: SlopeClass;
  bClass: SlopeClass;
  aSlope: number | null;
  bSlope: number | null;
  steeper: 'a' | 'b' | 'equal';
  parallel: boolean;
  perpendicular: boolean;
}

const CMP_EPS = 1e-6;

export function compareLines(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): LineComparison {
  const ma = slopeOf(a1, a2);
  const mb = slopeOf(b1, b2);

  let steeper: 'a' | 'b' | 'equal';
  const steepness = (m: number | null): number => (m === null ? Infinity : Math.abs(m));
  const sa = steepness(ma);
  const sb = steepness(mb);
  if (Math.abs(sa - sb) < CMP_EPS || (sa === Infinity && sb === Infinity)) steeper = 'equal';
  else steeper = sa > sb ? 'a' : 'b';

  let parallel: boolean;
  if (ma === null && mb === null) parallel = true;
  else if (ma === null || mb === null) parallel = false;
  else parallel = Math.abs(ma - mb) < CMP_EPS;

  let perpendicular: boolean;
  if (ma === null) perpendicular = mb !== null && Math.abs(mb) < CMP_EPS;
  else if (mb === null) perpendicular = Math.abs(ma) < CMP_EPS;
  else perpendicular = Math.abs(ma * mb + 1) < CMP_EPS;

  return {
    aClass: classifySlope(a1, a2),
    bClass: classifySlope(b1, b2),
    aSlope: ma,
    bSlope: mb,
    steeper,
    parallel,
    perpendicular,
  };
}
