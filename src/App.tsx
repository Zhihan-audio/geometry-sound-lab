// Main component: layout, engine wiring, global keyboard shortcuts
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore, resolveShape, type AppState, type PlaybackMode, type ViewId } from './state/store';
import { engineSettings, getEngine } from './app/engine';
import { ActionsContext, type AppActions, type AdhocPlayOptions } from './app/actions';
import {
  describeLeg,
  gridCellUnits,
  positionText,
  shapeSummary,
  speak,
  speakSignedInt,
} from './app/describe';
import { saveCustomShapes } from './state/persistence';
import { getLibraryShape } from './geometry/shapeLibrary';
import type { GeometryShape } from './geometry/geometryTypes';
import type { CueType } from './audio/CueSoundEngine';
import { getLocale, setLocale, t, tl, tt } from './i18n';
import ShapeLibraryPanel from './components/ShapeLibraryPanel';
import CanvasView from './components/CanvasView';
import SettingsPanel from './components/SettingsPanel';
import ControlBar from './components/ControlBar';
import StatusBar from './components/StatusBar';
import EditorPanel from './components/EditorPanel';
import LessonPanel from './components/LessonPanel';
import SlopeComparePanel from './components/SlopeComparePanel';
import HelpDialog from './components/HelpDialog';
import HandPanel from './components/HandPanel';
import InstrumentPanel from './components/InstrumentPanel';
import TutorialPanel from './components/TutorialPanel';
import WelcomeDialog, { WELCOME_SKIP_MESSAGE } from './components/WelcomeDialog';
import { TutorialController } from './app/tutorial';
import { accessibleNameFor, speech } from './app/speech';

type AppStatePatch = Partial<AppState>;

const MODE_LABELS: Record<PlaybackMode, string> = {
  continuous: 'Continuous outline',
  segment: 'Edge by edge',
  exploration: 'Free exploration',
};

const VIEW_TABS: { id: ViewId; label: string; emoji: string }[] = [
  { id: 'play', label: 'Play & Listen', emoji: '🎧' },
  { id: 'editor', label: 'Teacher Editor', emoji: '✏️' },
  { id: 'lessons', label: 'Practice', emoji: '🎓' },
  { id: 'slope', label: 'Slope Lab', emoji: '⛰️' },
  { id: 'hand', label: 'Hand Play', emoji: '🖐️' },
  { id: 'instrument', label: 'Instrument', emoji: '🎼' },
];

export default function App() {
  const { state, dispatch } = useStore();
  const engine = useMemo(() => getEngine(), []);
  const tutorial = useMemo(() => new TutorialController(engine), [engine]);

  // Dev-only debugging handle (assigned in an effect so it is the committed instance)
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __gslTutorial?: unknown }).__gslTutorial = tutorial;
    }
  }, [tutorial]);
  const stateRef = useRef(state);
  const exploreCellRef = useRef<string | null>(null);
  const posThrottleRef = useRef(0);
  const closureAtRef = useRef(0);
  const pendingPosRef = useRef<AppStatePatch | null>(null);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Throttle position updates (~70ms) while making sure the last one is never lost
  const pushPositionPatch = useCallback(
    (patch: AppStatePatch) => {
      const now = performance.now();
      if (now - posThrottleRef.current > 70) {
        posThrottleRef.current = now;
        dispatch({ type: 'patch', patch });
      } else {
        pendingPosRef.current = patch;
        if (trailingTimerRef.current === null) {
          trailingTimerRef.current = setTimeout(() => {
            trailingTimerRef.current = null;
            if (pendingPosRef.current) {
              dispatch({ type: 'patch', patch: pendingPosRef.current });
              pendingPosRef.current = null;
            }
          }, 90);
        }
      }
    },
    [dispatch],
  );

  // Keep the latest state snapshot available to the engine
  useEffect(() => {
    stateRef.current = state;
    engineSettings.current = state;
  });

  // Sync volumes / timbre / mute to the audio engine
  useEffect(() => {
    engine.audio.setMasterVolume(state.masterVolume);
    engine.audio.setMainVolume(state.mainVoiceVolume);
    engine.audio.setCueVolume(state.cueVolume);
    engine.audio.setWaveform(state.waveform);
    engine.audio.setMuted(state.muted);
  }, [engine, state.masterVolume, state.mainVoiceVolume, state.cueVolume, state.waveform, state.muted]);

  // Theme & font size
  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.style.setProperty('--font-scale', String(state.fontScale));
  }, [state.theme, state.fontScale]);

  // Keep the i18n module and document language in sync with the setting
  useEffect(() => {
    if (getLocale() !== state.locale) setLocale(state.locale);
    document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : 'en';
  }, [state.locale]);

  // Audio error reporting
  useEffect(() => {
    engine.audio.onError = (message) => dispatch({ type: 'error', message });
    return () => {
      engine.audio.onError = null;
    };
  }, [engine, dispatch]);

  // Announce to the live region; also spoken aloud by the built-in voice
  // (except rapid mid-playback events, which already have sound cues).
  const announce = useCallback(
    (text: string, speakIt = true) => {
      dispatch({ type: 'announce', text });
      if (
        speakIt &&
        stateRef.current.speechEnabled &&
        !tutorial.isActive &&
        !stateRef.current.welcomeOpen
      ) {
        void speech.speak(text);
      }
    },
    [dispatch, tutorial],
  );

  // Self-voicing focus reader: speaks the focused control's name and state.
  // Turn off in settings when using the VoiceOver screen reader.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const s = stateRef.current;
      if (!s.speechEnabled || !s.speakFocus) return;
      if (tutorial.isActive) return; // the tour is already talking
      if (s.welcomeOpen) return; // the welcome orientation is talking
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      const name = accessibleNameFor(el);
      if (name) void speech.speak(name);
    };
    window.addEventListener('focusin', onFocusIn);
    return () => window.removeEventListener('focusin', onFocusIn);
  }, [tutorial]);

  // Voice tour lifecycle: start / stop with state, relay finish & exit
  useEffect(() => {
    if (state.tutorialActive && !tutorial.isActive) {
      engine.scheduler.stop();
      (document.activeElement as HTMLElement | null)?.blur?.();
      tutorial.start(stateRef.current.playbackMode);
    } else if (!state.tutorialActive && tutorial.isActive) {
      tutorial.exit();
    }
  }, [state.tutorialActive, tutorial, engine]);

  useEffect(() => {
    const unsub = tutorial.subscribe((e) => {
      if (e.type === 'finished') {
        dispatch({ type: 'patch', patch: { tutorialActive: false } });
        announce(t('Tour finished — you are ready to explore!'));
      } else if (e.type === 'exited') {
        dispatch({ type: 'patch', patch: { tutorialActive: false } });
      }
    });
    return unsub;
  }, [tutorial, dispatch, announce]);

  // Let the tour react when the playback mode changes (for its "press E" task)
  useEffect(() => {
    tutorial.notifyMode(state.playbackMode);
  }, [state.playbackMode, tutorial]);

  // Reload the scheduler when the selected shape or direction changes
  useEffect(() => {
    const shape = resolveShape(state);
    if (!shape) return;
    engine.scheduler.load(shape, state.playDirection);
    if (engine.exploration.isActive) {
      engine.exploration.start(shape);
    }
  }, [state.selectedShapeId, state.playDirection, state.customShapes]);

  /** 当前逻辑边的文字描述：平滑曲线整段算一条"曲线边"，直边照常读方向/斜率 */
  const segmentText = useCallback(
    (withLength: boolean): string | null => {
      const seg = engine.scheduler.currentSegment;
      const legs = engine.scheduler.legs;
      if (!seg || !legs[seg.startLeg]) return null;
      if (seg.isCurve) {
        const title = tl(
          `Edge ${seg.index + 1} of ${seg.total}`,
          `第 ${seg.index + 1} 条边，共 ${seg.total} 条`,
        );
        return `${title}: ${tl('a smooth curved edge', '一条平滑的曲线边')}`;
      }
      const d = describeLeg(legs[seg.startLeg], seg.index, seg.total);
      return withLength
        ? `${d.title}: ${d.direction}, ${d.kind}, length ${d.length}`
        : `${d.title}: ${d.direction}, ${d.kind}`;
    },
    [engine],
  );

  // Scheduler events → state & announcements
  useEffect(() => {
    const unsub = engine.scheduler.subscribe((e) => {
      const s = stateRef.current;
      switch (e.type) {
        case 'status':
          dispatch({ type: 'patch', patch: { playbackStatus: e.status } });
          if (e.status === 'paused') announce(t('Paused'));
          break;
        case 'position':
          // 边序号由 segment 事件维护（逻辑边），position 事件只更新位置
          pushPositionPatch({
            currentPosition: { x: e.x, y: e.y, pan: e.pan, midi: e.midi },
          });
          break;
        case 'vertex':
          announce(t('Corner'), false); // the click cue already marks it
          break;
        case 'intersection':
          announce(t('Crossing point'), false); // the pulse cue already marks it
          break;
        case 'closure':
          // Closure and end often arrive in the same frame; merge the announcements
          closureAtRef.current = performance.now();
          announce(t('Shape closed'), false);
          break;
        case 'pathStart': {
          const shape = engine.scheduler.currentShape;
          const shapeName = shape ? t(shape.name) : '';
          if (e.pathIndex === 0) {
            announce(tl(`Now playing: ${shapeName}`, `开始播放：${shapeName}`));
          } else {
            announce(
              tl(`Line ${e.pathIndex + 1} of ${e.pathCount}`, `第 ${e.pathIndex + 1} 条线路，共 ${e.pathCount} 条`),
            );
          }
          break;
        }
        case 'segment':
          dispatch({
            type: 'patch',
            patch: { currentSegmentIndex: e.index, segmentCount: e.total },
          });
          break;
        case 'end': {
          if (performance.now() - closureAtRef.current < 1200) {
            announce(t('Shape closed — nice listening! Finished.'));
          } else {
            announce(t('Finished!'));
          }
          if (s.playbackMode === 'segment' && s.speechEnabled) {
            const text = segmentText(false);
            if (text) speak(text, true);
          }
          break;
        }
        case 'error':
          dispatch({ type: 'error', message: e.message });
          engine.cues.play('error');
          break;
      }
    });
    return unsub;
  }, [engine, dispatch, announce, pushPositionPatch, segmentText]);

  // Exploration events
  useEffect(() => {
    const unsub = engine.exploration.subscribe((e) => {
      switch (e.type) {
        case 'position':
          pushPositionPatch({
            explorationPos: { x: e.x, y: e.y },
            explorationOnLine: e.onLine,
            currentPosition: { x: e.x, y: e.y, pan: e.pan, midi: e.midi },
          });
          break;
        case 'enterLine':
          announce(t('On a line'), false); // the tone itself is the feedback
          break;
        case 'leaveLine':
          announce(t('Off the line'), false);
          break;
        case 'vertex':
          announce('Corner', false);
          break;
        case 'intersection':
          announce(t('Crossing'), false);
          break;
        case 'followEnd':
          announce(t('Reached the end of the line'));
          break;
        case 'soundToggle':
          announce(e.on ? t('Exploration sound on') : t('Exploration sound off'));
          break;
      }
    });
    return unsub;
  }, [engine, dispatch, announce, pushPositionPatch]);

  // ---------- Actions ----------

  const findShape = useCallback((id: string): GeometryShape | null => {
    return getLibraryShape(id) ?? stateRef.current.customShapes.find((s) => s.id === id) ?? null;
  }, []);

  const ensureLoaded = useCallback((): boolean => {
    const s = stateRef.current;
    const shape = resolveShape(s);
    if (!shape) {
      announce(t('Please pick a shape from the library first'));
      return false;
    }
    if (engine.scheduler.currentShape?.id !== shape.id) {
      engine.scheduler.load(shape, s.playDirection);
    }
    return true;
  }, [engine, announce]);

  const setMode = useCallback(
    (mode: PlaybackMode) => {
      const s = stateRef.current;
      if (s.playbackMode === mode) return;
      engine.scheduler.stop();
      if (s.playbackMode === 'exploration') {
        engine.exploration.stop();
        dispatch({ type: 'patch', patch: { explorationPos: null, explorationOnLine: false } });
      }
      dispatch({ type: 'patch', patch: { playbackMode: mode } });
      if (mode === 'exploration') {
        const shape = resolveShape(s);
        if (shape) {
          engine.exploration.start(shape);
          dispatch({ type: 'patch', patch: { explorationPos: { x: 0.5, y: 0.5 } } });
        }
      }
      announce(tl(`Mode: ${t(MODE_LABELS[mode])}`, `模式：${t(MODE_LABELS[mode])}`));
    },
    [engine, dispatch, announce],
  );

  const play = useCallback(() => {
    const s = stateRef.current;
    if (s.playbackMode === 'exploration') {
      engine.exploration.toggleSound();
      return;
    }
    if (!ensureLoaded()) return;
    if (s.playbackMode === 'segment') {
      // currentSegmentIndex 现在是逻辑边序号，调度器自己记录具体位置
      engine.scheduler.replaySegment();
      const text = segmentText(false);
      if (text) dispatch({ type: 'status-text', text });
    } else {
      engine.scheduler.playAll();
    }
  }, [engine, ensureLoaded, dispatch, segmentText]);

  const pauseOrResume = useCallback(() => {
    const status = engine.scheduler.playbackStatus;
    if (status === 'playing') {
      engine.scheduler.pause();
    } else if (status === 'paused') {
      engine.scheduler.resume();
      announce(t('Resuming'));
    } else {
      play();
    }
  }, [engine, play, announce]);

  const stopPlayback = useCallback(() => {
    engine.scheduler.stop();
    announce(t('Stopped'));
  }, [engine, announce]);

  // Leaving the play surface for another view: silence everything playback owns
  const leavePlayback = useCallback(() => {
    engine.scheduler.stop();
    if (stateRef.current.playbackMode === 'exploration') {
      engine.exploration.stop();
      dispatch({
        type: 'patch',
        patch: { playbackMode: 'continuous', explorationPos: null, explorationOnLine: false },
      });
    }
  }, [engine, dispatch]);

  const replay = useCallback(() => {
    const s = stateRef.current;
    if (s.playbackMode === 'exploration') return;
    if (!ensureLoaded()) return;
    engine.scheduler.replay();
  }, [engine, ensureLoaded]);

  const announceSegment = useCallback(() => {
    const text = segmentText(true);
    if (text) dispatch({ type: 'status-text', text });
  }, [segmentText, dispatch]);

  const nextSegment = useCallback(() => {
    const s = stateRef.current;
    if (s.playbackMode !== 'segment') {
      setMode('segment');
    }
    if (!ensureLoaded()) return;
    if (!engine.scheduler.nextSegment()) {
      announce(t('This is the last edge'));
    } else {
      announceSegment();
    }
  }, [engine, ensureLoaded, setMode, announce, announceSegment]);

  const prevSegment = useCallback(() => {
    const s = stateRef.current;
    if (s.playbackMode !== 'segment') {
      setMode('segment');
    }
    if (!ensureLoaded()) return;
    if (!engine.scheduler.prevSegment()) {
      announce(t('This is the first edge'));
    } else {
      announceSegment();
    }
  }, [engine, ensureLoaded, setMode, announce, announceSegment]);

  const replaySegment = useCallback(() => {
    if (!ensureLoaded()) return;
    engine.scheduler.replaySegment();
    announceSegment();
  }, [engine, ensureLoaded, announceSegment]);

  const selectShape = useCallback(
    (id: string) => {
      const shape = findShape(id);
      dispatch({ type: 'patch', patch: { selectedShapeId: id, currentSegmentIndex: 0 } });
      if (shape) {
        announce(shapeSummary(shape));
      }
    },
    [dispatch, announce, findShape],
  );

  const toggleExploration = useCallback(() => {
    const s = stateRef.current;
    setMode(s.playbackMode === 'exploration' ? 'continuous' : 'exploration');
  }, [setMode]);

  const toggleMute = useCallback(() => {
    const next = !stateRef.current.muted;
    dispatch({ type: 'patch', patch: { muted: next } });
    announce(next ? t('Muted') : t('Sound is back on'));
  }, [dispatch, announce]);

  const previewCue = useCallback(
    (type: CueType) => {
      engine.cues.play(type);
    },
    [engine],
  );

  const playAdhocShape = useCallback(
    (shape: GeometryShape, opts: AdhocPlayOptions = {}) => {
      engine.exploration.stop();
      engine.scheduler.load(shape, shape.playbackDirection);
      if (opts.segmented) {
        dispatch({ type: 'patch', patch: { playbackMode: 'segment' } });
        engine.scheduler.playSegmentAt(0);
      } else {
        engine.scheduler.playAll({ speedFactor: opts.speedFactor });
      }
    },
    [engine, dispatch],
  );

  const saveCustomShape = useCallback(
    (shape: GeometryShape) => {
      const s = stateRef.current;
      const next = [...s.customShapes.filter((x) => x.id !== shape.id), shape];
      dispatch({ type: 'patch', patch: { customShapes: next } });
      saveCustomShapes(next);
      announce(tl(`Saved to My Shapes: ${shape.name}`, `已保存到自定义图形：${shape.name}`));
    },
    [dispatch, announce],
  );

  const deleteCustomShape = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const next = s.customShapes.filter((x) => x.id !== id);
      dispatch({ type: 'patch', patch: { customShapes: next } });
      saveCustomShapes(next);
      announce(t('Custom shape deleted'));
    },
    [dispatch, announce],
  );

  const actions: AppActions = useMemo(
    () => ({
      selectShape,
      play,
      pauseOrResume,
      stopPlayback,
      replay,
      nextSegment,
      prevSegment,
      replaySegment,
      setMode,
      toggleExploration,
      toggleMute,
      previewCue,
      playAdhocShape,
      announce,
      saveCustomShape,
      deleteCustomShape,
    }),
    [
      selectShape,
      play,
      pauseOrResume,
      stopPlayback,
      replay,
      nextSegment,
      prevSegment,
      replaySegment,
      setMode,
      toggleExploration,
      toggleMute,
      previewCue,
      playAdhocShape,
      announce,
      saveCustomShape,
      deleteCustomShape,
    ],
  );

  // ---------- Global keyboard shortcuts ----------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      // Text-style controls: block all global shortcuts (except Escape)
      const inFormField =
        target !== null &&
        target.closest('input, textarea, select, [contenteditable="true"]') !== null;
      // Button-style controls: leave only Space / Enter to the control itself
      const inButton =
        target !== null && target.closest('button, a, [role="option"]') !== null;

      const s = stateRef.current;

      // 单按 Ctrl：立即停止当前语音（读屏软件的通用习惯），任何界面下都生效
      if (e.key === 'Control' && !e.repeat) {
        speech.cancel();
        return;
      }

      // Welcome orientation: Enter starts the tour, Escape skips, other
      // app shortcuts stay quiet until the student has answered.
      if (s.welcomeOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          dispatch({ type: 'patch', patch: { welcomeOpen: false } });
          dispatch({ type: 'announce', text: t('Press T any time for the voice tour.') });
          void speech.speak(tt(WELCOME_SKIP_MESSAGE));
        } else if ((e.key === 'Enter' && !inButton) || e.key === 't' || e.key === 'T') {
          e.preventDefault();
          dispatch({ type: 'patch', patch: { welcomeOpen: false, tutorialActive: true } });
        }
        return;
      }

      // Voice tour keys (N / P / H / Escape) take priority while the tour is on
      if (!inFormField && s.tutorialActive) {
        if (
          tutorial.handleKey(e, {
            exploring: s.playbackMode === 'exploration',
            helpOpen: s.helpOpen,
          })
        ) {
          e.preventDefault();
          return;
        }
      }

      if (e.key === 'Escape') {
        if (s.helpOpen) {
          dispatch({ type: 'patch', patch: { helpOpen: false } });
        } else if (s.view === 'hand' || s.view === 'instrument') {
          // These views own Escape (stop tracking / stop performance)
        } else if (s.playbackMode === 'exploration') {
          toggleExploration();
        } else {
          engine.scheduler.stop();
          announce(t('Stopped'));
        }
        return;
      }

      // 帮助对话框打开时全局快捷键让位（方向键由对话框用来朗读快捷键；? 仍可关闭）
      if (s.helpOpen) {
        if (e.key === '?') {
          e.preventDefault();
          dispatch({ type: 'patch', patch: { helpOpen: false } });
        }
        return;
      }

      if (inFormField) return;
      if (inButton && (e.key === ' ' || e.key === 'Enter')) return;

      // Hand Play / Instrument own the shared audio, and Practice owns its
      // question flow: block the shortcuts that would start library playback
      // or drive the exploration pointer under them.
      if (s.view === 'hand' || s.view === 'instrument' || s.view === 'lessons') {
        const voiceKeys = [
          ' ',
          'r',
          'R',
          'e',
          'E',
          'm',
          'M',
          'f',
          'F',
          'Enter',
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
        ];
        if (voiceKeys.includes(e.key)) return;
      }

      // Ctrl 组合键：面向盲人用户的高频备选键位（方向键 + Ctrl + 回车）
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        const order: PlaybackMode[] = ['continuous', 'segment', 'exploration'];
        switch (e.key) {
          case 'ArrowRight':
            e.preventDefault();
            setMode(order[(order.indexOf(s.playbackMode) + 1) % order.length]);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            setMode(order[(order.indexOf(s.playbackMode) + order.length - 1) % order.length]);
            break;
          case 'ArrowUp': {
            e.preventDefault();
            const next = Math.min(3, Math.round((s.playbackSpeed + 0.15) * 100) / 100);
            dispatch({ type: 'patch', patch: { playbackSpeed: next } });
            announce(`Speed ${next.toFixed(2)}x`);
            break;
          }
          case 'ArrowDown': {
            e.preventDefault();
            const next = Math.max(0.25, Math.round((s.playbackSpeed - 0.15) * 100) / 100);
            dispatch({ type: 'patch', patch: { playbackSpeed: next } });
            announce(`Speed ${next.toFixed(2)}x`);
            break;
          }
          case 'Enter': {
            e.preventDefault();
            const last = s.liveMessage.text || s.statusMessage;
            if (last && s.speechEnabled) void speech.speak(last);
            break;
          }
        }
        return; // 其余 Ctrl 组合不触发单键快捷键
      }

      const exploring = s.playbackMode === 'exploration';
      const step = e.shiftKey ? 0.08 : 0.02;

      // 探索指针每跨过一条网格线（0.1）就播报一次当前坐标
      const announceExploreCell = () => {
        const q = engine.exploration.query();
        const cx = gridCellUnits(q.x);
        const cy = gridCellUnits(q.y);
        const key = `${cx},${cy}`;
        if (exploreCellRef.current === key) return;
        exploreCellRef.current = key;
        if (s.speechEnabled && !s.tutorialActive) {
          void speech.speak(`${speakSignedInt(cx)}, ${speakSignedInt(cy)}`);
        }
      };

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (exploring) {
            engine.exploration.toggleSound();
          } else {
            pauseOrResume();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (exploring) {
            engine.exploration.move(-step, 0);
            announceExploreCell();
          } else prevSegment();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (exploring) {
            engine.exploration.move(step, 0);
            announceExploreCell();
          } else nextSegment();
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (exploring) {
            engine.exploration.move(0, step);
            announceExploreCell();
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (exploring) {
            engine.exploration.move(0, -step);
            announceExploreCell();
          }
          break;
        case 'Enter': {
          e.preventDefault();
          if (exploring) {
            const q = engine.exploration.query();
            const text = `${positionText(q.x, q.y)}${tl(q.onLine ? ', on a line' : ', not on a line', q.onLine ? '，在线条上' : '，不在线条上')}`;
            announce(text);
          } else if (s.currentPosition) {
            announce(positionText(s.currentPosition.x, s.currentPosition.y));
          } else {
            const shape = resolveShape(s);
            if (shape) announce(shapeSummary(shape));
          }
          break;
        }
        case 'r':
        case 'R':
          e.preventDefault();
          if (s.playbackMode === 'segment') replaySegment();
          else replay();
          break;
        case 'm':
        case 'M': {
          e.preventDefault();
          const order: PlaybackMode[] = ['continuous', 'segment', 'exploration'];
          const next = order[(order.indexOf(s.playbackMode) + 1) % order.length];
          setMode(next);
          break;
        }
        case 'e':
        case 'E':
          e.preventDefault();
          toggleExploration();
          break;
        case 's':
        case 'S': {
          e.preventDefault();
          const next = !s.snapEnabled;
          dispatch({ type: 'patch', patch: { snapEnabled: next } });
          announce(next ? t('Line snap on') : t('Line snap off'));
          break;
        }
        case 'f':
        case 'F':
          e.preventDefault();
          if (exploring) {
            if (!engine.exploration.autoFollow()) {
              announce(t('No line nearby to follow'));
            } else {
              announce(t('Following the line'));
            }
          }
          break;
        case 'v':
        case 'V': {
          e.preventDefault();
          const next = !s.vertexCueEnabled;
          dispatch({ type: 'patch', patch: { vertexCueEnabled: next } });
          announce(next ? t('Corner sounds on') : t('Corner sounds off'));
          break;
        }
        case 'i':
        case 'I': {
          e.preventDefault();
          const next = !s.intersectionCueEnabled;
          dispatch({ type: 'patch', patch: { intersectionCueEnabled: next } });
          announce(next ? t('Crossing sounds on') : t('Crossing sounds off'));
          break;
        }
        case 'c':
        case 'C': {
          e.preventDefault();
          const next = !s.closureCueEnabled;
          dispatch({ type: 'patch', patch: { closureCueEnabled: next } });
          announce(next ? t('Closing chime on') : t('Closing chime off'));
          break;
        }
        case 'l':
        case 'L': {
          e.preventDefault();
          const next = !s.loopEnabled;
          dispatch({ type: 'patch', patch: { loopEnabled: next } });
          announce(next ? t('Loop on') : t('Loop off'));
          break;
        }
        case '+':
        case '=': {
          e.preventDefault();
          const next = Math.min(3, Math.round((s.playbackSpeed + 0.15) * 100) / 100);
          dispatch({ type: 'patch', patch: { playbackSpeed: next } });
          announce(`Speed ${next.toFixed(2)}x`);
          break;
        }
        case '-':
        case '_': {
          e.preventDefault();
          const next = Math.max(0.25, Math.round((s.playbackSpeed - 0.15) * 100) / 100);
          dispatch({ type: 'patch', patch: { playbackSpeed: next } });
          announce(`Speed ${next.toFixed(2)}x`);
          break;
        }
        case '0':
          e.preventDefault();
          toggleMute();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          if (!s.tutorialActive) {
            dispatch({ type: 'patch', patch: { tutorialActive: true } });
          }
          break;
        case 'g':
        case 'G':
          if (s.helpOpen || s.tutorialActive) break;
          e.preventDefault();
          leavePlayback();
          dispatch({ type: 'patch', patch: { view: 'hand' } });
          announce(tl('Opened Hand Play', '已打开手势演奏'));
          break;
        case '?':
          e.preventDefault();
          dispatch({ type: 'patch', patch: { helpOpen: !s.helpOpen } });
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    engine,
    tutorial,
    dispatch,
    announce,
    leavePlayback,
    pauseOrResume,
    prevSegment,
    nextSegment,
    replay,
    replaySegment,
    setMode,
    toggleExploration,
    toggleMute,
  ]);

  return (
    <ActionsContext.Provider value={actions}>
      <div className="app">
        <header className="app-header">
          <h1>
            <span aria-hidden="true">🎵📐 </span>
            {t('Geometry Sound Lab')}
          </h1>
          <nav className="view-tabs" aria-label={t('Switch view')}>
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.id}
                aria-pressed={state.view === tab.id}
                onClick={() => {
                  leavePlayback();
                  dispatch({ type: 'patch', patch: { view: tab.id } });
                  announce(tl(`Opened ${tab.label}`, `已打开${t(tab.label)}`));
                }}
              >
                <span aria-hidden="true">{tab.emoji} </span>
                {t(tab.label)}
              </button>
            ))}
          </nav>
          <button
            aria-pressed={state.tutorialActive}
            onClick={() =>
              dispatch({ type: 'patch', patch: { tutorialActive: !state.tutorialActive } })
            }
          >
            <span aria-hidden="true">🎙️ </span>
            {t('Voice Tour')}
          </button>
          <button
            onClick={() => dispatch({ type: 'patch', patch: { helpOpen: true } })}
            aria-haspopup="dialog"
          >
            <span aria-hidden="true">⌨️ </span>
            {t('Keyboard Shortcuts')}
          </button>
        </header>

        {/* 图形库只在需要选图形的页面出现（播放 / 手势演奏），
            避免其他页面按 Space 误触图形播放 */}
        <div
          className={
            state.view === 'play' || state.view === 'hand' ? 'app-layout' : 'app-layout no-library'
          }
        >
          {(state.view === 'play' || state.view === 'hand') && <ShapeLibraryPanel />}
          <main className="center-area" aria-label={t('Shape and coordinate area')}>
            {state.view === 'play' && <CanvasView />}
            {state.view === 'editor' && <EditorPanel />}
            {state.view === 'lessons' && <LessonPanel />}
            {state.view === 'slope' && <SlopeComparePanel />}
            {state.view === 'hand' && <HandPanel />}
            {state.view === 'instrument' && <InstrumentPanel />}
          </main>
          <SettingsPanel />
        </div>

        <footer className="app-footer">
          {/* 播放控制栏只在图形播放页出现，其他页面有各自的操作入口 */}
          {state.view === 'play' && <ControlBar />}
          <StatusBar />
        </footer>

        <TutorialPanel controller={tutorial} />
        {state.welcomeOpen && <WelcomeDialog />}
        {state.helpOpen && <HelpDialog />}
        {state.errorMessage && (
          <div className="error-banner" role="alert">
            <span>{state.errorMessage}</span>
            <button onClick={() => dispatch({ type: 'error', message: null })}>{t('Close')}</button>
          </div>
        )}
      </div>
    </ActionsContext.Provider>
  );
}
