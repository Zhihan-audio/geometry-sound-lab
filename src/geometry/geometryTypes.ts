// 几何数据结构定义

export interface Vec2 {
  x: number;
  y: number;
}

export interface GeometryPoint {
  id: string;
  x: number; // 0..1，0 = 最左
  y: number; // 0..1，0 = 最下
  /** 是否在该点触发顶点提示音；曲线采样点为 false，默认 true */
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
  /** 平滑曲线（圆、抛物线等）：不做逐点顶点停顿，时长按整条路径计算 */
  smooth?: boolean;
  /** 面向屏幕阅读器的补充描述 */
  description?: string;
}
