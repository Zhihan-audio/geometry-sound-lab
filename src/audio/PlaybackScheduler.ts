// Playback scheduler: moves a single-voice sound point along the shape outline, handling vertex pauses, intersection pulses, closure cues and looping
import type { GeometryShape, PlaybackDirection } from '../geometry/geometryTypes';
import { buildTraversal, type TraversalLeg, type TraversalPlan } from '../geometry/traversal';
import { findIntersections } from '../geometry/intersections';
import { projectPointToSegment } from '../geometry/nearestPoint';
import { segmentLength } from '../geometry/slopeAnalysis';
import { mapPosition, xToPan, type PitchSettings } from './SonificationMapper';
import type { CueType } from './CueSoundEngine';

export const BASE_MS_PER_UNIT = 3000; // base playback time for one unit distance (1.0)
export const MIN_LEG_MS = 300;
export const MAX_LEG_MS = 8000;
export const START_DELAY_MS = 350;
export const PATH_GAP_MS = 500;
export const LOOP_GAP_MS = 800;
export const POINT_HOLD_MS = 1200;

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'stopped';

export interface SchedulerSettings {
  speed: number; // speed multiplier, 1 = normal
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

/** Main voice interface (lets tests inject stub objects) */
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

  /** Load a shape (stops current playback). direction overrides the shape's default playback direction */
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

    // Precompute each leg's intersection parameter positions (only mid-leg intersections fire; endpoint intersections are handled as vertices)
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

    // Smooth curves: the whole path's total length is used to apportion duration
    this.pathLengths = this.plan.paths.map((_, pathIdx) =>
      this.plan!.legs.filter((l) => l.pathIndex === pathIdx).reduce(
        (sum, l) => sum + segmentLength(l.from, l.to),
        0,
      ),
    );

    this.computeSegmentStarts();
    this.emit({ type: 'segment', index: 0, total: this.segmentStarts.length });
  }

  // ---------- Logical edges: smooth-curve sample joints (cue===false) are not boundaries ----------
  // A circle / a sine curve = one logical edge; each polygon side still counts as one.
  // Segment mode plays and navigates by logical edge, and the UI counts logical edges too.

  private computeSegmentStarts(): void {
    const legs = this.plan?.legs ?? [];
    this.segmentStarts = [];
    for (let i = 0; i < legs.length; i++) {
      // A new logical edge starts at: the first leg, a path change, or a joint that is a real vertex
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

  /** Info about the current logical edge (for UI display and spoken descriptions) */
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

  /** Continuous outline playback */
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

  /** Single point: start cue → sustained tone → end cue */
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

  /** Segment learning: play one specified edge */
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
    // Align to the logical edge's start: a smooth curve plays from the head of the whole curve
    this.enterLeg(this.segmentStartOf(clamped));
    this.startTicker();
  }

  /** Returns false when already at the boundary (moves by logical edge) */
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
   * Smooth-curve legs force a continuous glide: scale quantization would chop an arc's
   * continuous pitch into stair steps (sounding "stuck", "piece by piece") and ruin the
   * curve's geometric identity. Straight lines and polygon edges still quantize per the
   * user's settings. Curve sample points are marked with cue === false.
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
      // Smooth curves: clamp the whole path's time, then apportion by length ratio
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
      // Smooth-curve sample points are not real vertices: keep playing the same logical edge to its end
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

    // Continuous playback mode
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

    // Current path finished
    if (path.closed) {
      if (s.closureCueEnabled) {
        this.cues.play('closure', junctionPan);
      }
      this.emit({ type: 'closure' });
    }

    const isLastLeg = this.legIndex === legs.length - 1;
    if (!isLastLeg) {
      // Another path remains (e.g. the second line of a cross)
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
