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

describe('tutorial step data', () => {
  it('step ids are unique and narration is complete', () => {
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

  it('task definitions are valid', () => {
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

  it('first step is a welcome step with no task', () => {
    expect(TUTORIAL_STEPS[0].task).toBeUndefined();
    expect(TUTORIAL_STEPS[0].demo).toBeUndefined();
  });

  it('covers all three task types (key, playback-finished, mode switch)', () => {
    const types = TUTORIAL_STEPS.filter((s) => s.task).map((s) => s.task!.type);
    expect(types).toContain('key');
    expect(types).toContain('playback-finished');
    expect(types).toContain('mode');
  });
});

describe('tutorial controller', () => {
  it('speaks the first step after start', async () => {
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

  it('N advances, P goes back, H repeats, and these keys are consumed', async () => {
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

  it('task key completes the task: plays the correct cue, does not consume the key', async () => {
    const { engine, cuesPlayed } = stubEngine();
    const c = new TutorialController(engine, { steps: MINI_STEPS, speaker: stubSpeaker([]) });
    c.start('continuous');
    await tick();
    c.next();
    await tick();
    expect(c.snapshot().phase).toBe('task');

    const consumed = c.handleKey({ key: 'ArrowRight' }, { exploring: false, helpOpen: false });
    expect(consumed).toBe(false); // the key must still pass through to the app
    expect(c.snapshot().taskDone).toBe(true);
    expect(cuesPlayed).toContain('correct');
  });

  it('playback-finished tasks complete on the scheduler end event', async () => {
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

  it('mode tasks complete via notifyMode; complete immediately when already in the target mode', async () => {
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

    // Entering this step while already in exploration mode → completes immediately
    const c2 = new TutorialController(engine, { steps, speaker: stubSpeaker([]) });
    c2.start('exploration');
    await tick();
    expect(c2.snapshot().taskDone).toBe(true);
  });

  it('pressing N on the last step ends the tour and broadcasts finished', async () => {
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
    c.next(); // last step → finish
    await tick();
    expect(c.isActive).toBe(false);
    expect(events.some((e) => e.type === 'finished')).toBe(true);
    expect(cuesPlayed).toContain('correct');
  });

  it('Escape exits the tour; yields to the app while exploring or with help open', async () => {
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

  it('consumes no keys while inactive', () => {
    const { engine } = stubEngine();
    const c = new TutorialController(engine, { steps: MINI_STEPS, speaker: stubSpeaker([]) });
    expect(c.handleKey({ key: 'n' }, { exploring: false, helpOpen: false })).toBe(false);
  });
});
