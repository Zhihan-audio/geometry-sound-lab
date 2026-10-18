import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { PlaybackScheduler, type SchedulerEvent, type SchedulerSettings } from './PlaybackScheduler';
import type { GeometryShape } from '../geometry/geometryTypes';
import type { CueType } from './CueSoundEngine';

// 桩：记录调用，不产生真实声音
class StubVoice {
  calls: string[] = [];
  startVoice() {
    this.calls.push('start');
  }
  updateVoice() {
    // 高频调用，不记录
  }
  duckVoice() {
    // 忽略
  }
  stopVoice() {
    this.calls.push('stop');
  }
}

class StubCues {
  played: CueType[] = [];
  play(type: CueType) {
    this.played.push(type);
  }
}

function makeSettings(overrides: Partial<SchedulerSettings> = {}): () => SchedulerSettings {
  const base: SchedulerSettings = {
    speed: 1,
    vertexPauseMs: 150,
    vertexCueEnabled: true,
    intersectionCueEnabled: true,
    closureCueEnabled: true,
    loopEnabled: false,
    pitch: { minMidi: 48, maxMidi: 84, pitchMode: 'continuous', scale: 'major' },
  };
  return () => ({ ...base, ...overrides });
}

/** 逆时针作图的正方形，边长 0.6 */
function square(): GeometryShape {
  return {
    id: 'sq',
    name: '正方形',
    type: 'polygon',
    points: [
      { id: 'bl', x: 0.2, y: 0.2 },
      { id: 'br', x: 0.8, y: 0.2 },
      { id: 'tr', x: 0.8, y: 0.8 },
      { id: 'tl', x: 0.2, y: 0.8 },
    ],
    segments: [
      { id: 's0', startPointId: 'bl', endPointId: 'br', order: 0 },
      { id: 's1', startPointId: 'br', endPointId: 'tr', order: 1 },
      { id: 's2', startPointId: 'tr', endPointId: 'tl', order: 2 },
      { id: 's3', startPointId: 'tl', endPointId: 'bl', order: 3 },
    ],
    closed: true,
    playbackDirection: 'clockwise',
  };
}

function horizontalLine(): GeometryShape {
  return {
    id: 'h',
    name: '水平线',
    type: 'line',
    points: [
      { id: 'a', x: 0.1, y: 0.5 },
      { id: 'b', x: 0.9, y: 0.5 },
    ],
    segments: [{ id: 's', startPointId: 'a', endPointId: 'b', order: 0 }],
    closed: false,
    playbackDirection: 'forward',
  };
}

describe('播放调度器', () => {
  let voice: StubVoice;
  let cues: StubCues;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'],
    });
    voice = new StubVoice();
    cues = new StubCues();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('水平线：开始音 + 结束音，无顶点音、无闭合音', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings());
    scheduler.load(horizontalLine());
    scheduler.playAll();
    vi.advanceTimersByTime(6000);
    expect(cues.played.filter((c) => c === 'start')).toHaveLength(1);
    expect(cues.played.filter((c) => c === 'end')).toHaveLength(1);
    expect(cues.played.filter((c) => c === 'vertex')).toHaveLength(0);
    expect(cues.played.filter((c) => c === 'closure')).toHaveLength(0);
    expect(scheduler.playbackStatus).toBe('stopped');
  });

  it('正方形：每个顶点只触发一次提示，闭合提示只在回到起点时触发一次', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings());
    const events: SchedulerEvent[] = [];
    scheduler.subscribe((e) => events.push(e));
    scheduler.load(square());
    scheduler.playAll();
    vi.advanceTimersByTime(20000);

    // 4 条边、3 个中途顶点、1 次闭合
    expect(cues.played.filter((c) => c === 'vertex')).toHaveLength(3);
    expect(cues.played.filter((c) => c === 'closure')).toHaveLength(1);
    expect(cues.played.filter((c) => c === 'end')).toHaveLength(0); // 闭合图形不播普通结束音

    const vertexEvents = events.filter((e) => e.type === 'vertex');
    expect(vertexEvents).toHaveLength(3);
    const pointIds = vertexEvents.map((e) => (e.type === 'vertex' ? e.pointId : ''));
    expect(new Set(pointIds).size).toBe(3); // 每个顶点只触发一次

    // 闭合事件在所有顶点事件之后
    const closureIdx = events.findIndex((e) => e.type === 'closure');
    const lastVertexIdx = events.map((e) => e.type).lastIndexOf('vertex');
    expect(closureIdx).toBeGreaterThan(lastVertexIdx);
    expect(scheduler.playbackStatus).toBe('stopped');
  });

  it('关闭顶点提示后不播放顶点音也不停顿', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings({ vertexCueEnabled: false }));
    scheduler.load(square());
    scheduler.playAll();
    vi.advanceTimersByTime(20000);
    expect(cues.played.filter((c) => c === 'vertex')).toHaveLength(0);
    expect(cues.played.filter((c) => c === 'closure')).toHaveLength(1);
  });

  it('十字图形：两条线路依次播放，中途触发交点提示', () => {
    const cross: GeometryShape = {
      id: 'cross',
      name: '十字',
      type: 'multiline',
      points: [
        { id: 'h1', x: 0.15, y: 0.5 },
        { id: 'h2', x: 0.85, y: 0.5 },
        { id: 'v1', x: 0.5, y: 0.15 },
        { id: 'v2', x: 0.5, y: 0.85 },
      ],
      segments: [
        { id: 'sh', startPointId: 'h1', endPointId: 'h2', order: 0 },
        { id: 'sv', startPointId: 'v1', endPointId: 'v2', order: 1 },
      ],
      closed: false,
      playbackDirection: 'forward',
    };
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings());
    const events: SchedulerEvent[] = [];
    scheduler.subscribe((e) => events.push(e));
    scheduler.load(cross);
    scheduler.playAll();
    vi.advanceTimersByTime(15000);

    // 每条线经过中心各触发一次交点脉冲
    expect(cues.played.filter((c) => c === 'intersection')).toHaveLength(2);
    const pathStarts = events.filter((e) => e.type === 'pathStart');
    expect(pathStarts).toHaveLength(2);
    expect(cues.played.filter((c) => c === 'end')).toHaveLength(1);
  });

  it('暂停期间不推进，恢复后完成播放', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings());
    scheduler.load(horizontalLine());
    scheduler.playAll();
    vi.advanceTimersByTime(1000); // 进入第一条腿
    scheduler.pause();
    const snapshot = cues.played.length;
    vi.advanceTimersByTime(8000);
    expect(cues.played.length).toBe(snapshot); // 暂停期间无新提示音
    expect(scheduler.playbackStatus).toBe('paused');
    scheduler.resume();
    vi.advanceTimersByTime(8000);
    expect(scheduler.playbackStatus).toBe('stopped');
    expect(cues.played.filter((c) => c === 'end')).toHaveLength(1);
  });

  it('分段模式：一次只播放一条边', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings());
    scheduler.load(square());
    scheduler.playSegmentAt(0);
    vi.advanceTimersByTime(10000);
    // 只有一条边：一个顶点提示（该边终点），没有闭合提示
    expect(cues.played.filter((c) => c === 'vertex')).toHaveLength(1);
    expect(cues.played.filter((c) => c === 'closure')).toHaveLength(0);
    expect(scheduler.playbackStatus).toBe('stopped');
    expect(scheduler.currentLegIndex).toBe(0);
  });

  it('循环播放：播放结束后自动重新开始', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings({ loopEnabled: true }));
    scheduler.load(horizontalLine());
    scheduler.playAll();
    // 一轮约 350 + 2400 = 2750ms，循环间隔 800ms
    vi.advanceTimersByTime(9000);
    expect(cues.played.filter((c) => c === 'start').length).toBeGreaterThanOrEqual(2);
    expect(scheduler.playbackStatus).toBe('playing');
    scheduler.stop();
    expect(scheduler.playbackStatus).toBe('stopped');
  });
});

/** 平滑弧线：两端是真顶点，中间是 cue:false 采样点（共 4 条腿） */
function smoothArc(): GeometryShape {
  return {
    id: 'arc',
    name: '弧线',
    type: 'curve',
    smooth: true,
    points: [
      { id: 'p0', x: 0.1, y: 0.2 },
      { id: 'p1', x: 0.3, y: 0.5, cue: false },
      { id: 'p2', x: 0.5, y: 0.6, cue: false },
      { id: 'p3', x: 0.7, y: 0.5, cue: false },
      { id: 'p4', x: 0.9, y: 0.2 },
    ],
    segments: [
      { id: 's0', startPointId: 'p0', endPointId: 'p1', order: 0 },
      { id: 's1', startPointId: 'p1', endPointId: 'p2', order: 1 },
      { id: 's2', startPointId: 'p2', endPointId: 'p3', order: 2 },
      { id: 's3', startPointId: 'p3', endPointId: 'p4', order: 3 },
    ],
    closed: false,
    playbackDirection: 'forward',
  };
}

describe('逻辑边：平滑曲线在逐边模式下整段播放', () => {
  let voice: StubVoice;
  let cues: StubCues;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'],
    });
    voice = new StubVoice();
    cues = new StubCues();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('平滑曲线整段算一条逻辑边，一次播到结尾不中途自停', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings());
    const events: SchedulerEvent[] = [];
    scheduler.subscribe((e) => events.push(e));
    scheduler.load(smoothArc());
    scheduler.playSegmentAt(0);
    vi.advanceTimersByTime(30000);

    expect(scheduler.playbackStatus).toBe('stopped');
    expect(scheduler.currentLegIndex).toBe(3); // 停在最后一条采样腿，而非第一段
    const segEvents = events.filter((e) => e.type === 'segment');
    expect(segEvents.length).toBeGreaterThan(0);
    expect(segEvents.every((e) => e.type === 'segment' && e.total === 1)).toBe(true);
    expect(cues.played.filter((c) => c === 'vertex')).toHaveLength(0); // 采样点不敲顶点音
    expect(cues.played.filter((c) => c === 'end')).toHaveLength(1);
    expect(scheduler.nextSegment()).toBe(false); // 整条曲线就是最后一条逻辑边
  });

  it('正方形仍是四条逻辑边，可继续切到下一条', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings());
    const events: SchedulerEvent[] = [];
    scheduler.subscribe((e) => events.push(e));
    scheduler.load(square());
    scheduler.playSegmentAt(0);
    vi.advanceTimersByTime(10000);

    const segEvents = events.filter((e) => e.type === 'segment');
    expect(segEvents.some((e) => e.type === 'segment' && e.total === 4)).toBe(true);
    expect(scheduler.nextSegment()).toBe(true);
  });
});
