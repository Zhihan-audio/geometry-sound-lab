// 全局状态管理：React Context + useReducer
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { GeometryShape } from '../geometry/geometryTypes';
import { DEFAULT_SHAPE_ID, getLibraryShape } from '../geometry/shapeLibrary';
import type { ScaleId } from '../audio/ScaleQuantizer';
import type { Waveform } from '../audio/AudioEngine';
import type { PitchMode } from '../audio/SonificationMapper';
import type { PlaybackStatus } from '../audio/PlaybackScheduler';
import type { PerformanceScaleId } from '../instrument/models';
import {
  loadCustomShapes,
  loadPitchMigrated,
  loadRateMigrated,
  loadSettingsPatch,
  savePitchMigrated,
  saveRateMigrated,
  saveSettingsPatch,
} from './persistence';

import { setLocale, t, type Locale } from '../i18n';

export type PlaybackMode = 'continuous' | 'segment' | 'exploration';
export type ThemeId = 'light' | 'dark' | 'contrast';
export type ViewId = 'play' | 'editor' | 'lessons' | 'slope' | 'hand' | 'instrument';

export interface AppSettings {
  playbackSpeed: number;
  minMidi: number;
  maxMidi: number;
  pitchMode: PitchMode;
  selectedScale: ScaleId;
  waveform: Waveform;
  masterVolume: number;
  mainVoiceVolume: number;
  cueVolume: number;
  vertexPauseMs: number;
  vertexCueEnabled: boolean;
  intersectionCueEnabled: boolean;
  closureCueEnabled: boolean;
  loopEnabled: boolean;
  snapEnabled: boolean;
  speechEnabled: boolean;
  speechVoiceURI: string | null;
  speechRate: number;
  speakFocus: boolean;
  playDirection: 'clockwise' | 'counterclockwise';
  performanceScale: PerformanceScaleId;
  variationStrength: number;
  locale: Locale;
  theme: ThemeId;
  fontScale: number;
  lineWidth: number;
  hideVisuals: boolean;
  muted: boolean;
}

export interface AppState extends AppSettings {
  selectedShapeId: string | null;
  playbackMode: PlaybackMode;
  playbackStatus: PlaybackStatus;
  currentSegmentIndex: number;
  segmentCount: number;
  currentPosition: { x: number; y: number; pan: number; midi: number } | null;
  explorationPos: { x: number; y: number } | null;
  explorationOnLine: boolean;
  statusMessage: string;
  liveMessage: { text: string; id: number };
  view: ViewId;
  helpOpen: boolean;
  welcomeOpen: boolean;
  tutorialActive: boolean;
  errorMessage: string | null;
  customShapes: GeometryShape[];
}

export const defaultSettings: AppSettings = {
  playbackSpeed: 1,
  minMidi: 48,
  maxMidi: 84,
  pitchMode: 'quantized',
  selectedScale: 'major',
  waveform: 'sine',
  masterVolume: 0.8,
  mainVoiceVolume: 0.8,
  cueVolume: 0.7,
  vertexPauseMs: 150,
  vertexCueEnabled: true,
  intersectionCueEnabled: true,
  closureCueEnabled: true,
  loopEnabled: false,
  snapEnabled: true,
  speechEnabled: true,
  speechVoiceURI: null,
  speechRate: 1.5,
  speakFocus: true,
  playDirection: 'clockwise',
  performanceScale: 'dorian',
  variationStrength: 0.35,
  locale: 'en',
  theme: 'light',
  fontScale: 1,
  lineWidth: 2.5,
  hideVisuals: false,
  muted: false,
};

const SETTINGS_KEYS = Object.keys(defaultSettings) as (keyof AppSettings)[];

function sanitizeNumber(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

/** 从 localStorage 恢复设置，字段级校验，损坏时回退默认值 */
function restoreSettings(): AppSettings {
  const patch = loadSettingsPatch();
  const s: AppSettings = { ...defaultSettings };
  s.playbackSpeed = sanitizeNumber(patch.playbackSpeed, s.playbackSpeed, 0.25, 3);
  s.minMidi = Math.round(sanitizeNumber(patch.minMidi, s.minMidi, 24, 96));
  s.maxMidi = Math.round(sanitizeNumber(patch.maxMidi, s.maxMidi, 24, 108));
  if (s.maxMidi <= s.minMidi) {
    s.minMidi = defaultSettings.minMidi;
    s.maxMidi = defaultSettings.maxMidi;
  }
  // 音高默认改为音阶量化（听到的是音符变化而非连续频率滑动）；
  // 旧设置一次性迁移到新默认，之后仍尊重用户自己的选择
  if (loadPitchMigrated()) {
    if (patch.pitchMode === 'continuous' || patch.pitchMode === 'quantized') s.pitchMode = patch.pitchMode;
  } else {
    s.pitchMode = 'quantized';
    savePitchMigrated();
  }
  if (
    patch.selectedScale === 'chromatic' ||
    patch.selectedScale === 'major' ||
    patch.selectedScale === 'pentatonic' ||
    patch.selectedScale === 'wholeTone'
  ) {
    s.selectedScale = patch.selectedScale;
  }
  if (patch.waveform === 'sine' || patch.waveform === 'triangle' || patch.waveform === 'softsquare') {
    s.waveform = patch.waveform;
  }
  s.masterVolume = sanitizeNumber(patch.masterVolume, s.masterVolume, 0, 1);
  s.mainVoiceVolume = sanitizeNumber(patch.mainVoiceVolume, s.mainVoiceVolume, 0, 1);
  s.cueVolume = sanitizeNumber(patch.cueVolume, s.cueVolume, 0, 1);
  s.vertexPauseMs = Math.round(sanitizeNumber(patch.vertexPauseMs, s.vertexPauseMs, 0, 500));
  for (const key of [
    'vertexCueEnabled',
    'intersectionCueEnabled',
    'closureCueEnabled',
    'loopEnabled',
    'snapEnabled',
    'hideVisuals',
  ] as const) {
    if (typeof patch[key] === 'boolean') s[key] = patch[key] as boolean;
  }
  // 语音辅助设置：旧版设置（没有 speakFocus 字段）迁移为默认开启
  if (typeof patch.speakFocus === 'boolean') {
    s.speakFocus = patch.speakFocus;
    if (typeof patch.speechEnabled === 'boolean') s.speechEnabled = patch.speechEnabled;
  } else {
    s.speechEnabled = true;
  }
  if (typeof patch.speechVoiceURI === 'string' && patch.speechVoiceURI) {
    s.speechVoiceURI = patch.speechVoiceURI;
  }
  // 语音默认 1.5 倍速（盲人用户听力习惯更快）；旧设置一次性迁移，之后尊重用户选择
  if (loadRateMigrated()) {
    s.speechRate = sanitizeNumber(patch.speechRate, s.speechRate, 0.5, 3);
  } else {
    s.speechRate = 1.5;
    saveRateMigrated();
  }
  if (patch.playDirection === 'clockwise' || patch.playDirection === 'counterclockwise') {
    s.playDirection = patch.playDirection;
  }
  // 应用启动永远是英文界面；语言切换只在当次会话内生效
  s.locale = 'en';
  if (
    patch.performanceScale === 'dorian' ||
    patch.performanceScale === 'majorPentatonic' ||
    patch.performanceScale === 'minorPentatonic' ||
    patch.performanceScale === 'chromatic'
  ) {
    s.performanceScale = patch.performanceScale;
  }
  s.variationStrength = sanitizeNumber(patch.variationStrength, s.variationStrength, 0, 1);
  if (patch.theme === 'light' || patch.theme === 'dark' || patch.theme === 'contrast') {
    s.theme = patch.theme;
  }
  s.fontScale = sanitizeNumber(patch.fontScale, s.fontScale, 0.85, 1.6);
  s.lineWidth = sanitizeNumber(patch.lineWidth, s.lineWidth, 1, 6);
  return s;
}

function initialState(): AppState {
  const settings = restoreSettings();
  setLocale(settings.locale); // components read t() during first render
  const patch = loadSettingsPatch();
  const savedShapeId = typeof patch.selectedShapeId === 'string' ? patch.selectedShapeId : null;
  const customShapes = loadCustomShapes();
  const shapeExists =
    savedShapeId !== null &&
    (getLibraryShape(savedShapeId) !== undefined || customShapes.some((s) => s.id === savedShapeId));
  return {
    ...settings,
    selectedShapeId: shapeExists ? savedShapeId : DEFAULT_SHAPE_ID,
    playbackMode: 'continuous',
    playbackStatus: 'idle',
    currentSegmentIndex: 0,
    segmentCount: 0,
    currentPosition: null,
    explorationPos: null,
    explorationOnLine: false,
    statusMessage:
      'Welcome to Geometry Sound Lab! Press T for a voice tour, or put on your headphones and press Play.',
    liveMessage: { text: '', id: 0 },
    view: 'play',
    helpOpen: false,
    welcomeOpen: true,
    tutorialActive: false,
    errorMessage: null,
    customShapes,
  };
}

export type AppAction =
  | { type: 'patch'; patch: Partial<AppState> }
  | { type: 'announce'; text: string }
  | { type: 'status-text'; text: string }
  | { type: 'error'; message: string | null };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'announce':
      return {
        ...state,
        statusMessage: action.text,
        liveMessage: { text: action.text, id: state.liveMessage.id + 1 },
      };
    case 'status-text':
      return { ...state, statusMessage: action.text };
    case 'error':
      return {
        ...state,
        errorMessage: action.message,
        liveMessage: action.message
          ? { text: `${t('Error:')} ${action.message}`, id: state.liveMessage.id + 1 }
          : state.liveMessage,
      };
    default:
      return state;
  }
}

interface StoreValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  // 设置变化时持久化（含最近选择的图形）
  useEffect(() => {
    const toSave: Record<string, unknown> = {};
    for (const key of SETTINGS_KEYS) toSave[key] = state[key];
    toSave.selectedShapeId = state.selectedShapeId;
    const handle = setTimeout(() => saveSettingsPatch(toSave), 250);
    return () => clearTimeout(handle);
  }, [...SETTINGS_KEYS.map((k) => state[k]), state.selectedShapeId]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

/** 根据 id 在内置图形库和自定义图形中查找 */
export function resolveShape(state: AppState): GeometryShape | null {
  if (!state.selectedShapeId) return null;
  return (
    getLibraryShape(state.selectedShapeId) ??
    state.customShapes.find((s) => s.id === state.selectedShapeId) ??
    null
  );
}
