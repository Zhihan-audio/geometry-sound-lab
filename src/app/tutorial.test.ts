import { describe, expect, it } from 'vitest';
import {
  TutorialController,
  TUTORIAL_STEPS,
  type SpeakerLike,
  type TutorialEngineLike,
  type TutorialStep,
  type TutorialUiEvent,
} from './tutorial';

function stubEngine() {
  const cuesPlayed: string[] = [];
  const listeners = new Set<(e: { type: string; status?: string }) => void>();
  const engine: TutorialEngineLike = {
    audio: {
      startVoice() {},
      stopVoice() {},
    },
    cues: {
      play(type) {
        cuesPlayed.push(type);
      },
    },
    scheduler: {
      load() {},
      playAll() {},
      stop() {},
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
  };
  return {
    engine,
    cuesPlayed,
    emitSchedulerEvent(e: { type: string; status?: string }) {
      for (const fn of [...listeners]) fn(e);
    },
  };
}

function stubSpeaker(spoken: string[]): SpeakerLike {
  return {
    speak(text) {
      spoken.push(text);
      return Promise.resolve();
    },
    cancel() {},
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const bi = (en: string) => ({ en, zh: en });

const MINI_STEPS: TutorialStep[] = [
  { id: 's1', title: bi('One'), narration: bi('Step one. Press N.') },
  {
    id: 's2',
    title: bi('Two'),
    narration: bi('Try the arrow.'),
    task: { type: 'key', keys: ['ArrowRight'], label: bi('Press the Right Arrow') },
  },
  { id: 's3', title: bi('Three'), narration: bi('All done. Press N to finish.') },
];

describe('教学步骤数据', () => {
  it('步骤 id 唯一且叙述完整', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TUTORIAL_STEPS.length).toBeGreaterThanOrEqual(10);
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.en.length).toBeGreaterThan(0);
      expect(step.title.zh.length).toBeGreaterThan(0);
      expect(step.narration.en.length).toBeGreaterThan(20);
      expect(step.narration.zh.length).toBeGreaterThan(10);
    }
  });

  it('任务定义有效', () => {
    for (const step of TUTORIAL_STEPS) {
      if (!step.task) continue;
      expect(['key', 'playback-finished', 'mode']).toContain(step.task.type);
      expect(step.task.label.en.length).toBeGreaterThan(0);
      expect(step.task.label.zh.length).toBeGreaterThan(0);
      if (step.task.type === 'key') {
        expect(step.task.keys.length).toBeGreaterThan(0);
      }
    }
  });

  it('第一步是欢迎步骤且没有任务', () => {
    expect(TUTORIAL_STEPS[0].task).toBeUndefined();
    expect(TUTORIAL_STEPS[0].demo).toBeUndefined();
  });

  it('包含三种任务类型（按键、播放完成、模式切换）', () => {
    const types = TUTORIAL_STEPS.filter((s) => s.task).map((s) => s.task!.type);
    expect(types).toContain('key');
    expect(types).toContain('playback-finished');
    expect(types).toContain('mode');
  });
});

describe('教学控制器', () => {
  it('start 后朗读第一步', async () => {
    const { engine } = stubEngine();
    const spoken: string[] = [];
    const c = new TutorialController(engine, { steps: MINI_STEPS, speaker: stubSpeaker(spoken) });
    c.start('continuous');
    await tick();
    expect(c.isActive).toBe(true);
    expect(spoken[0]).toContain('Step one');
    expect(c.snapshot().index).toBe(0);
    expect(c.snapshot().phase).toBe('idle-wait');
  });

  it('N 前进、P 后退、H 重复，且这些键被消费', async () => {
    const { engine } = stubEngine();
    const spoken: string[] = [];
    const c = new TutorialController(engine, { steps: MINI_STEPS, speaker: stubSpeaker(spoken) });
    c.start('continuous');
    await tick();

    expect(c.handleKey({ key: 'n' }, { exploring: false, helpOpen: false })).toBe(true);
    await tick();
    expect(c.snapshot().index).toBe(1);

    expect(c.handleKey({ key: 'p' }, { exploring: false, helpOpen: false })).toBe(true);
    await tick();
    expect(c.snapshot().index).toBe(0);

    const before = spoken.length;
    expect(c.handleKey({ key: 'h' }, { exploring: false, helpOpen: false })).toBe(true);
    await tick();
    expect(spoken.length).toBeGreaterThan(before);
  });

  it('任务按键完成任务：播放答对音、不消费按键', async () => {
    const { engine, cuesPlayed } = stubEngine();
    const c = new TutorialController(engine, { steps: MINI_STEPS, speaker: stubSpeaker([]) });
    c.start('continuous');
    await tick();
    c.next();
    await tick();
    expect(c.snapshot().phase).toBe('task');

    const consumed = c.handleKey({ key: 'ArrowRight' }, { exploring: false, helpOpen: false });
    expect(consumed).toBe(false); // 按键必须继续传给应用
    expect(c.snapshot().taskDone).toBe(true);
    expect(cuesPlayed).toContain('correct');
  });

  it('播放完成类任务由调度器 end 事件完成', async () => {
    const steps: TutorialStep[] = [
      {
        id: 'p1',
        title: bi('Play'),
        narration: bi('Press space to play the shape now.'),
        task: { type: 'playback-finished', label: bi('Play it') },
      },
    ];
    const { engine, emitSchedulerEvent } = stubEngine();
    const c = new TutorialController(engine, { steps, speaker: stubSpeaker([]) });
    c.start('continuous');
    await tick();
    expect(c.snapshot().phase).toBe('task');
    emitSchedulerEvent({ type: 'end' });
    expect(c.snapshot().taskDone).toBe(true);
  });

  it('模式切换任务由 notifyMode 完成；已在目标模式时立即完成', async () => {
    const steps: TutorialStep[] = [
      {
        id: 'm1',
        title: bi('Explore'),
        narration: bi('Press E to explore the shape now.'),
        task: { type: 'mode', mode: 'exploration', label: bi('Press E') },
      },
    ];
    const { engine } = stubEngine();
    const c = new TutorialController(engine, { steps, speaker: stubSpeaker([]) });
    c.start('continuous');
    await tick();
    expect(c.snapshot().taskDone).toBe(false);
    c.notifyMode('exploration');
    expect(c.snapshot().taskDone).toBe(true);

    // 已处于探索模式时进入该步骤 → 立即完成
    const c2 = new TutorialController(engine, { steps, speaker: stubSpeaker([]) });
    c2.start('exploration');
    await tick();
    expect(c2.snapshot().taskDone).toBe(true);
  });

  it('最后一步按 N 结束并广播 finished', async () => {
    const { engine, cuesPlayed } = stubEngine();
    const events: TutorialUiEvent[] = [];
    const c = new TutorialController(engine, { steps: MINI_STEPS, speaker: stubSpeaker([]) });
    c.subscribe((e) => events.push(e));
    c.start('continuous');
    await tick();
    c.next();
    await tick();
    c.next();
    await tick();
    c.next(); // 最后一步 → finish
    await tick();
    expect(c.isActive).toBe(false);
    expect(events.some((e) => e.type === 'finished')).toBe(true);
    expect(cuesPlayed).toContain('correct');
  });

  it('Escape 退出导览；探索模式或帮助打开时让位给应用', async () => {
    const { engine } = stubEngine();
    const events: TutorialUiEvent[] = [];
    const c = new TutorialController(engine, { steps: MINI_STEPS, speaker: stubSpeaker([]) });
    c.subscribe((e) => events.push(e));
    c.start('continuous');
    await tick();

    expect(c.handleKey({ key: 'Escape' }, { exploring: true, helpOpen: false })).toBe(false);
    expect(c.isActive).toBe(true);
    expect(c.handleKey({ key: 'Escape' }, { exploring: false, helpOpen: true })).toBe(false);
    expect(c.isActive).toBe(true);

    expect(c.handleKey({ key: 'Escape' }, { exploring: false, helpOpen: false })).toBe(true);
    expect(c.isActive).toBe(false);
    expect(events.some((e) => e.type === 'exited')).toBe(true);
  });

  it('未激活时不消费任何按键', () => {
    const { engine } = stubEngine();
    const c = new TutorialController(engine, { steps: MINI_STEPS, speaker: stubSpeaker([]) });
    expect(c.handleKey({ key: 'n' }, { exploring: false, helpOpen: false })).toBe(false);
  });
});
