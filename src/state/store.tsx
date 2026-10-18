// Global state management: React Context + useReducer
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

/** Restore settings from localStorage with per-field validation; corrupt values fall back to defaults */
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
  // Pitch now defaults to scale quantization (you hear note changes rather than a continuous frequency glide);
  // old settings migrate to the new default once, after which the user's own choice is respected
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
  // Speech-assist settings: legacy settings (without a speakFocus field) migrate to enabled by default
  if (typeof patch.speakFocus === 'boolean') {
    s.speakFocus = patch.speakFocus;
    if (typeof patch.speechEnabled === 'boolean') s.speechEnabled = patch.speechEnabled;
  } else {
    s.speechEnabled = true;
  }
  if (typeof patch.speechVoiceURI === 'string' && patch.speechVoiceURI) {
    s.speechVoiceURI = patch.speechVoiceURI;
  }
  // Speech defaults to 1.5x speed (blind users are used to faster speech); old settings migrate once, then the user's choice is respected
  if (loadRateMigrated()) {
    s.speechRate = sanitizeNumber(patch.speechRate, s.speechRate, 0.5, 3);
  } else {
    s.speechRate = 1.5;
    saveRateMigrated();
  }
  if (patch.playDirection === 'clockwise' || patch.playDirection === 'counterclockwise') {
    s.playDirection = patch.playDirection;
  }
  // The app always starts with the English UI; a language switch lasts only for the current session
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

  // Persist when settings change (including the most recently selected shape)
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

/** Look up a shape by id in the built-in library and the custom shapes */
export function resolveShape(state: AppState): GeometryShape | null {
  if (!state.selectedShapeId) return null;
  return (
    getLibraryShape(state.selectedShapeId) ??
    state.customShapes.find((s) => s.id === state.selectedShapeId) ??
    null
  );
}
