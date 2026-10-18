// Voice-guided tutorial: teaches students how the app turns shapes into sound.
// Speaks each step aloud (in the current UI language), plays real sound
// demonstrations, and waits for the student to try things themselves.
import type { GeometryShape } from '../geometry/geometryTypes';
import { getLibraryShape } from '../geometry/shapeLibrary';
import { mapPosition } from '../audio/SonificationMapper';
import type { CueType } from '../audio/CueSoundEngine';
import type { PlaybackMode } from '../state/store';
import { engineSettings } from './engine';
import { speech } from './speech';
import { tt, type Bi } from '../i18n';
import { saveTutorialDone } from '../state/persistence';

// ---------- Injectable dependencies (kept structural for easy testing) ----------

export interface TutorialEngineLike {
  audio: {
    startVoice(frequency: number, pan: number): void;
    stopVoice(fadeMs?: number): void;
  };
  cues: {
    play(type: CueType, pan?: number): void;
  };
  scheduler: {
    load(shape: GeometryShape): void;
    playAll(): void;
    stop(): void;
    subscribe(fn: (e: { type: string; status?: string }) => void): () => void;
  };
}

export interface SpeakerLike {
  speak(text: string): Promise<void>;
  cancel(): void;
}

/** Default speaker: routes through the central speech service (natural voice) */
export const speechSpeaker: SpeakerLike = {
  speak(text: string): Promise<void> {
    return speech.speak(text);
  },
  cancel(): void {
    speech.cancel();
  },
};

// ---------- Step definitions ----------

export interface DemoTools {
  /** Play a bare tone at a grid position (no cues) */
  tone(x: number, y: number, ms?: number): Promise<void>;
  /** Play a library shape through the real playback engine */
  shape(id: string): Promise<void>;
  cue(type: CueType): void;
  wait(ms: number): Promise<void>;
}

export type TutorialTask =
  | { type: 'key'; keys: string[]; label: Bi; praise?: Bi }
  | { type: 'playback-finished'; label: Bi; praise?: Bi }
  | { type: 'mode'; mode: PlaybackMode; label: Bi; praise?: Bi };

export interface TutorialStep {
  id: string;
  title: Bi;
  narration: Bi;
  demo?: (tools: DemoTools) => Promise<void>;
  afterDemo?: Bi;
  task?: TutorialTask;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: { en: 'Welcome!', zh: '欢迎！' },
    narration: {
      en:
        "Hi! Welcome to Geometry Sound Lab, where shapes turn into sound! I'm your voice guide. " +
        'You only need four keys for this tour: N goes to the next step, P goes back, ' +
        'H plays a step again, and Escape leaves the tour. ' +
        'One more thing to remember: outside the tour, the question mark key opens the full ' +
        'shortcut list, and the Up and Down arrows read it aloud. Ready? Press N to begin!',
      zh:
        '你好！欢迎来到几何声音实验室，在这里图形会变成声音！我是你的语音向导。' +
        '这次导览只需要四个键：按 N 进入下一步，按 P 返回上一步，按 H 重听本步，' +
        '按 Escape 随时离开导览。还要记住一件事：导览之外，按问号键可以打开完整的快捷键列表，' +
        '用上下方向键逐条朗读。准备好了吗？按 N 开始吧！',
    },
  },
  {
    id: 'pan',
    title: { en: 'Left and Right', zh: '左和右' },
    narration: {
      en:
        'Every point lives somewhere on a square grid. Points on the left side sound in your left ear. ' +
        'Points on the right side sound in your right ear. Listen to three notes: left, middle, right.',
      zh:
        '每个点都住在一个方形网格上。左边的点，声音在你的左耳响起；右边的点，声音在右耳。' +
        '听三个音：左边，中间，右边。',
    },
    demo: async (t) => {
      await t.tone(0.1, 0.5);
      await t.tone(0.5, 0.5);
      await t.tone(0.9, 0.5);
    },
    afterDemo: {
      en: 'That sideways feeling is called pan. Press N to continue.',
      zh: '这种左右的感觉叫做声像。按 N 继续。',
    },
  },
  {
    id: 'pitch',
    title: { en: 'Low and High', zh: '低和高' },
    narration: {
      en:
        'Up and down works with pitch. Low places make low, deep notes. ' +
        'High places make high, bright notes. Listen: bottom, middle, top.',
      zh: '上下靠的是音高。低处的音又低又沉，高处的音又高又亮。听：底部，中间，顶部。',
    },
    demo: async (t) => {
      await t.tone(0.5, 0.1);
      await t.tone(0.5, 0.5);
      await t.tone(0.5, 0.9);
    },
    afterDemo: {
      en: 'Just like singing up a ladder! Press N to continue.',
      zh: '就像顺着梯子往上唱歌一样！按 N 继续。',
    },
  },
  {
    id: 'line-flat',
    title: { en: 'A Moving Sound Is a Line', zh: '移动的声音是一条线' },
    narration: {
      en:
        'Here is the magic part. A line is a sound that moves! This is a flat, horizontal line: ' +
        'the sound slides from left to right, and the pitch stays exactly the same.',
      zh:
        '神奇的部分来了：一条线就是一个会移动的声音！这是一条水平线：' +
        '声音从左滑到右，音高保持不变。',
    },
    demo: (t) => t.shape('line-horizontal'),
    afterDemo: {
      en: 'Flat line, flat pitch. Press N to continue.',
      zh: '平平的线，平平的音高。按 N 继续。',
    },
  },
  {
    id: 'line-rising',
    title: { en: 'Uphill and Downhill', zh: '上坡和下坡' },
    narration: {
      en: 'Now a rising line. The sound slides right while the pitch climbs, like walking up a hill.',
      zh: '现在是一条上升的斜线。声音向右滑动，音高也跟着爬升，就像在爬山坡。',
    },
    demo: (t) => t.shape('line-rising'),
    afterDemo: {
      en:
        'If the pitch falls instead, the line goes downhill. Steep hills change pitch fast, ' +
        'gentle hills change it slowly. Press N to continue.',
      zh: '如果音高往下走，线就是下坡。陡坡音高变化快，缓坡变化慢。按 N 继续。',
    },
  },
  {
    id: 'try-space',
    title: { en: 'Your Turn to Play', zh: '轮到你播放' },
    narration: {
      en: 'Your turn to make sound! The Space bar plays the shape that is currently chosen in the library.',
      zh: '轮到你来制造声音啦！空格键会播放图形库里当前选中的图形。',
    },
    task: {
      type: 'playback-finished',
      label: {
        en: 'Press the Space bar and listen all the way to the end.',
        zh: '按下空格键，把图形完整听一遍。',
      },
    },
  },
  {
    id: 'corners',
    title: { en: 'Corners Click', zh: '顶点会咔哒' },
    narration: {
      en:
        'Shapes like triangles have corners. At every corner you hear a tiny click, and the sound ' +
        'takes a little breath. Listen to a triangle and count the clicks. There are three!',
      zh:
        '三角形这样的图形有顶点。每到一个顶点，你会听到轻轻的咔哒一声，声音还会稍微停顿。' +
        '听一个三角形，数数有几声咔哒——一共三声！',
    },
    demo: (t) => t.shape('poly-triangle'),
    afterDemo: {
      en:
        'And did you catch the three-note chime at the end? That chime means the shape closed: ' +
        'the sound came back home. Press N to continue.',
      zh: '结尾那三个上行音听到了吗？那是闭合提示音，表示声音回到了起点。按 N 继续。',
    },
  },
  {
    id: 'crossings',
    title: { en: 'Crossings Buzz', zh: '交点会脉冲' },
    narration: {
      en:
        'When two lines cross each other, you hear a quick double buzz at the crossing point. ' +
        'Listen to a plus sign made of two lines.',
      zh: '两条线相交的时候，交点处会响起快速的双重脉冲音。听一个由两条线组成的加号。',
    },
    demo: (t) => t.shape('line-cross'),
    afterDemo: {
      en: 'Each line played on its own, and buzzed while passing the middle. Press N to continue.',
      zh: '两条线各自播放，经过中间时都响了脉冲音。按 N 继续。',
    },
  },
  {
    id: 'edges',
    title: { en: 'One Edge at a Time', zh: '一次一条边' },
    narration: {
      en:
        'Want to study one side at a time? Use the arrow keys! The Right Arrow plays the next edge. ' +
        'The Left Arrow plays the edge before.',
      zh: '想一条边一条边地研究？用方向键！右方向键播放下一条边，左方向键播放上一条边。',
    },
    task: {
      type: 'key',
      keys: ['ArrowRight'],
      label: { en: 'Press the Right Arrow key to hear an edge.', zh: '按右方向键听一条边。' },
    },
  },
  {
    id: 'explore-enter',
    title: { en: 'Free Exploration', zh: '自由探索' },
    narration: {
      en:
        'Now for my favorite: free exploration! You move a little sound pointer around the grid ' +
        'with the arrow keys, and feel the shape with your ears.',
      zh: '接下来是我最喜欢的：自由探索！你可以用方向键移动一个声音指针，用耳朵去感受图形。',
    },
    task: {
      type: 'mode',
      mode: 'exploration',
      label: { en: 'Press the letter E to start exploring.', zh: '按字母 E 开始探索。' },
    },
  },
  {
    id: 'explore-move',
    title: { en: 'Feel Your Way', zh: '用耳朵找路' },
    narration: {
      en:
        'You are exploring! When you hear a clear tone, your pointer is on a line. When the tone ' +
        'fades to a soft whisper, you drifted off the line. Hold Shift with an arrow to move faster. ' +
        'Press Enter any time to ask where you are.',
      zh:
        '你正在探索！听到清晰的音，说明指针在线条上；声音变成轻轻的沙沙声，说明你离开了线条。' +
        '按住 Shift 加方向键可以走得更快。随时按 Enter 问：我在哪里。',
    },
    task: {
      type: 'key',
      keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
      label: { en: 'Try moving with any arrow key.', zh: '用任意方向键移动试试。' },
      praise: {
        en:
          'Beautiful moving! When you finish exploring, press Escape once to leave exploration mode. ' +
          'Now press N for the next step.',
        zh: '移动得真棒！探索结束后，按一次 Escape 退出探索模式。现在按 N 进入下一步。',
      },
    },
  },
  {
    id: 'helpers',
    title: { en: 'Helpful Keys', zh: '好用的按键' },
    narration: {
      en:
        'A few more helpers. Plus and minus change the speed. Zero mutes everything right away. ' +
        'The question mark opens the full list of shortcuts. On the screen, the shape library sits ' +
        'on the left, settings on the right, and the play buttons at the bottom. Press N for the final step.',
      zh:
        '再来几个小帮手：加号和减号改变速度，数字 0 立刻静音，问号打开完整快捷键列表。' +
        '屏幕上，图形库在左边，设置在右边，播放按钮在底部。按 N 进入最后一步。',
    },
  },
  {
    id: 'finish',
    title: { en: "You're Ready!", zh: '你准备好了！' },
    narration: {
      en:
        "That's the whole tour! Remember: left and right tells you where, low and high tells you " +
        'how tall, clicks are corners, buzzes are crossings, and the chime means the shape closed. ' +
        'Now pick a shape and start listening. Have fun, sound explorer! Press N to finish.',
      zh:
        '整个导览结束啦！记住：左右告诉你位置，高低告诉你多高，咔哒是顶点，脉冲是交点，' +
        '闭合音表示图形回到起点。现在去选一个图形开始听吧。祝你玩得开心，声音探险家！按 N 完成导览。',
    },
    demo: async (t) => {
      t.cue('closure');
      await t.wait(700);
    },
  },
];

// ---------- Controller ----------

export type TutorialPhase = 'speaking' | 'demo' | 'task' | 'idle-wait';

export interface TutorialSnapshot {
  active: boolean;
  index: number;
  total: number;
  step: TutorialStep | null;
  phase: TutorialPhase;
  taskDone: boolean;
}

export type TutorialUiEvent =
  | { type: 'update' }
  | { type: 'task-complete' }
  | { type: 'finished' }
  | { type: 'exited' };

const DEFAULT_PRAISE: Bi = { en: 'Well done! Press N to continue.', zh: '太棒了！按 N 继续。' };

export class TutorialController {
  private steps: TutorialStep[];
  private speaker: SpeakerLike;
  private stepIndex = 0;
  private active = false;
  private generation = 0;
  private phase: TutorialPhase = 'idle-wait';
  private taskDone = false;
  private lastMode: PlaybackMode = 'continuous';
  private schedUnsub: (() => void) | null = null;
  private abortFns = new Set<() => void>();
  private listeners = new Set<(e: TutorialUiEvent) => void>();
  /** Diagnostic trail of lifecycle transitions (kept small, aids debugging) */
  readonly lifecycleLog: string[] = [];

  constructor(
    private engine: TutorialEngineLike,
    options: { steps?: TutorialStep[]; speaker?: SpeakerLike } = {},
  ) {
    this.steps = options.steps ?? TUTORIAL_STEPS;
    this.speaker = options.speaker ?? speechSpeaker;
  }

  subscribe(fn: (e: TutorialUiEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: TutorialUiEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get isActive(): boolean {
    return this.active;
  }

  snapshot(): TutorialSnapshot {
    return {
      active: this.active,
      index: this.stepIndex,
      total: this.steps.length,
      step: this.active ? this.steps[this.stepIndex] : null,
      phase: this.phase,
      taskDone: this.taskDone,
    };
  }

  private log(entry: string): void {
    this.lifecycleLog.push(`${Date.now() % 100000} ${entry}`);
    if (this.lifecycleLog.length > 60) this.lifecycleLog.shift();
  }

  start(currentMode: PlaybackMode): void {
    this.log(`start mode=${currentMode}`);
    this.active = true;
    this.stepIndex = 0;
    this.lastMode = currentMode;
    this.schedUnsub?.();
    this.schedUnsub = this.engine.scheduler.subscribe((e) => {
      if (e.type === 'end') this.handleSchedulerEnd();
    });
    void this.runStep();
  }

  exit(): void {
    if (!this.active) return;
    this.log(
      `exit at step ${this.stepIndex}; caller: ${new Error().stack?.split('\n').slice(2, 5).join(' <- ').replace(/\s+at\s+/g, ' ') ?? '?'}`,
    );
    this.active = false;
    this.generation++;
    this.speaker.cancel();
    this.stopSounds();
    for (const fn of [...this.abortFns]) fn();
    this.abortFns.clear();
    this.schedUnsub?.();
    this.schedUnsub = null;
    this.emit({ type: 'exited' });
  }

  next(): void {
    if (!this.active) return;
    this.log(`next from ${this.stepIndex}`);
    if (this.stepIndex >= this.steps.length - 1) {
      this.finish();
      return;
    }
    this.stepIndex++;
    void this.runStep();
  }

  prev(): void {
    if (!this.active || this.stepIndex === 0) return;
    this.stepIndex--;
    void this.runStep();
  }

  repeat(): void {
    if (!this.active) return;
    void this.runStep();
  }

  private finish(): void {
    this.log(`finish at step ${this.stepIndex}`);
    this.engine.cues.play('correct');
    saveTutorialDone();
    this.active = false;
    this.generation++;
    this.speaker.cancel();
    this.stopSounds();
    this.schedUnsub?.();
    this.schedUnsub = null;
    this.emit({ type: 'finished' });
  }

  /**
   * Handle a key press. Returns true when the tour consumed the key
   * (the app should not also act on it).
   */
  handleKey(e: Pick<KeyboardEvent, 'key'>, ctx: { exploring: boolean; helpOpen: boolean }): boolean {
    if (!this.active) return false;
    const k = e.key.toLowerCase();
    if (k === 'n') {
      this.next();
      return true;
    }
    if (k === 'p') {
      this.prev();
      return true;
    }
    if (k === 'h') {
      this.repeat();
      return true;
    }
    if (e.key === 'Escape') {
      // Let the app close its dialog / exit exploration first; Escape exits the
      // tour only when nothing else needs it.
      if (ctx.helpOpen || ctx.exploring) return false;
      this.exit();
      return true;
    }
    // Task detection: never consume — the student's key must really do the thing
    const step = this.steps[this.stepIndex];
    if (this.phase === 'task' && step.task?.type === 'key' && step.task.keys.includes(e.key)) {
      this.completeTask();
    }
    return false;
  }

  notifyMode(mode: PlaybackMode): void {
    this.lastMode = mode;
    if (!this.active) return;
    const step = this.steps[this.stepIndex];
    if (this.phase === 'task' && step.task?.type === 'mode' && step.task.mode === mode) {
      this.completeTask();
    }
  }

  private handleSchedulerEnd(): void {
    const step = this.steps[this.stepIndex];
    if (this.phase === 'task' && step.task?.type === 'playback-finished') {
      this.completeTask();
    }
  }

  private completeTask(): void {
    if (this.phase !== 'task' || this.taskDone) return;
    const step = this.steps[this.stepIndex];
    this.taskDone = true;
    this.phase = 'idle-wait';
    this.engine.cues.play('correct');
    this.emit({ type: 'task-complete' });
    const gen = this.generation;
    // Give the student's own sound a moment before praising
    setTimeout(() => {
      if (gen === this.generation && this.active) {
        void this.speaker.speak(tt(step.task?.praise ?? DEFAULT_PRAISE));
      }
    }, 700);
  }

  private stopSounds(): void {
    this.engine.scheduler.stop();
    this.engine.audio.stopVoice();
  }

  private async runStep(): Promise<void> {
    const gen = ++this.generation;
    this.speaker.cancel();
    this.stopSounds();
    for (const fn of [...this.abortFns]) fn();
    this.abortFns.clear();

    const step = this.steps[this.stepIndex];
    this.taskDone = false;
    this.phase = 'speaking';
    this.emit({ type: 'update' });

    const stale = () => gen !== this.generation || !this.active;

    await this.speaker.speak(tt(step.narration));
    if (stale()) return;

    if (step.demo) {
      this.phase = 'demo';
      this.emit({ type: 'update' });
      await step.demo(this.makeTools(gen));
      if (stale()) return;
      if (step.afterDemo) {
        this.phase = 'speaking';
        this.emit({ type: 'update' });
        await this.speaker.speak(tt(step.afterDemo));
        if (stale()) return;
      }
    }

    if (step.task) {
      this.phase = 'task';
      this.emit({ type: 'update' });
      // A mode task may already be satisfied
      if (step.task.type === 'mode' && step.task.mode === this.lastMode) {
        this.completeTask();
        return;
      }
      await this.speaker.speak(tt(step.task.label));
      return;
    }

    this.phase = 'idle-wait';
    this.emit({ type: 'update' });
  }

  // ---------- Demo tools ----------

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          this.abortFns.delete(finish);
          resolve();
        }
      };
      const timer = setTimeout(finish, ms);
      this.abortFns.add(finish);
    });
  }

  private async playTone(x: number, y: number, ms: number): Promise<void> {
    const s = engineSettings.current;
    const m = mapPosition(x, y, {
      minMidi: s.minMidi,
      maxMidi: s.maxMidi,
      pitchMode: s.pitchMode,
      scale: s.selectedScale,
    });
    this.engine.audio.startVoice(m.frequency, m.pan);
    await this.wait(ms);
    this.engine.audio.stopVoice();
    await this.wait(220);
  }

  private playShape(shape: GeometryShape | undefined): Promise<void> {
    if (!shape) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          unsub();
          clearTimeout(timer);
          this.abortFns.delete(finish);
          resolve();
        }
      };
      const unsub = this.engine.scheduler.subscribe((e) => {
        if (e.type === 'end' || (e.type === 'status' && e.status === 'stopped')) finish();
      });
      const timer = setTimeout(finish, 30000);
      this.abortFns.add(finish);
      this.engine.scheduler.load(shape);
      this.engine.scheduler.playAll();
    });
  }

  private makeTools(gen: number): DemoTools {
    const alive = () => gen === this.generation && this.active;
    return {
      tone: (x, y, ms = 800) => (alive() ? this.playTone(x, y, ms) : Promise.resolve()),
      shape: (id) => (alive() ? this.playShape(getLibraryShape(id)) : Promise.resolve()),
      cue: (type) => {
        if (alive()) this.engine.cues.play(type);
      },
      wait: (ms) => (alive() ? this.wait(ms) : Promise.resolve()),
    };
  }
}
