import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicalTheme } from './models';
import { REST } from './models';
import {
  buildCompositionPlan,
  CompositionPerformer,
  type CompositionEvent,
  type InstrumentLike,
} from './CompositionEngine';
import type { NoteOpts } from './LiveInstrument';

const THEME: MusicalTheme = {
  pitches: [48, 51, 55, 60, 67, 60, 55, 50, 48],
  durations: [0.5, 0.5, 0.5, 1, 1, 0.5, 0.5, 0.5, 1],
  velocities: [0.6, 0.65, 0.7, 0.8, 0.9, 0.7, 0.65, 0.6, 0.6],
  accents: [false, false, true, false, true, false, true, false, false],
  contour: [1, 1, 1, 1, -1, -1, -1, -1],
  geometryType: 'triangle-like',
  seed: 987654321,
  scale: 'dorian',
  tonicMidi: 48,
  bpm: 88,
  closed: true,
};

describe('作品结构计划', () => {
  it('七个段落按 INTRO→THEME→A→B→DEV→RETURN→CODA 排列', () => {
    const plan = buildCompositionPlan(THEME);
    expect(plan.sections.map((s) => s.section)).toEqual([
      'intro',
      'theme',
      'variationA',
      'variationB',
      'development',
      'return',
      'coda',
    ]);
    // 段落时间轴单调递增
    for (let i = 1; i < plan.sections.length; i++) {
      expect(plan.sections[i].startBeat).toBeGreaterThan(plan.sections[i - 1].startBeat);
    }
  });

  it('总时长在 30–60 秒之间', () => {
    const plan = buildCompositionPlan(THEME);
    expect(plan.totalSeconds).toBeGreaterThanOrEqual(30);
    expect(plan.totalSeconds).toBeLessThanOrEqual(60);
  });

  it('THEME 段落逐音等于原始主题', () => {
    const plan = buildCompositionPlan(THEME);
    const themeSection = plan.sections.find((s) => s.section === 'theme')!;
    const notes = THEME.pitches.filter((p) => p !== REST);
    expect(themeSection.notes.map((n) => n.midi)).toEqual(notes);
  });

  it('RETURN 段落音高与主题一致但更柔和（听众重新认出几何）', () => {
    const plan = buildCompositionPlan(THEME);
    const theme = plan.sections.find((s) => s.section === 'theme')!;
    const ret = plan.sections.find((s) => s.section === 'return')!;
    expect(ret.notes.map((n) => n.midi)).toEqual(theme.notes.map((n) => n.midi));
    const avg = (ns: { vel: number }[]) => ns.reduce((a, n) => a + n.vel, 0) / ns.length;
    expect(avg(ret.notes)).toBeLessThan(avg(theme.notes));
  });

  it('INTRO 与 CODA 有主音持续低音，其他段落没有', () => {
    const plan = buildCompositionPlan(THEME);
    for (const s of plan.sections) {
      expect(s.drone).toBe(s.section === 'intro' || s.section === 'coda');
    }
  });

  it('CODA 以主和弦解决收束', () => {
    const plan = buildCompositionPlan(THEME);
    const coda = plan.sections.find((s) => s.section === 'coda')!;
    const finalNotes = coda.notes.filter((n) => n.beat >= 3).map((n) => n.midi);
    expect(finalNotes).toContain(THEME.tonicMidi);
    expect(finalNotes).toContain(THEME.tonicMidi + 7);
    expect(finalNotes).toContain(THEME.tonicMidi + plan.third);
  });

  it('确定性：同一主题两次生成完全相同的计划', () => {
    const a = buildCompositionPlan(THEME);
    const b = buildCompositionPlan(THEME);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('DEVELOPMENT 密度最高且被限制在安全长度内', () => {
    const plan = buildCompositionPlan(THEME);
    const dev = plan.sections.find((s) => s.section === 'development')!;
    const counts = plan.sections.map((s) => s.notes.length);
    expect(dev.notes.length).toBe(Math.max(...counts));
    expect(dev.beats).toBeLessThanOrEqual(25);
  });

  it('声像保持克制（±0.5 内）', () => {
    const plan = buildCompositionPlan(THEME);
    for (const s of plan.sections) {
      for (const n of s.notes) {
        expect(Math.abs(n.pan)).toBeLessThanOrEqual(0.5);
      }
    }
  });
});

describe('作品演出调度', () => {
  class StubInstrument implements InstrumentLike {
    scheduled: NoteOpts[] = [];
    droneStarts = 0;
    droneStops = 0;
    cancelled = 0;
    now() {
      return 0;
    }
    scheduleNote(o: NoteOpts) {
      this.scheduled.push(o);
    }
    startDrone() {
      this.droneStarts++;
    }
    stopDrone() {
      this.droneStops++;
    }
    cancelScheduled() {
      this.cancelled++;
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('play 一次性调度所有音符，段落事件按顺序触发，最后 finished', () => {
    const inst = new StubInstrument();
    const perf = new CompositionPerformer(inst);
    const events: CompositionEvent[] = [];
    perf.subscribe((e) => events.push(e));
    const plan = buildCompositionPlan(THEME);
    perf.play(plan);

    const totalNotes = plan.sections.reduce((a, s) => a + s.notes.length, 0);
    expect(inst.scheduled.length).toBe(totalNotes);
    expect(perf.isPlaying).toBe(true);

    vi.advanceTimersByTime(70000);
    const sectionEvents = events.filter((e) => e.type === 'section');
    expect(sectionEvents.map((e) => (e.type === 'section' ? e.section : ''))).toEqual([
      'intro',
      'theme',
      'variationA',
      'variationB',
      'development',
      'return',
      'coda',
    ]);
    expect(events[events.length - 1].type).toBe('finished');
    expect(perf.isPlaying).toBe(false);
    expect(inst.droneStarts).toBe(2); // intro + coda
  });

  it('stop 取消调度并广播 stopped', () => {
    const inst = new StubInstrument();
    const perf = new CompositionPerformer(inst);
    const events: CompositionEvent[] = [];
    perf.subscribe((e) => events.push(e));
    perf.play(buildCompositionPlan(THEME));
    vi.advanceTimersByTime(3000);
    perf.stop();
    expect(inst.cancelled).toBe(1);
    expect(perf.isPlaying).toBe(false);
    expect(events.some((e) => e.type === 'stopped')).toBe(true);
    // 停止后不再有事件
    const count = events.length;
    vi.advanceTimersByTime(70000);
    expect(events.length).toBe(count);
  });
});
