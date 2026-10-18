// Data models for the instrument / composition pipeline:
// Geometry → Gesture → Performance → Theme → Variation → Composition

/** One raw input sample from pointer drag or hand tracking (grid coords 0..1, t in ms) */
export interface GestureSample {
  x: number;
  y: number;
  t: number;
}

/** Realtime features computed while the user is drawing */
export interface LiveFeatures {
  x: number;
  y: number;
  /** Smoothed speed in grid units per second */
  speed: number;
  /** Current heading in radians, null until enough movement */
  angle: number | null;
  /** Normalized curvature 0 (straight) .. 1 (tight curve) */
  curvature: number;
  /** Rising-edge event: a sharp direction change happened here */
  corner: boolean;
  /** Rising-edge event: the trace just returned to its starting point */
  closed: boolean;
}

/** Continuous synth-control parameters derived from LiveFeatures */
export interface InstrumentParams {
  midi: number;
  /** Index in the active scale note table (stable via hysteresis) */
  noteIndex: number;
  pan: number; // -0.75 .. 0.75
  gain: number; // 0..1 smoothed nonlinear dynamics
  brightness: number; // 0..1 filter openness
  modDepth: number; // 0..1 vibrato / spectral movement from curvature
  harmonic: number; // 0..1 secondary harmonic layer level
}

/** A note event inside a theme or variation; pitch = -1 means a rest */
export const REST = -1;

export interface MusicalTheme {
  /** MIDI note numbers; REST (-1) marks a musical rest */
  pitches: number[];
  /** Durations in beats (quantized) */
  durations: number[];
  /** Per-note dynamics 0..1 (from gesture speed) */
  velocities: number[];
  /** True where the gesture had a corner — phrase accents */
  accents: boolean[];
  /** Sign of each melodic step: -1 down, 0 flat, +1 up */
  contour: number[];
  /** Coarse geometry label, e.g. 'triangle-like', 'circle-like', 'open-curve' */
  geometryType: string;
  /** Deterministic seed derived from the geometry (not the gesture timing) */
  seed: number;
  scale: PerformanceScaleId;
  tonicMidi: number;
  bpm: number;
  closed: boolean;
}

export type VariationType =
  | 'transposition'
  | 'rhythmic'
  | 'fragmentation'
  | 'inversion'
  | 'retrograde'
  | 'ornamentation';

export interface MusicalVariation {
  sourceSeed: number;
  transformationType: VariationType;
  variationStrength: number;
  pitches: number[];
  durations: number[];
  velocities: number[];
  accents: boolean[];
}

export type CompositionSection =
  | 'intro'
  | 'theme'
  | 'variationA'
  | 'variationB'
  | 'development'
  | 'return'
  | 'coda';

export const COMPOSITION_ORDER: CompositionSection[] = [
  'intro',
  'theme',
  'variationA',
  'variationB',
  'development',
  'return',
  'coda',
];

/** The instrument view's interaction phase */
export type InstrumentPhase = 'draw' | 'captured' | 'theme' | 'composing';

export type PerformanceScaleId = 'dorian' | 'majorPentatonic' | 'minorPentatonic' | 'chromatic';

/** A remembered theme in the musical memory */
export interface StoredTheme {
  id: string;
  name: string;
  createdAt: number;
  theme: MusicalTheme;
}
