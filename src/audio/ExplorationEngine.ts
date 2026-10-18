// 主动探索引擎：键盘控制声音指针，在坐标空间中探索图形
import type { GeometryShape, Vec2 } from '../geometry/geometryTypes';
import { findIntersections } from '../geometry/intersections';
import { nearestSegmentOnShape } from '../geometry/nearestPoint';
import { segmentLength } from '../geometry/slopeAnalysis';
import type { AudioEngine } from './AudioEngine';
import type { CueSoundEngine } from './CueSoundEngine';
import { mapPosition, type PitchSettings } from './SonificationMapper';
import { BASE_MS_PER_UNIT } from './PlaybackScheduler';

export const NEAR_THRESHOLD = 0.04; // 距线条多近算“在线上”
export const SNAP_RADIUS = 0.05;
export const VERTEX_RADIUS = 0.035;

export interface ExplorationSettings {
  speed: number;
  snapEnabled: boolean;
  pitch: PitchSettings;
}

export type ExplorationEvent =
  | { type: 'position'; x: number; y: number; onLine: boolean; pan: number; midi: number }
  | { type: 'enterLine' }
  | { type: 'leaveLine' }
  | { type: 'vertex'; pointId: string }
  | { type: 'intersection' }
  | { type: 'followEnd' }
  | { type: 'soundToggle'; on: boolean };

export interface ExplorationSnapshot {
  x: number;
  y: number;
  onLine: boolean;
  soundOn: boolean;
}

export class ExplorationEngine {
  private shape: GeometryShape | null = null;
  private pos: Vec2 = { x: 0.5, y: 0.5 };
  private active = false;
  private soundOn = true;
  private onLine = false;
  private lastVertexId: string | null = null;
  private lastIntersectionIdx: number | null = null;
  private intersections: Vec2[] = [];
  private followTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(e: ExplorationEvent) => void>();

  constructor(
    private audio: AudioEngine,
    private cues: CueSoundEngine,
    private getSettings: () => ExplorationSettings,
  ) {}

  subscribe(fn: (e: ExplorationEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: ExplorationEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get isActive(): boolean {
    return this.active;
  }

  get position(): Vec2 {
    return { ...this.pos };
  }

  start(shape: GeometryShape): void {
    this.shape = shape;
    this.active = true;
    this.soundOn = true;
    this.pos = { x: 0.5, y: 0.5 };
    this.onLine = false;
    this.lastVertexId = null;
    this.lastIntersectionIdx = null;
    this.intersections = findIntersections(shape).map((p) => ({ x: p.x, y: p.y }));
    this.evaluate();
  }

  stop(): void {
    this.active = false;
    this.cancelFollow();
    this.audio.stopVoice();
    this.audio.setNoiseActive(false);
  }

  move(dx: number, dy: number): void {
    this.moveTo(this.pos.x + dx, this.pos.y + dy);
  }

  /** Move the pointer to an absolute grid position (keyboard steps and hand tracking both land here) */
  moveTo(x: number, y: number): void {
    if (!this.active || !this.shape) return;
    this.cancelFollow();
    const s = this.getSettings();
    let nx = Math.max(0, Math.min(1, x));
    let ny = Math.max(0, Math.min(1, y));

    if (s.snapEnabled) {
      const near = nearestSegmentOnShape(this.shape, { x: nx, y: ny });
      if (near && near.distance <= SNAP_RADIUS) {
        nx = near.point.x;
        ny = near.point.y;
      }
    }
    this.pos = { x: nx, y: ny };
    this.evaluate();
  }

  toggleSound(): boolean {
    this.soundOn = !this.soundOn;
    if (!this.soundOn) {
      this.audio.stopVoice();
      this.audio.setNoiseActive(false);
    } else {
      this.evaluate();
    }
    this.emit({ type: 'soundToggle', on: this.soundOn });
    return this.soundOn;
  }

  query(): ExplorationSnapshot {
    return {
      x: this.pos.x,
      y: this.pos.y,
      onLine: this.onLine,
      soundOn: this.soundOn,
    };
  }

  /** 自动沿最近的线段前进（F 键），到达线段终点后停止 */
  autoFollow(): boolean {
    if (!this.active || !this.shape) return false;
    const near = nearestSegmentOnShape(this.shape, this.pos);
    if (!near || near.distance > NEAR_THRESHOLD) return false;
    this.cancelFollow();

    const s = this.getSettings();
    const a = near.a;
    const b = near.b;
    const total = segmentLength(a, b);
    const remaining = total * (1 - near.t);
    if (remaining < 1e-6) return false;
    const durationMs = Math.max(200, (remaining * BASE_MS_PER_UNIT) / Math.max(0.1, s.speed));
    const startT = near.t;
    const startedAt = performance.now();

    this.followTimer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
      const t = startT + (1 - startT) * progress;
      this.pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      this.evaluate();
      if (progress >= 1) {
        this.cancelFollow();
        this.emit({ type: 'followEnd' });
      }
    }, 30);
    return true;
  }

  cancelFollow(): void {
    if (this.followTimer !== null) {
      clearInterval(this.followTimer);
      this.followTimer = null;
    }
  }

  private evaluate(): void {
    if (!this.shape) return;
    const s = this.getSettings();
    const near = nearestSegmentOnShape(this.shape, this.pos);
    const on = near !== null && near.distance <= NEAR_THRESHOLD;
    const m = mapPosition(this.pos.x, this.pos.y, s.pitch);

    if (this.soundOn && on) {
      this.audio.startVoice(m.frequency, m.pan);
      this.audio.setNoiseActive(false);
    } else {
      this.audio.stopVoice(40);
      this.audio.setNoiseActive(this.soundOn && !on);
    }

    if (on !== this.onLine) {
      this.emit({ type: on ? 'enterLine' : 'leaveLine' });
      this.onLine = on;
    }

    // 顶点接近检测（每个顶点只在进入范围时提示一次）
    const vp = this.shape.points.find(
      (p) => p.cue !== false && Math.hypot(p.x - this.pos.x, p.y - this.pos.y) <= VERTEX_RADIUS,
    );
    if (vp && vp.id !== this.lastVertexId) {
      this.cues.play('vertex', m.pan);
      this.emit({ type: 'vertex', pointId: vp.id });
    }
    this.lastVertexId = vp?.id ?? null;

    // 交点接近检测
    const ii = this.intersections.findIndex(
      (p) => Math.hypot(p.x - this.pos.x, p.y - this.pos.y) <= VERTEX_RADIUS,
    );
    if (ii >= 0 && ii !== this.lastIntersectionIdx) {
      this.cues.play('intersection', m.pan);
      this.emit({ type: 'intersection' });
    }
    this.lastIntersectionIdx = ii >= 0 ? ii : null;

    this.emit({
      type: 'position',
      x: this.pos.x,
      y: this.pos.y,
      onLine: on,
      pan: m.pan,
      midi: m.midi,
    });
  }
}
