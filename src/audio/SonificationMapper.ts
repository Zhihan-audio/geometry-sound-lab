// Coordinate → sound parameter mapping: x→pan, y→MIDI pitch→frequency
import { quantizeMidi, type ScaleId } from './ScaleQuantizer';

export const DEFAULT_MIN_MIDI = 48;
export const DEFAULT_MAX_MIDI = 84;

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** x: 0..1 → pan: -1..1 (-1 far left, 0 center, 1 far right) */
export function xToPan(x: number): number {
  return clamp01(x) * 2 - 1;
}

/** y: 0..1 → MIDI pitch (y=0 lowest note, y=1 highest note) */
export function yToMidi(y: number, minMidi: number, maxMidi: number): number {
  const lo = Math.min(minMidi, maxMidi);
  const hi = Math.max(minMidi, maxMidi);
  return lo + clamp01(y) * (hi - lo);
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export type PitchMode = 'continuous' | 'quantized';

export interface PitchSettings {
  minMidi: number;
  maxMidi: number;
  pitchMode: PitchMode;
  scale: ScaleId;
}

export interface MappedSound {
  pan: number;
  midi: number;
  frequency: number;
}

export function mapPosition(x: number, y: number, settings: PitchSettings): MappedSound {
  const pan = xToPan(x);
  let midi = yToMidi(y, settings.minMidi, settings.maxMidi);
  if (settings.pitchMode === 'quantized') {
    midi = quantizeMidi(midi, settings.scale);
  }
  return { pan, midi, frequency: midiToFrequency(midi) };
}
