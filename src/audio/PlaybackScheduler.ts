// 播放调度器：让单声部声音点沿图形轮廓移动，处理顶点停顿、交点脉冲、闭合提示与循环
import type { GeometryShape, PlaybackDirection } from '../geometry/geometryTypes';
import { buildTraversal, type TraversalLeg, type TraversalPlan } from '../geometry/traversal';
import { findIntersections } from '../geometry/intersections';
import { projectPointToSegment } from '../geometry/nearestPoint';
import { segmentLength } from '../geometry/slopeAnalysis';
import { mapPosition, xToPan, type PitchSettings } from './SonificationMapper';
import type { CueType } from './CueSoundEngine';

export const BASE_MS_PER_UNIT = 3000; // 单位距离(1.0)的基准播放时间
export const MIN_LEG_MS = 300;
export const MAX_LEG_MS = 8000;
export const START_DELAY_MS = 350;
export const PATH_GAP_MS = 500;
export const LOOP_GAP_MS = 800;
export const POINT_HOLD_MS = 1200;

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'stopped';

export interface SchedulerSettings {
  speed: number; // 速度倍率，1 = 正常
  vertexPauseMs: number; // 0..500
  vertexCueEnabled: boolean;
  intersectionCueEnabled: boolean;
  closureCueEnabled: boolean;
  loopEnabled: boolean;
  pitch: PitchSettings;
}

export type SchedulerEvent =
  | { type: 'status'; status: PlaybackStatus }
  | { type: 'position'; x: number; y: number; pan: number; midi: number; legIndex: number }
  | { type: 'vertex'; pointId: string; x: number; y: number }
  | { type: 'intersection'; x: number; y: number }
  | { type: 'closure' }
  | { type: 'pathStart'; pathIndex: number; pathCount: number }
  | { type: 'segment'; index: number; total: number }
  | { type: 'end' }
  | { type: 'error'; message: string };

/** 主声部接口（便于测试时注入桩对象） */
export interface VoiceEngineLike {
  startVoice(frequency: number, pan: number): void;
  updateVoice(frequency: number, pan: number, glide?: number): void;
  duckVoice(ducked: boolean): void;
  stopVoice(fadeMs?: number): void;
}

export interface CueEngineLike {
  play(type: CueType, pan?: number): void;
}

interface IntersectionMark {
  t: number;
  x: number;
  y: number;
}

type Phase = 'idle' | 'leg' | 'gap';

export class PlaybackScheduler {
  private shape: GeometryShape | null = null;
  private plan: TraversalPlan | null = null;
  private legIntersections: IntersectionMark[][] = [];
  private pathLengths: number[] = [];
  private segmentStarts: number[] = [];
  private fired = new Set<string>();

  private status: PlaybackStatus = 'idle';
  private mode: 'all' | 'single' = 'all';
  private phase: Phase = 'idle';
  private legIndex = 0;
  private legStart = 0;
  private legDuration = 1;
  private gapEnd = 0;
  private gapNext: (() => void) | null = null;
  private pauseStart = 0;
  private voiceOn = false;
  private speedFactor = 1;

  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(e: SchedulerEvent) => void>();

  constructor(
    private voice: VoiceEngineLike,
    private cues: CueEngineLike,
    private getSettings: () => SchedulerSettings,
  ) {}

  subscribe(fn: (e: SchedulerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: SchedulerEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get playbackStatus(): PlaybackStatus {
    return this.status;
  }

  get currentLegIndex(): number {
    return this.legIndex;
  }

  get legCount(): number {
    return this.plan?.legs.length ?? 0;
  }

  get legs(): TraversalLeg[] {
    return this.plan?.legs ?? [];
  }

  get currentShape(): GeometryShape | null {
    return this.shape;
  }

  get traversalPlan(): TraversalPlan | null {
    return this.plan;
  }

  /** 加载图形（会停止当前播放）。direction 覆盖图形默认播放方向 */
  load(shape: GeometryShape, direction?: PlaybackDirection): void {
    this.stop();
    this.shape = shape;
    try {
      this.plan = buildTraversal(shape, {
        direction: direction ?? shape.playbackDirection,
        startPointId: shape.startPointId,
      });
    } catch (err) {
      this.plan = null;
      const message = err instanceof Error ? err.message : 'Invalid shape data';
      console.error('Failed to load shape', err);
      this.emit({ type: 'error', message });
      return;
    }
    this.legIndex = 0;

    // 预计算每条腿上的交点参数位置（交点在腿的中段才触发；端点交点由顶点处理）
    const intersections = findIntersections(shape);
    this.legIntersections = this.plan.legs.map((leg) => {
      const marks: IntersectionMark[] = [];
      for (const ip of intersections) {
        const proj = projectPointToSegment(ip, leg.from, leg.to);
        if (proj.distance < 1e-6 && proj.t > 0.005 && proj.t < 0.995) {
          marks.push({ t: proj.t, x: ip.x, y: ip.y });
        }
      }
      marks.sort((a, b) => a.t - b.t);
      return marks;
    });

    // 平滑曲线：整条路径的总长度用于分配时长
    this.pathLengths = this.plan.paths.map((_, pathIdx) =>
      this.plan!.legs.filter((l) => l.pathIndex === pathIdx).reduce(
        (sum, l) => sum + segmentLength(l.from, l.to),
        0,
      ),
    );

    this.computeSegmentStarts();
    this.emit({ type: 'segment', index: 0, total: this.segmentStarts.length });
  }

  // ---------- 逻辑边：平滑曲线的采样接点（cue===false）不是边界 ----------
  // 一个圆 / 一条正弦曲线 = 一条逻辑边；多边形每条边仍各算一条。
  // 逐边模式按逻辑边播放与导航，界面计数也用逻辑边。

  private computeSegmentStarts(): void {
    const legs = this.plan?.legs ?? [];
    this.segmentStarts = [];
    for (let i = 0; i < legs.length; i++) {
      // 新逻辑边开始于：首条腿、换路径、或上一个接点是真正的顶点
      if (i === 0 || legs[i].pathIndex !== legs[i - 1].pathIndex || legs[i].from.cue !== false) {
        this.segmentStarts.push(i);
      }
    }
  }

  private logicalIndexOf(legIndex: number): number {
    let result = 0;
    for (let k = 0; k < this.segmentStarts.length; k++) {
      if (this.segmentStarts[k] <= legIndex) result = k;
      else break;
    }
    return result;
  }

  private segmentStartOf(legIndex: number): number {
    return this.segmentStarts[this.logicalIndexOf(legIndex)] ?? 0;
  }

  private segmentEndOf(legIndex: number): number {
    const li = this.logicalIndexOf(legIndex);
    const nextStart =
      li + 1 < this.segmentStarts.length ? this.segmentStarts[li + 1] : (this.plan?.legs.length ?? 1);
    return nextStart - 1;
  }

  /** 当前逻辑边信息（供界面显示与语音描述） */
  get currentSegment(): {
    index: number;
    total: number;
    startLeg: number;
    endLeg: number;
    isCurve: boolean;
  } | null {
    if (!this.plan || this.plan.legs.length === 0 || this.segmentStarts.length === 0) return null;
    const startLeg = this.segmentStartOf(this.legIndex);
    const endLeg = this.segmentEndOf(this.legIndex);
    return {
      index: this.logicalIndexOf(this.legIndex),
      total: this.segmentStarts.length,
      startLeg,
      endLeg,
      isCurve: endLeg > startLeg,
    };
  }

  /** 连续轮廓播放 */
  playAll(options: { speedFactor?: number } = {}): void {
    if (!this.shape || !this.plan) {
      this.emit({ type: 'error', message: 'No shape selected yet' });
      return;
    }
    this.stopInternal(false);
    this.speedFactor = options.speedFactor ?? 1;
    this.mode = 'all';
    this.fired.clear();

    if (this.plan.legs.length === 0) {
      this.playPoint();
      return;
    }

    const first = this.plan.legs[0].from;
    this.setStatus('playing');
    this.cues.play('start', xToPan(first.x));
    this.enterGap(START_DELAY_MS, () => {
      this.emit({ type: 'pathStart', pathIndex: 0, pathCount: this.plan!.paths.length });
      this.enterLeg(0);
    });
    this.startTicker();
  }

  /** 单个点：起点音 → 持续音 → 结束音 */
  private playPoint(): void {
    const shape = this.shape;
    if (!shape || shape.points.length === 0) {
      this.emit({ type: 'error', message: 'This shape has no points to play' });
      this.setStatus('stopped');
      return;
    }
    const pt = shape.points[0];
    const s = this.getSettings();
    const m = mapPosition(pt.x, pt.y, s.pitch);
    this.setStatus('playing');
    this.cues.play('start', m.pan);
    this.enterGap(START_DELAY_MS, () => {
      this.voice.startVoice(m.frequency, m.pan);
      this.voiceOn = true;
      this.emit({ type: 'position', x: pt.x, y: pt.y, pan: m.pan, midi: m.midi, legIndex: 0 });
      this.enterGap(POINT_HOLD_MS, () => {
        this.voice.stopVoice();
        this.voiceOn = false;
        this.cues.play('end', m.pan);
        this.emit({ type: 'end' });
        this.setStatus('stopped');
        this.stopTicker();
      });
    });
    this.startTicker();
  }

  /** 分段学习：播放指定的一条边 */
  playSegmentAt(index: number): void {
    if (!this.plan || this.plan.legs.length === 0) {
      this.emit({ type: 'error', message: 'This shape has no edges to play' });
      return;
    }
    this.stopInternal(false);
    this.speedFactor = 1;
    this.mode = 'single';
    this.fired.clear();
    const clamped = Math.max(0, Math.min(this.plan.legs.length - 1, index));
    this.setStatus('playing');
    // 对齐到逻辑边起点：平滑曲线从整条曲线的开头播放
    this.enterLeg(this.segmentStartOf(clamped));
    this.startTicker();
  }

  /** 返回 false 表示已在边界（按逻辑边移动） */
  nextSegment(): boolean {
    if (!this.plan) return false;
    const end = this.segmentEndOf(this.legIndex);
    if (end >= this.plan.legs.length - 1) return false;
    this.playSegmentAt(end + 1);
    return true;
  }

  prevSegment(): boolean {
    if (!this.plan) return false;
    const start = this.segmentStartOf(this.legIndex);
    if (start <= 0) return false;
    this.playSegmentAt(start - 1);
    return true;
  }

  replaySegment(): void {
    this.playSegmentAt(this.legIndex);
  }

  pause(): void {
    if (this.status !== 'playing') return;
    this.pauseStart = performance.now();
    this.voice.duckVoice(true);
    this.setStatus('paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;
    const delta = performance.now() - this.pauseStart;
    this.legStart += delta;
    this.gapEnd += delta;
    if (this.phase === 'leg') this.voice.duckVoice(false);
    this.setStatus('playing');
  }

  stop(): void {
    this.stopInternal(true);
  }

  private stopInternal(emitStatus: boolean): void {
    this.phase = 'idle';
    this.gapNext = null;
    if (this.voiceOn) {
      this.voice.stopVoice();
      this.voiceOn = false;
    }
    this.stopTicker();
    if (emitStatus && (this.status === 'playing' || this.status === 'paused')) {
      this.setStatus('stopped');
    }
  }

  replay(): void {
    if (this.mode === 'single') {
      this.replaySegment();
    } else {
      this.playAll({ speedFactor: this.speedFactor });
    }
  }

  private setStatus(status: PlaybackStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit({ type: 'status', status });
  }

  private startTicker(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), 16);
  }

  private stopTicker(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private enterGap(ms: number, next: () => void): void {
    this.phase = 'gap';
    this.gapEnd = performance.now() + ms;
    this.gapNext = next;
  }

  /**
   * 平滑曲线段强制使用连续滑音：音阶量化会把圆弧的连续音高切成台阶状
   * （听感"卡住"、"一段一段"），破坏曲线的几何辨识。直线与多边形的边
   * 仍按用户设置量化。曲线采样点以 cue === false 标记。
   */
  private pitchFor(leg: TraversalLeg): PitchSettings {
    const pitch = this.getSettings().pitch;
    if (pitch.pitchMode === 'quantized' && (leg.from.cue === false || leg.to.cue === false)) {
      return { ...pitch, pitchMode: 'continuous' };
    }
    return pitch;
  }

  private legDurationFor(index: number): number {
    const s = this.getSettings();
    const leg = this.plan!.legs[index];
    const len = segmentLength(leg.from, leg.to);
    const speed = Math.max(0.1, s.speed * this.speedFactor);
    if (this.shape?.smooth) {
      // 平滑曲线：整条路径限幅后按长度比例分配
      const totalLen = this.pathLengths[leg.pathIndex] || len;
      const totalMs = Math.max(
        MIN_LEG_MS,
        Math.min(MAX_LEG_MS, (totalLen * BASE_MS_PER_UNIT) / speed),
      );
      return Math.max(15, (len / totalLen) * totalMs);
    }
    return Math.max(MIN_LEG_MS, Math.min(MAX_LEG_MS, (len * BASE_MS_PER_UNIT) / speed));
  }

  private enterLeg(index: number): void {
    if (!this.plan) return;
    this.legIndex = index;
    const leg = this.plan.legs[index];
    this.legDuration = this.legDurationFor(index);
    this.legStart = performance.now();
    this.phase = 'leg';

    const m = mapPosition(leg.from.x, leg.from.y, this.pitchFor(leg));
    if (!this.voiceOn) {
      this.voice.startVoice(m.frequency, m.pan);
      this.voiceOn = true;
    } else {
      this.voice.updateVoice(m.frequency, m.pan);
    }
    this.voice.duckVoice(false);
    this.emit({
      type: 'segment',
      index: this.logicalIndexOf(index),
      total: this.segmentStarts.length,
    });
    this.emit({
      type: 'position',
      x: leg.from.x,
      y: leg.from.y,
      pan: m.pan,
      midi: m.midi,
      legIndex: index,
    });
  }

  private tick(): void {
    if (this.status !== 'playing') return;
    const now = performance.now();

    if (this.phase === 'gap') {
      if (now >= this.gapEnd) {
        const next = this.gapNext;
        this.gapNext = null;
        this.phase = 'idle';
        next?.();
      }
      return;
    }
    if (this.phase !== 'leg' || !this.plan) return;

    const leg = this.plan.legs[this.legIndex];
    const p = Math.min(1, (now - this.legStart) / this.legDuration);
    const x = leg.from.x + (leg.to.x - leg.from.x) * p;
    const y = leg.from.y + (leg.to.y - leg.from.y) * p;
    const s = this.getSettings();
    const m = mapPosition(x, y, this.pitchFor(leg));
    this.voice.updateVoice(m.frequency, m.pan);
    this.emit({ type: 'position', x, y, pan: m.pan, midi: m.midi, legIndex: this.legIndex });

    if (s.intersectionCueEnabled) {
      const marks = this.legIntersections[this.legIndex] ?? [];
      marks.forEach((mark, mi) => {
        const key = `${this.legIndex}:${mi}`;
        if (mark.t <= p && !this.fired.has(key)) {
          this.fired.add(key);
          this.cues.play('intersection', xToPan(mark.x));
          this.emit({ type: 'intersection', x: mark.x, y: mark.y });
        }
      });
    }

    if (p >= 1) this.completeLeg();
  }

  private legIsLastOfPath(index: number): boolean {
    const legs = this.plan!.legs;
    return index === legs.length - 1 || legs[index + 1].pathIndex !== legs[index].pathIndex;
  }

  private completeLeg(): void {
    if (!this.plan) return;
    const legs = this.plan.legs;
    const leg = legs[this.legIndex];
    const s = this.getSettings();
    const lastOfPath = this.legIsLastOfPath(this.legIndex);
    const path = this.plan.paths[leg.pathIndex];
    const junctionPan = xToPan(leg.to.x);

    if (this.mode === 'single') {
      // 平滑曲线的采样点不是真正的顶点：同一条逻辑边继续播放到底
      if (!lastOfPath && leg.to.cue === false) {
        this.enterLeg(this.legIndex + 1);
        return;
      }
      if (!lastOfPath) {
        if (s.vertexCueEnabled && leg.to.cue !== false) {
          this.cues.play('vertex', junctionPan);
          this.emit({ type: 'vertex', pointId: leg.to.id, x: leg.to.x, y: leg.to.y });
        }
      } else if (path.closed) {
        if (s.closureCueEnabled) {
          this.cues.play('closure', junctionPan);
          this.emit({ type: 'closure' });
        }
      } else {
        this.cues.play('end', junctionPan);
      }
      this.voice.stopVoice();
      this.voiceOn = false;
      this.emit({ type: 'end' });
      this.setStatus('stopped');
      this.stopTicker();
      return;
    }

    // 连续播放模式
    if (!lastOfPath) {
      const junction = leg.to;
      if (s.vertexCueEnabled && junction.cue !== false) {
        this.voice.duckVoice(true);
        this.cues.play('vertex', junctionPan);
        this.emit({ type: 'vertex', pointId: junction.id, x: junction.x, y: junction.y });
        const pauseMs = Math.max(0, Math.min(500, s.vertexPauseMs));
        if (pauseMs > 0) {
          this.enterGap(pauseMs, () => this.enterLeg(this.legIndex + 1));
        } else {
          this.enterLeg(this.legIndex + 1);
        }
      } else {
        this.enterLeg(this.legIndex + 1);
      }
      return;
    }

    // 当前路径结束
    if (path.closed) {
      if (s.closureCueEnabled) {
        this.cues.play('closure', junctionPan);
      }
      this.emit({ type: 'closure' });
    }

    const isLastLeg = this.legIndex === legs.length - 1;
    if (!isLastLeg) {
      // 还有下一条路径（例如十字的第二条线）
      this.voice.stopVoice(80);
      this.voiceOn = false;
      const nextIndex = this.legIndex + 1;
      const nextPathIndex = legs[nextIndex].pathIndex;
      this.enterGap(PATH_GAP_MS, () => {
        this.emit({
          type: 'pathStart',
          pathIndex: nextPathIndex,
          pathCount: this.plan!.paths.length,
        });
        this.enterLeg(nextIndex);
      });
      return;
    }

    this.finishPlayback(path.closed);
  }

  private finishPlayback(lastPathClosed: boolean): void {
    const legs = this.plan!.legs;
    const lastPoint = legs[legs.length - 1].to;
    this.voice.stopVoice();
    this.voiceOn = false;
    if (!lastPathClosed) {
      this.cues.play('end', xToPan(lastPoint.x));
    }
    this.emit({ type: 'end' });

    const s = this.getSettings();
    if (s.loopEnabled) {
      this.enterGap(LOOP_GAP_MS, () => {
        this.fired.clear();
        const first = legs[0].from;
        this.cues.play('start', xToPan(first.x));
        this.enterGap(START_DELAY_MS, () => {
          this.emit({ type: 'pathStart', pathIndex: 0, pathCount: this.plan!.paths.length });
          this.enterLeg(0);
        });
      });
    } else {
      this.setStatus('stopped');
      this.stopTicker();
    }
  }
}
