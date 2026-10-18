import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { PlaybackScheduler, type SchedulerEvent, type SchedulerSettings } from './PlaybackScheduler';
import type { GeometryShape } from '../geometry/geometryTypes';
import type { CueType } from './CueSoundEngine';

// Stubs: record calls without producing real sound
class StubVoice {
  calls: string[] = [];
  startVoice() {
    this.calls.push('start');
  }
  updateVoice() {
    // called at high frequency, not recorded
  }
  duckVoice() {
    // ignored
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

/** Square drawn counterclockwise, side length 0.6 */
function square(): GeometryShape {
  return {
    id: 'sq',
    name: 'Square',
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
    name: 'Horizontal line',
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

describe('PlaybackScheduler', () => {
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

  it('horizontal line: start + end cues, no vertex or closure cues', () => {
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

  it('square: each vertex cues exactly once, closure cues once on returning to the start', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings());
    const events: SchedulerEvent[] = [];
    scheduler.subscribe((e) => events.push(e));
    scheduler.load(square());
    scheduler.playAll();
    vi.advanceTimersByTime(20000);

    // 4 edges, 3 mid-route vertices, 1 closure
    expect(cues.played.filter((c) => c === 'vertex')).toHaveLength(3);
    expect(cues.played.filter((c) => c === 'closure')).toHaveLength(1);
    expect(cues.played.filter((c) => c === 'end')).toHaveLength(0); // closed shapes skip the plain end cue

    const vertexEvents = events.filter((e) => e.type === 'vertex');
    expect(vertexEvents).toHaveLength(3);
    const pointIds = vertexEvents.map((e) => (e.type === 'vertex' ? e.pointId : ''));
    expect(new Set(pointIds).size).toBe(3); // each vertex fires only once

    // the closure event comes after all vertex events
    const closureIdx = events.findIndex((e) => e.type === 'closure');
    const lastVertexIdx = events.map((e) => e.type).lastIndexOf('vertex');
    expect(closureIdx).toBeGreaterThan(lastVertexIdx);
    expect(scheduler.playbackStatus).toBe('stopped');
  });

  it('with vertex cues disabled, plays no vertex sound and does not pause', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings({ vertexCueEnabled: false }));
    scheduler.load(square());
    scheduler.playAll();
    vi.advanceTimersByTime(20000);
    expect(cues.played.filter((c) => c === 'vertex')).toHaveLength(0);
    expect(cues.played.filter((c) => c === 'closure')).toHaveLength(1);
  });

  it('cross shape: two paths play in turn, intersection cues fire along the way', () => {
    const cross: GeometryShape = {
      id: 'cross',
      name: 'Cross',
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

    // each line fires one intersection pulse when passing the center
    expect(cues.played.filter((c) => c === 'intersection')).toHaveLength(2);
    const pathStarts = events.filter((e) => e.type === 'pathStart');
    expect(pathStarts).toHaveLength(2);
    expect(cues.played.filter((c) => c === 'end')).toHaveLength(1);
  });

  it('does not advance while paused, finishes playback after resume', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings());
    scheduler.load(horizontalLine());
    scheduler.playAll();
    vi.advanceTimersByTime(1000); // enter the first leg
    scheduler.pause();
    const snapshot = cues.played.length;
    vi.advanceTimersByTime(8000);
    expect(cues.played.length).toBe(snapshot); // no new cues while paused
    expect(scheduler.playbackStatus).toBe('paused');
    scheduler.resume();
    vi.advanceTimersByTime(8000);
    expect(scheduler.playbackStatus).toBe('stopped');
    expect(cues.played.filter((c) => c === 'end')).toHaveLength(1);
  });

  it('segment mode: plays only one edge at a time', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings());
    scheduler.load(square());
    scheduler.playSegmentAt(0);
    vi.advanceTimersByTime(10000);
    // just one edge: one vertex cue (at the edge's endpoint), no closure cue
    expect(cues.played.filter((c) => c === 'vertex')).toHaveLength(1);
    expect(cues.played.filter((c) => c === 'closure')).toHaveLength(0);
    expect(scheduler.playbackStatus).toBe('stopped');
    expect(scheduler.currentLegIndex).toBe(0);
  });

  it('loop playback: restarts automatically after finishing', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings({ loopEnabled: true }));
    scheduler.load(horizontalLine());
    scheduler.playAll();
    // one pass is about 350 + 2400 = 2750ms, loop gap 800ms
    vi.advanceTimersByTime(9000);
    expect(cues.played.filter((c) => c === 'start').length).toBeGreaterThanOrEqual(2);
    expect(scheduler.playbackStatus).toBe('playing');
    scheduler.stop();
    expect(scheduler.playbackStatus).toBe('stopped');
  });
});

/** Smooth arc: real vertices at both ends, cue:false sample points in between (4 legs total) */
function smoothArc(): GeometryShape {
  return {
    id: 'arc',
    name: 'Arc',
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

describe('logical edges: smooth curves play whole in segment mode', () => {
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

  it('a smooth curve counts as one logical edge, plays to the end without stopping midway', () => {
    const scheduler = new PlaybackScheduler(voice, cues, makeSettings());
    const events: SchedulerEvent[] = [];
    scheduler.subscribe((e) => events.push(e));
    scheduler.load(smoothArc());
    scheduler.playSegmentAt(0);
    vi.advanceTimersByTime(30000);

    expect(scheduler.playbackStatus).toBe('stopped');
    expect(scheduler.currentLegIndex).toBe(3); // stops on the last sample leg, not the first segment
    const segEvents = events.filter((e) => e.type === 'segment');
    expect(segEvents.length).toBeGreaterThan(0);
    expect(segEvents.every((e) => e.type === 'segment' && e.total === 1)).toBe(true);
    expect(cues.played.filter((c) => c === 'vertex')).toHaveLength(0); // sample points do not strike the vertex cue
    expect(cues.played.filter((c) => c === 'end')).toHaveLength(1);
    expect(scheduler.nextSegment()).toBe(false); // the whole curve is the last logical edge
  });

  it('a square is still four logical edges and can advance to the next one', () => {
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
