// Instrument / Composition mode: tracing a shape IS a musical performance.
// Draw → perform (continuous pitch/pan/dynamics) → corners accent → closure
// cadence → theme extraction → structured composition (intro…coda).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type AppState } from '../state/store';
import { useActions } from '../app/actions';
import { engineSettings, getEngine } from '../app/engine';
import { midiToNoteName } from '../app/describe';
import { t, tl } from '../i18n';
import { GridLines, S, toSvgX, toSvgY } from './GridDefs';
import type {
  CompositionSection,
  GestureSample,
  InstrumentPhase,
  MusicalTheme,
  PerformanceScaleId,
  StoredTheme,
} from '../instrument/models';
import { REST } from '../instrument/models';
import { LiveGestureAnalyzer } from '../instrument/GestureAnalyzer';
import { LiveMusicalMapper } from '../instrument/MusicalMapper';
import { LiveInstrument } from '../instrument/LiveInstrument';
import { extractTheme, themeBeats } from '../instrument/ThemeExtractor';
import {
  buildCompositionPlan,
  CompositionPerformer,
  SECTION_LABELS,
} from '../instrument/CompositionEngine';
import { buildNoteTable, PERFORMANCE_SCALES, PERFORMANCE_SCALE_LABELS } from '../instrument/scales';
import { generateVariation, mulberry32 } from '../instrument/VariationEngine';
import type { VariationType } from '../instrument/models';
import { speech } from '../app/speech';
import { loadThemes, saveTheme, deleteTheme } from '../instrument/themeMemory';
import {
  HandTracker,
  type HandTrackerErrorCode,
  type HandTrackerStatus,
} from '../gesture/HandTracker';

type InputSource = 'pointer' | 'hand';

const PHASE_LABELS: Record<InstrumentPhase, { en: string; zh: string }> = {
  draw: { en: 'DRAW', zh: '描绘' },
  captured: { en: 'CAPTURED', zh: '已捕获' },
  theme: { en: 'THEME', zh: '主题' },
  composing: { en: 'COMPOSING', zh: '作曲中' },
};

const GEOMETRY_LABELS: Record<string, { en: string; zh: string }> = {
  'circle-like': { en: 'circle-like shape', zh: '类圆形' },
  'triangle-like': { en: 'triangle-like shape', zh: '类三角形' },
  'quadrilateral-like': { en: 'quadrilateral-like shape', zh: '类四边形' },
  'polygon-like': { en: 'polygon', zh: '多边形' },
  'line-like': { en: 'line', zh: '直线' },
  'arc-like': { en: 'arc', zh: '弧线' },
  'zigzag-like': { en: 'zigzag', zh: '折线' },
};

function geometryLabel(type: string): string {
  const l = GEOMETRY_LABELS[type];
  return l ? tl(l.en, l.zh) : type;
}

function thirdOf(scale: PerformanceScaleId): number {
  return PERFORMANCE_SCALES[scale][2] ?? 4;
}

/** Built-in triangle motif so the explanation works before anything is drawn */
function demoTheme(scale: PerformanceScaleId): MusicalTheme {
  const table = buildNoteTable(scale);
  const pick = (i: number) => table[Math.min(table.length - 1, i)];
  return {
    pitches: [pick(0), pick(3), pick(6), pick(9), pick(6), pick(3), pick(0)],
    durations: [0.5, 0.5, 0.5, 1, 0.5, 0.5, 1],
    velocities: [0.6, 0.65, 0.7, 0.85, 0.7, 0.65, 0.6],
    accents: [false, false, false, true, false, false, false],
    contour: [1, 1, 1, -1, -1, -1],
    geometryType: 'triangle-like',
    seed: 20260817,
    scale,
    tonicMidi: 48,
    bpm: 88,
    closed: true,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ExplainStep {
  type: VariationType;
  en: string;
  zh: string;
}

const EXPLAIN_STEPS: ExplainStep[] = [
  {
    type: 'transposition',
    en: 'Variation one, transposition: the same melody carried higher or lower. The shape of the tune never changes — only where it sits.',
    zh: '变奏一，移调：同样的旋律被搬到更高或更低的地方。曲调的形状不变，只是位置变了。',
  },
  {
    type: 'rhythmic',
    en: 'Variation two, rhythm: the notes stay the same, but time stretches or squeezes.',
    zh: '变奏二，节奏变化：音符不变，但时间被拉长或压缩。',
  },
  {
    type: 'fragmentation',
    en: 'Variation three, fragmentation: one small piece of the theme repeats and climbs, like an echo growing.',
    zh: '变奏三，片段化：主题中的一小段反复出现、逐级攀升，像不断生长的回声。',
  },
  {
    type: 'inversion',
    en: 'Variation four, inversion: the melody is mirrored — where it used to rise, now it falls.',
    zh: '变奏四，倒影：旋律照了镜子——原来上行的地方，现在变成下行。',
  },
  {
    type: 'retrograde',
    en: 'Variation five, retrograde: the theme played backwards, from the end to the beginning.',
    zh: '变奏五，逆行：把主题倒过来，从结尾弹回开头。',
  },
  {
    type: 'ornamentation',
    en: 'Variation six, ornamentation: tiny extra notes decorate the road between the main ones.',
    zh: '变奏六，装饰音：在主要的音之间点缀一些小小的经过音。',
  },
];

export default function InstrumentPanel() {
  const { state, dispatch } = useStore();
  const actions = useActions();
  const engine = useMemo(() => getEngine(), []);
  const tutorialActive = state.tutorialActive;

  const [phase, setPhase] = useState<InstrumentPhase>('draw');
  const [section, setSection] = useState<CompositionSection | null>(null);
  const [theme, setTheme] = useState<MusicalTheme | null>(null);
  const [memory, setMemory] = useState<StoredTheme[]>(() => loadThemes());
  const [tracePoints, setTracePoints] = useState('');
  const [cornerMarks, setCornerMarks] = useState<{ x: number; y: number }[]>([]);
  const [livePos, setLivePos] = useState<{ x: number; y: number; midi: number } | null>(null);
  const [source, setSource] = useState<InputSource>('pointer');
  const [handStatus, setHandStatus] = useState<HandTrackerStatus>('idle');
  const [explaining, setExplaining] = useState(false);
  const [handError, setHandError] = useState<HandTrackerErrorCode | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const instrumentRef = useRef<LiveInstrument | null>(null);
  const performerRef = useRef<CompositionPerformer | null>(null);
  const performerUnsubRef = useRef<(() => void) | null>(null);
  const analyzerRef = useRef(new LiveGestureAnalyzer());
  const mapperRef = useRef(new LiveMusicalMapper(engineSettings.current.performanceScale));
  const tracker = useMemo(() => new HandTracker(), []);

  const drawingRef = useRef(false);
  const samplesRef = useRef<GestureSample[]>([]);
  const strokeClosedRef = useRef(false);
  const uiThrottleRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const phaseRef = useRef<InstrumentPhase>('draw');
  const themeRef = useRef<MusicalTheme | null>(null);
  const handPresentRef = useRef(false);
  const explainGenRef = useRef(0);
  const explainingRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);
  useEffect(() => {
    mapperRef.current.setScale(state.performanceScale);
  }, [state.performanceScale]);

  const patch = useCallback(
    (p: Partial<AppState>) => dispatch({ type: 'patch', patch: p }),
    [dispatch],
  );

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  }, []);

  const later = useCallback((ms: number, fn: () => void) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);

  const getInstrument = useCallback((): LiveInstrument | null => {
    if (instrumentRef.current) return instrumentRef.current;
    const ctx = engine.audio.ensure();
    const dest = engine.audio.masterDestination;
    if (!ctx || !dest) return null;
    instrumentRef.current = new LiveInstrument(ctx, dest);
    return instrumentRef.current;
  }, [engine]);

  const getPerformer = useCallback((): CompositionPerformer | null => {
    if (performerRef.current) return performerRef.current;
    const inst = getInstrument();
    if (!inst) return null;
    const perf = new CompositionPerformer(inst);
    performerUnsubRef.current = perf.subscribe((e) => {
      if (e.type === 'section') {
        setSection(e.section);
        // Visual + braille only — never talk over the music
        actions.announce(tl(SECTION_LABELS[e.section].en, SECTION_LABELS[e.section].zh), false);
      } else if (e.type === 'finished') {
        setSection(null);
        setPhase('draw');
        actions.announce(
          tl(
            'Composition finished — press N to clear and draw another shape!',
            '作品完成——按 N 清空画布，再画一个图形吧！',
          ),
        );
      } else if (e.type === 'stopped') {
        setSection(null);
      }
    });
    performerRef.current = perf;
    return perf;
  }, [getInstrument, actions]);

  /** Silence everything this view owns (playback, drone, timers, stroke, explanation) */
  const stopAll = useCallback(() => {
    clearTimers();
    explainGenRef.current++;
    if (explainingRef.current) {
      explainingRef.current = false;
      setExplaining(false);
      speech.cancel();
    }
    performerRef.current?.stop(false);
    instrumentRef.current?.silence();
    drawingRef.current = false;
    setSection(null);
  }, [clearTimers]);

  /** Clear the drawn shape and reset everything for a fresh start (button + N key) */
  const newDrawing = useCallback(() => {
    stopAll();
    samplesRef.current = [];
    setTheme(null);
    setTracePoints('');
    setCornerMarks([]);
    setLivePos(null);
    setPhase('draw');
    actions.announce(
      tl('Canvas cleared — draw a new shape to perform', '画布已清空——画一个新图形开始演奏'),
    );
  }, [stopAll, actions]);

  // ---------- theme playback & composition ----------

  const startComposition = useCallback(
    (target: MusicalTheme) => {
      const inst = getInstrument();
      const perf = getPerformer();
      if (!inst || !perf) return;
      clearTimers();
      inst.cancelScheduled();
      const plan = buildCompositionPlan(target, engineSettings.current.variationStrength);
      setPhase('composing');
      perf.play(plan);
    },
    [getInstrument, getPerformer, clearTimers],
  );

  const playTheme = useCallback(
    (target: MusicalTheme, then: 'compose' | 'idle') => {
      const inst = getInstrument();
      if (!inst) return;
      clearTimers();
      performerRef.current?.stop(false);
      inst.cancelScheduled();
      setPhase('theme');
      const spb = 60 / target.bpm;
      const t0 = inst.now() + 0.15;
      let beat = 0;
      for (let i = 0; i < target.pitches.length; i++) {
        const p = target.pitches[i];
        if (p !== REST) {
          inst.scheduleNote({
            midi: p,
            when: t0 + beat * spb,
            dur: target.durations[i] * spb,
            vel: target.velocities[i],
            accent: target.accents[i],
            bright: 0.62,
          });
        }
        beat += target.durations[i];
      }
      const doneMs = (0.15 + beat * spb) * 1000 + 500;
      later(doneMs, () => {
        if (then === 'compose') startComposition(target);
        else setPhase('captured');
      });
    },
    [getInstrument, clearTimers, later, startComposition],
  );

  /** Spoken walkthrough: how the motif works, then each variation with a live example */
  const explainMusic = useCallback(async () => {
    const inst = getInstrument();
    if (!inst) return;
    stopAll();
    const gen = ++explainGenRef.current;
    const stale = () => gen !== explainGenRef.current;
    const base = themeRef.current ?? demoTheme(engineSettings.current.performanceScale);
    explainingRef.current = true;
    setExplaining(true);

    const say = (en: string, zh: string) => speech.speak(tl(en, zh));
    const playSeq = async (seq: {
      pitches: number[];
      durations: number[];
      velocities: number[];
      accents: boolean[];
    }) => {
      const spb = 60 / base.bpm;
      const t0 = inst.now() + 0.12;
      let beat = 0;
      for (let i = 0; i < seq.pitches.length; i++) {
        const pitch = seq.pitches[i];
        if (pitch !== REST) {
          inst.scheduleNote({
            midi: pitch,
            when: t0 + beat * spb,
            dur: seq.durations[i] * spb,
            vel: seq.velocities[i],
            accent: seq.accents[i],
            bright: 0.6,
          });
        }
        beat += seq.durations[i];
      }
      await sleep((0.12 + beat * spb) * 1000 + 400);
    };

    try {
      await say(
        'How your drawing becomes music: the computer follows your line. Height picks notes from the scale, corners strike accents, and the length of each side sets the rhythm. From the whole drawing it keeps eight to twelve important notes — that short melody is your theme, your shape\u2019s musical name.',
        '你的图形是这样变成音乐的：电脑跟着你的线条走——高度从音阶中挑选音符，转角敲出重音，每条边的长短决定节奏。整幅图里只保留八到十二个重要的音，这段小旋律就是你的主题——图形的音乐名字。',
      );
      if (stale()) return;
      await say(themeRef.current ? 'Here is your theme.' : 'Here is an example theme, shaped like a triangle.', themeRef.current ? '这是你的主题。' : '这是一个示例主题，形状像三角形。');
      if (stale()) return;
      await playSeq(base);
      if (stale()) return;
      for (const step of EXPLAIN_STEPS) {
        await say(step.en, step.zh);
        if (stale()) return;
        const variation = generateVariation(
          base,
          step.type,
          engineSettings.current.variationStrength,
          mulberry32(base.seed + EXPLAIN_STEPS.indexOf(step)),
        );
        await playSeq(variation);
        if (stale()) return;
      }
      await say(
        'A full composition grows from these: an intro, your theme, variations, a busy development, then the theme comes home, and a final chord says goodbye. Now draw a shape and listen to your own music!',
        '完整的作品就由这些长出来：引子、你的主题、几段变奏、最热闹的发展，然后主题回家，最后一个和弦道别。现在画一个图形，听听属于你自己的音乐吧！',
      );
    } finally {
      if (!stale()) {
        explainingRef.current = false;
        setExplaining(false);
        setPhase(themeRef.current ? 'captured' : 'draw');
      }
    }
  }, [getInstrument, stopAll]);

  // ---------- stroke lifecycle ----------

  const finalizeStroke = useCallback(() => {
    const samples = samplesRef.current;
    samplesRef.current = [];
    const inst = getInstrument();
    const extracted = extractTheme(samples, { scale: engineSettings.current.performanceScale });
    if (!extracted) {
      setPhase('draw');
      actions.announce(
        tl('Too short — draw a bigger shape to make music', '太短了——画大一点的图形来创作音乐吧'),
      );
      return;
    }
    if (extracted.closed && inst) {
      inst.playCadence(extracted.tonicMidi, thirdOf(extracted.scale));
    }
    setTheme(extracted);
    setPhase('captured');
    const noteCount = extracted.pitches.filter((p) => p !== REST).length;
    const name = `${geometryLabel(extracted.geometryType)} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    setMemory(saveTheme(extracted, name));
    actions.announce(
      tl(
        `Captured: ${noteCount} notes from a ${geometryLabel(extracted.geometryType)}${extracted.closed ? ', closed' : ''}. Listen to your theme.`,
        `已捕获：来自${geometryLabel(extracted.geometryType)}的 ${noteCount} 个音符${extracted.closed ? '，闭合' : ''}。听听你的主题。`,
      ),
    );
    // Let the cadence finish, then play the theme and flow into the composition
    later(extracted.closed ? 2400 : 700, () => playTheme(extracted, 'compose'));
  }, [getInstrument, actions, later, playTheme]);

  const endStroke = useCallback(
    (abort = false) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      const inst = getInstrument();
      inst?.stopVoice(0.2);
      setLivePos(null);
      if (abort) {
        samplesRef.current = [];
        setPhase('draw');
        return;
      }
      finalizeStroke();
    },
    [getInstrument, finalizeStroke],
  );

  const pushSample = useCallback(
    (x: number, y: number) => {
      if (!drawingRef.current) return;
      const inst = getInstrument();
      if (!inst) return;
      const sample: GestureSample = { x, y, t: performance.now() };
      samplesRef.current.push(sample);
      const features = analyzerRef.current.push(sample);
      const params = mapperRef.current.map(features);
      inst.updateVoice(params);
      if (features.corner) {
        inst.playAccent(params.midi, params.pan);
        setCornerMarks((marks) => [...marks, { x, y }]);
      }
      const now = performance.now();
      if (now - uiThrottleRef.current > 70) {
        uiThrottleRef.current = now;
        setTracePoints(
          samplesRef.current.map((s) => `${toSvgX(s.x).toFixed(1)},${toSvgY(s.y).toFixed(1)}`).join(' '),
        );
        setLivePos({ x, y, midi: params.midi });
      }
      if (features.closed) {
        endStroke();
      }
    },
    [getInstrument, endStroke],
  );

  const beginStroke = useCallback(
    (x: number, y: number) => {
      const inst = getInstrument();
      if (!inst) {
        actions.announce(t('Could not start the audio system. Please check your sound settings and restart the app.'));
        return;
      }
      clearTimers();
      performerRef.current?.stop(false);
      inst.silence();
      analyzerRef.current.reset();
      mapperRef.current.reset();
      samplesRef.current = [];
      strokeClosedRef.current = false;
      setCornerMarks([]);
      setTracePoints('');
      setTheme(null);
      setSection(null);
      setPhase('draw');
      drawingRef.current = true;
      const sample: GestureSample = { x, y, t: performance.now() };
      samplesRef.current.push(sample);
      const params = mapperRef.current.map(analyzerRef.current.push(sample));
      inst.startVoice(params);
    },
    [getInstrument, actions, clearTimers],
  );

  // ---------- pointer input ----------

  const toGrid = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (source !== 'pointer') return;
      const p = toGrid(e);
      if (!p) return;
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // synthetic events have no capturable pointer — drawing still works
      }
      beginStroke(p.x, p.y);
    },
    [source, toGrid, beginStroke],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (source !== 'pointer' || !drawingRef.current) return;
      const p = toGrid(e);
      if (p) pushSample(p.x, p.y);
    },
    [source, toGrid, pushSample],
  );

  const onPointerUp = useCallback(() => {
    if (source === 'pointer') endStroke();
  }, [source, endStroke]);

  // ---------- hand input (shared gesture pipeline) ----------

  useEffect(() => {
    tracker.onFrame = (frame) => {
      if (frame.present !== handPresentRef.current) {
        handPresentRef.current = frame.present;
        if (frame.present) {
          actions.announce(t('Hand detected'), false);
          if (!drawingRef.current && phaseRef.current === 'draw') {
            beginStroke(frame.x, frame.y);
          }
        } else if (drawingRef.current) {
          endStroke();
        }
        if (!frame.present) return;
      }
      if (!frame.present) return;
      if (frame.pinchStarted && drawingRef.current) {
        endStroke(); // pinch = lift the pen
        return;
      }
      if (drawingRef.current) {
        pushSample(frame.x, frame.y);
      } else if (phaseRef.current === 'draw') {
        beginStroke(frame.x, frame.y);
      }
    };
    tracker.onError = (code) => {
      setHandStatus('error');
      setHandError(code);
    };
    return () => {
      tracker.onFrame = null;
      tracker.onError = null;
    };
  }, [tracker, actions, beginStroke, endStroke, pushSample]);

  const startHand = useCallback(async () => {
    if (!videoRef.current) return;
    setHandError(null);
    setHandStatus('starting');
    try {
      await tracker.start(videoRef.current);
      setHandStatus('running');
      actions.announce(
        tl(
          'Hand tracking is on — move your hand to perform, pinch to finish a shape.',
          '手势追踪已开启——移动手来演奏，捏合手指结束一个图形。',
        ),
      );
    } catch {
      // onError already updated the state
    }
  }, [tracker, actions]);

  const stopHand = useCallback(() => {
    tracker.stop();
    handPresentRef.current = false;
    setHandStatus('idle');
    if (drawingRef.current) endStroke(true);
  }, [tracker, endStroke]);

  // ---------- global keys & cleanup ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // N / Delete / Backspace: clear the drawn shape and start over
      // (N belongs to the tutorial while it is active)
      if (
        (e.key === 'n' || e.key === 'N' || e.key === 'Delete' || e.key === 'Backspace') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !tutorialActive
      ) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        newDrawing();
        return;
      }
      if (e.key !== 'Escape') return;
      if (explainingRef.current) {
        e.preventDefault();
        stopAll();
        setPhase(themeRef.current ? 'captured' : 'draw');
        actions.announce(t('Stopped'));
      } else if (drawingRef.current) {
        e.preventDefault();
        endStroke(true);
        actions.announce(t('Stopped'));
      } else if (phaseRef.current === 'theme' || phaseRef.current === 'composing') {
        e.preventDefault();
        clearTimers();
        performerRef.current?.stop(false);
        instrumentRef.current?.silence();
        setSection(null);
        setPhase(themeRef.current ? 'captured' : 'draw');
        actions.announce(t('Stopped'));
      } else if (handStatus === 'running') {
        e.preventDefault();
        stopHand();
        actions.announce(t('Hand tracking stopped'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endStroke, clearTimers, actions, handStatus, stopHand, stopAll, newDrawing, tutorialActive]);

  useEffect(() => {
    // Leaving the view: stop every sound and release the camera + instrument
    return () => {
      clearTimers();
      performerUnsubRef.current?.();
      performerRef.current?.stop(false);
      tracker.stop();
      instrumentRef.current?.dispose();
      instrumentRef.current = null;
      performerRef.current = null;
    };
  }, [clearTimers, tracker]);

  // ---------- render ----------

  const noteNames = theme
    ? theme.pitches.map((p) => (p === REST ? '·' : midiToNoteName(p))).join(' ')
    : '';
  // Restart any time: Replay/Compose stop the current playback first
  const canReplay = theme !== null && !explaining;

  return (
    <div>
      <h2>
        <span aria-hidden="true">🎼 </span>
        {t('Instrument')}
      </h2>
      <p className="settings-note">
        {t(
          'Trace a shape and you are performing: up and down is pitch, left and right is space, speed is loudness, corners strike accents, and closing the shape ends the phrase. Then listen as your geometry becomes a short composition.',
        )}{' '}
        {t('Press N (or Delete) any time to clear the canvas and start over.')}
      </p>

      <div className="control-bar">
        <button
          className="primary"
          onClick={newDrawing}
          aria-keyshortcuts="N"
          title={tl('Shortcut: N or Delete', '快捷键：N 或 Delete')}
        >
          <span aria-hidden="true">🧹 </span>
          {t('Clear & Start Over')}
        </button>
        <button onClick={() => theme && playTheme(theme, 'idle')} disabled={!canReplay}>
          <span aria-hidden="true">🎵 </span>
          {t('Replay Theme')}
        </button>
        <button onClick={() => theme && startComposition(theme)} disabled={!canReplay}>
          <span aria-hidden="true">🎶 </span>
          {t('Play Composition')}
        </button>
        <button
          onClick={() => {
            stopAll();
            setPhase(theme ? 'captured' : 'draw');
            actions.announce(t('Stopped'));
          }}
          disabled={phase !== 'composing' && phase !== 'theme' && !explaining}
        >
          <span aria-hidden="true">⏹️ </span>
          {t('Stop')}
        </button>
        <button onClick={() => void explainMusic()} disabled={explaining} aria-pressed={explaining}>
          <span aria-hidden="true">🎓 </span>
          {t('Explain the Music')}
        </button>
      </div>

      <div className="settings-row" style={{ maxWidth: 640 }}>
        <span role="radiogroup" aria-label={t('Input source')}>
          <label style={{ marginRight: '0.6rem' }}>
            <input
              type="radio"
              name="instrument-source"
              checked={source === 'pointer'}
              onChange={() => {
                stopHand();
                setSource('pointer');
              }}
            />
            {t('Mouse / touch')}
          </label>
          <label>
            <input
              type="radio"
              name="instrument-source"
              checked={source === 'hand'}
              onChange={() => setSource('hand')}
            />
            {t('Camera hand')}
          </label>
        </span>
        <label htmlFor="perf-scale">
          {t('Scale')}
          <select
            id="perf-scale"
            value={state.performanceScale}
            onChange={(e) => patch({ performanceScale: e.target.value as PerformanceScaleId })}
          >
            {(Object.keys(PERFORMANCE_SCALE_LABELS) as PerformanceScaleId[]).map((id) => (
              <option key={id} value={id}>
                {PERFORMANCE_SCALE_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="var-strength">
          {t('Variation strength')}
          <input
            id="var-strength"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={state.variationStrength}
            aria-valuetext={state.variationStrength.toFixed(2)}
            onChange={(e) => patch({ variationStrength: parseFloat(e.target.value) })}
          />
        </label>
      </div>

      {source === 'hand' && (
        <div className="control-bar">
          {handStatus !== 'running' ? (
            <button onClick={() => void startHand()} disabled={handStatus === 'starting'}>
              <span aria-hidden="true">📷 </span>
              {handStatus === 'starting' ? t('Starting…') : t('Start Hand Tracking')}
            </button>
          ) : (
            <button onClick={stopHand}>
              <span aria-hidden="true">⏹️ </span>
              {t('Stop Hand Tracking')}
            </button>
          )}
          {handError && (
            <span className="settings-note" role="alert">
              {t('Camera error')}
            </span>
          )}
        </div>
      )}

      <div className="hand-layout">
        <svg
          ref={svgRef}
          className="canvas-svg instrument-canvas"
          viewBox={`0 0 ${S} ${S}`}
          role="application"
          aria-label={t('Performance canvas — draw here to play')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <GridLines />
          {tracePoints && (
            <polyline
              points={tracePoints}
              fill="none"
              stroke="var(--shape-line)"
              strokeWidth={state.lineWidth * 0.35}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {cornerMarks.map((m, i) => (
            <rect
              key={i}
              x={-1.8}
              y={-1.8}
              width={3.6}
              height={3.6}
              transform={`translate(${toSvgX(m.x)} ${toSvgY(m.y)}) rotate(45)`}
              fill="var(--vertex-fill)"
            />
          ))}
          {livePos && (
            <circle
              className="sound-dot"
              cx={toSvgX(livePos.x)}
              cy={toSvgY(livePos.y)}
              r={2.2}
              fill="var(--dot-fill)"
              stroke="var(--bg-panel)"
              strokeWidth={0.6}
            />
          )}
        </svg>

        <div className="hand-side">
          <p className="settings-note" role="status">
            {explaining
              ? tl('EXPLAINING', '讲解中')
              : tl(PHASE_LABELS[phase].en, PHASE_LABELS[phase].zh)}
            {section ? ` — ${tl(SECTION_LABELS[section].en, SECTION_LABELS[section].zh)}` : ''}
          </p>
          {/* Fast-changing values are visual aids only */}
          {livePos && (
            <p className="settings-note" aria-hidden="true">
              {t('Pitch')}: {midiToNoteName(livePos.midi)}
            </p>
          )}
          {theme && (
            <div className="settings-note">
              <p>
                {t('Theme')}: {geometryLabel(theme.geometryType)} ·{' '}
                {theme.pitches.filter((p) => p !== REST).length} {t('notes')} ·{' '}
                {themeBeats(theme).toFixed(1)} {t('beats')}
              </p>
              <p aria-hidden="true" style={{ fontFamily: 'ui-monospace, monospace' }}>
                {noteNames}
              </p>
            </div>
          )}
          {source === 'hand' && (
            <video ref={videoRef} className="hand-video" muted playsInline aria-hidden="true" />
          )}

          {memory.length > 0 && (
            <details>
              <summary>
                {t('Musical memory')} ({memory.length})
              </summary>
              <ul className="memory-list">
                {memory.map((m) => (
                  <li key={m.id}>
                    <span>{m.name}</span>{' '}
                    <button
                      onClick={() => {
                        stopAll();
                        setTheme(m.theme);
                        setPhase('captured');
                        playTheme(m.theme, 'idle');
                      }}
                    >
                      {t('Play')}
                    </button>{' '}
                    <button onClick={() => setMemory(deleteTheme(m.id))}>{t('Delete')}</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
