// Composition engine: turns one theme into a short structured piece —
//   INTRO → THEME → VARIATION A → VARIATION B → DEVELOPMENT → RETURN → CODA
// The plan builder is pure and deterministic (seeded by the theme's geometry
// seed); the performer schedules it through the LiveInstrument.
import type {
  CompositionSection,
  MusicalTheme,
  MusicalVariation,
} from './models';
import { COMPOSITION_ORDER, REST } from './models';
import { PERFORMANCE_SCALES } from './scales';
import { generateVariation, mulberry32 } from './VariationEngine';
import { themeBeats } from './ThemeExtractor';
import type { NoteOpts } from './LiveInstrument';

export interface PlannedNote {
  midi: number;
  /** Beat offset from the section start */
  beat: number;
  /** Duration in beats */
  dur: number;
  vel: number;
  accent: boolean;
  pan: number;
  bright: number;
}

export interface PlannedSection {
  section: CompositionSection;
  /** Beat offset from the start of the piece */
  startBeat: number;
  beats: number;
  notes: PlannedNote[];
  /** Whether the tonic drone sounds under this section */
  drone: boolean;
}

export interface CompositionPlan {
  sections: PlannedSection[];
  totalBeats: number;
  totalSeconds: number;
  bpm: number;
  tonicMidi: number;
  /** The scale's third in semitones (for the final cadence chord) */
  third: number;
}

const SECTION_GAP_BEATS = 0.5;
const DEV_MAX_BEATS = 24;

interface Seq {
  pitches: number[];
  durations: number[];
  velocities: number[];
  accents: boolean[];
}

function seqToNotes(seq: Seq, rng: () => number, velScale: number, bright: number): PlannedNote[] {
  const notes: PlannedNote[] = [];
  let beat = 0;
  for (let i = 0; i < seq.pitches.length; i++) {
    const p = seq.pitches[i];
    if (p !== REST) {
      notes.push({
        midi: p,
        beat,
        dur: seq.durations[i],
        vel: Math.min(1, seq.velocities[i] * velScale),
        accent: seq.accents[i],
        pan: (rng() - 0.5) * 0.3, // gentle spatial life, never wide
        bright,
      });
    }
    beat += seq.durations[i];
  }
  return notes;
}

function seqBeats(seq: Seq): number {
  return seq.durations.reduce((a, b) => a + b, 0);
}

function variationToSeq(v: MusicalVariation): Seq {
  return {
    pitches: v.pitches,
    durations: v.durations,
    velocities: v.velocities,
    accents: v.accents,
  };
}

/** Trim a sequence so it does not exceed maxBeats (development safety cap) */
function capSeq(seq: Seq, maxBeats: number): Seq {
  let total = 0;
  let cut = seq.pitches.length;
  for (let i = 0; i < seq.durations.length; i++) {
    total += seq.durations[i];
    if (total > maxBeats) {
      cut = i + 1;
      break;
    }
  }
  return {
    pitches: seq.pitches.slice(0, cut),
    durations: seq.durations.slice(0, cut),
    velocities: seq.velocities.slice(0, cut),
    accents: seq.accents.slice(0, cut),
  };
}

/**
 * Build the whole piece as a deterministic plan.
 * Same theme (same geometry seed) → same composition.
 */
export function buildCompositionPlan(theme: MusicalTheme, strength = 0.35): CompositionPlan {
  const rng = mulberry32(theme.seed);
  const tonic = theme.tonicMidi;
  const third = PERFORMANCE_SCALES[theme.scale][2] ?? 4;
  const themeSeq: Seq = {
    pitches: theme.pitches,
    durations: theme.durations,
    velocities: theme.velocities,
    accents: theme.accents,
  };

  // --- INTRO: tonic drone + very light texture ---
  const intro: PlannedSection = {
    section: 'intro',
    startBeat: 0,
    beats: 6,
    drone: true,
    notes: [
      { midi: tonic, beat: 0.5, dur: 2, vel: 0.4, accent: false, pan: 0, bright: 0.4 },
      { midi: tonic + 7, beat: 3, dur: 1.5, vel: 0.35, accent: false, pan: 0.15, bright: 0.42 },
      { midi: tonic + 12, beat: 4.75, dur: 1, vel: 0.3, accent: false, pan: -0.15, bright: 0.45 },
    ],
  };

  // --- THEME: the user's geometry, clean and simple ---
  const themeNotes = seqToNotes(themeSeq, rng, 1, 0.62);

  // --- VARIATION A: transposition + one small rhythmic change ---
  const varA = variationToSeq(generateVariation(theme, 'transposition', strength * 0.8, rng));
  if (varA.durations.length >= 3) {
    const at = 1 + Math.floor(rng() * (varA.durations.length - 2));
    const d = varA.durations[at];
    varA.durations[at] = varA.durations[at + 1] ?? d;
    if (varA.durations[at + 1] !== undefined) varA.durations[at + 1] = d;
  }

  // --- VARIATION B: fragmentation + register change ---
  const varB = variationToSeq(generateVariation(theme, 'fragmentation', strength, rng));
  varB.pitches = varB.pitches.map((p) => (p !== REST && p <= tonic + 24 ? p + 12 : p));

  // --- DEVELOPMENT: fragmentation + inversion material, displaced, densest ---
  const devFrag = variationToSeq(
    generateVariation(theme, 'fragmentation', Math.min(1, strength + 0.25), rng),
  );
  const devInv = variationToSeq(generateVariation(theme, 'inversion', strength, rng));
  const development = capSeq(
    {
      pitches: [...devFrag.pitches, ...devInv.pitches],
      durations: [...devFrag.durations, ...devInv.durations],
      velocities: [...devFrag.velocities.map((v) => Math.min(1, v * 1.08)), ...devInv.velocities],
      accents: [...devFrag.accents, ...devInv.accents],
    },
    DEV_MAX_BEATS,
  );
  const devNotes = seqToNotes(development, rng, 1, 0.7).map((n) => ({
    ...n,
    beat: n.beat + 0.25, // rhythmic displacement off the downbeat
  }));
  // Sparse low pedal keeps the development anchored to the tonic
  const devBeats = seqBeats(development) + 0.5;
  for (let b = 0; b < devBeats - 1; b += 4) {
    devNotes.push({ midi: tonic - 12, beat: b, dur: 1.5, vel: 0.3, accent: false, pan: 0, bright: 0.35 });
  }

  // --- RETURN: the theme again, softer — the geometry comes home ---
  const returnNotes = seqToNotes(themeSeq, rng, 0.85, 0.5);

  // --- CODA: last important pitch → fifth → tonic resolution, drone fades ---
  const lastPitch = [...theme.pitches].reverse().find((p) => p !== REST) ?? tonic;
  const coda: PlannedNote[] = [
    { midi: lastPitch, beat: 0, dur: 1, vel: 0.5, accent: false, pan: 0, bright: 0.45 },
    { midi: tonic + 7, beat: 1.25, dur: 1.5, vel: 0.45, accent: false, pan: 0.1, bright: 0.4 },
    { midi: tonic, beat: 3, dur: 4, vel: 0.5, accent: false, pan: 0, bright: 0.35 },
    { midi: tonic + third, beat: 3.05, dur: 4, vel: 0.35, accent: false, pan: -0.12, bright: 0.32 },
    { midi: tonic + 7, beat: 3.1, dur: 4, vel: 0.32, accent: false, pan: 0.12, bright: 0.32 },
  ];

  const sectionSeqs: { section: CompositionSection; notes: PlannedNote[]; beats: number; drone: boolean }[] = [
    { section: 'intro', notes: intro.notes, beats: intro.beats, drone: true },
    { section: 'theme', notes: themeNotes, beats: themeBeats(theme), drone: false },
    { section: 'variationA', notes: seqToNotes(varA, rng, 0.95, 0.6), beats: seqBeats(varA), drone: false },
    { section: 'variationB', notes: seqToNotes(varB, rng, 0.95, 0.66), beats: seqBeats(varB), drone: false },
    { section: 'development', notes: devNotes, beats: devBeats, drone: false },
    { section: 'return', notes: returnNotes, beats: themeBeats(theme), drone: false },
    { section: 'coda', notes: coda, beats: 8, drone: true },
  ];

  const sections: PlannedSection[] = [];
  let cursor = 0;
  for (const s of sectionSeqs) {
    sections.push({ ...s, startBeat: cursor });
    cursor += s.beats + SECTION_GAP_BEATS;
  }
  const totalBeats = cursor;
  return {
    sections,
    totalBeats,
    totalSeconds: (totalBeats * 60) / theme.bpm,
    bpm: theme.bpm,
    tonicMidi: tonic,
    third,
  };
}

// ---------- performer ----------

export interface InstrumentLike {
  now(): number;
  scheduleNote(opts: NoteOpts): void;
  startDrone(midi: number): void;
  stopDrone(fadeSec?: number): void;
  cancelScheduled(): void;
}

export type CompositionEvent =
  | { type: 'section'; section: CompositionSection; index: number; total: number }
  | { type: 'finished' }
  | { type: 'stopped' };

const LEAD_IN_SEC = 0.2;

export class CompositionPerformer {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private playing = false;
  private listeners = new Set<(e: CompositionEvent) => void>();

  constructor(private instrument: InstrumentLike) {}

  subscribe(fn: (e: CompositionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: CompositionEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  play(plan: CompositionPlan): void {
    this.stop(false);
    this.playing = true;
    const spb = 60 / plan.bpm;
    const t0 = this.instrument.now() + LEAD_IN_SEC;

    // Schedule every note at its absolute AudioContext time
    for (const section of plan.sections) {
      for (const note of section.notes) {
        this.instrument.scheduleNote({
          midi: note.midi,
          when: t0 + (section.startBeat + note.beat) * spb,
          dur: note.dur * spb,
          vel: note.vel,
          pan: note.pan,
          bright: note.bright,
          accent: note.accent,
        });
      }
    }

    // Drive drone transitions and UI/announcement events on a wall-clock timeline
    plan.sections.forEach((section, i) => {
      const atMs = (LEAD_IN_SEC + section.startBeat * spb) * 1000;
      this.timers.push(
        setTimeout(() => {
          this.emit({ type: 'section', section: section.section, index: i, total: plan.sections.length });
          if (section.drone) this.instrument.startDrone(plan.tonicMidi);
          else this.instrument.stopDrone(1.0);
        }, atMs),
      );
    });

    this.timers.push(
      setTimeout(
        () => {
          this.instrument.stopDrone(1.5);
          this.playing = false;
          this.emit({ type: 'finished' });
        },
        (LEAD_IN_SEC + plan.totalBeats * spb + 1.5) * 1000,
      ),
    );
  }

  stop(emitEvent = true): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.playing) {
      this.instrument.cancelScheduled();
      this.instrument.stopDrone(0.4);
      this.playing = false;
      if (emitEvent) this.emit({ type: 'stopped' });
    }
  }
}

/** Section labels for display / announcements */
export const SECTION_LABELS: Record<CompositionSection, { en: string; zh: string }> = {
  intro: { en: 'Intro', zh: '引子' },
  theme: { en: 'Theme', zh: '主题' },
  variationA: { en: 'Variation A', zh: '变奏 A' },
  variationB: { en: 'Variation B', zh: '变奏 B' },
  development: { en: 'Development', zh: '发展' },
  return: { en: 'Return', zh: '再现' },
  coda: { en: 'Coda', zh: '尾声' },
};

export { COMPOSITION_ORDER };
