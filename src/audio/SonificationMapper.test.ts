import { describe, expect, it } from 'vitest';
import {
  clamp01,
  mapPosition,
  midiToFrequency,
  xToPan,
  yToMidi,
} from './SonificationMapper';

describe('pan mapping xToPan', () => {
  it('x = 0 maps to pan = -1 (far left)', () => {
    expect(xToPan(0)).toBe(-1);
  });

  it('x = 0.5 maps to pan = 0 (center)', () => {
    expect(xToPan(0.5)).toBe(0);
  });

  it('x = 1 maps to pan = 1 (far right)', () => {
    expect(xToPan(1)).toBe(1);
  });

  it('out-of-range x is clamped to 0..1', () => {
    expect(xToPan(-0.5)).toBe(-1);
    expect(xToPan(1.7)).toBe(1);
  });
});

describe('pitch mapping yToMidi', () => {
  it('y = 0 maps to the lowest MIDI pitch', () => {
    expect(yToMidi(0, 48, 84)).toBe(48);
  });

  it('y = 1 maps to the highest MIDI pitch', () => {
    expect(yToMidi(1, 48, 84)).toBe(84);
  });

  it('y = 0.5 maps to the middle pitch', () => {
    expect(yToMidi(0.5, 48, 84)).toBe(66);
  });

  it('out-of-range y is clamped to 0..1', () => {
    expect(yToMidi(-2, 48, 84)).toBe(48);
    expect(yToMidi(3, 48, 84)).toBe(84);
  });
});

describe('MIDI to frequency', () => {
  it('A4 (69) = 440 Hz', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 5);
  });

  it('A3 (57) = 220 Hz', () => {
    expect(midiToFrequency(57)).toBeCloseTo(220, 5);
  });

  it('C4 (60) ≈ 261.63 Hz', () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 1);
  });
});

describe('clamp01', () => {
  it('invalid numbers fall back to 0', () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
  });
});

describe('mapPosition combined mapping', () => {
  const settings = { minMidi: 48, maxMidi: 84, pitchMode: 'continuous' as const, scale: 'major' as const };

  it('bottom-left corner: pan=-1, lowest note', () => {
    const m = mapPosition(0, 0, settings);
    expect(m.pan).toBe(-1);
    expect(m.midi).toBe(48);
  });

  it('quantized mode snaps pitch to the scale', () => {
    const m = mapPosition(0.5, 0.5, { ...settings, pitchMode: 'quantized' });
    // yToMidi(0.5)=66 (F#4); nearest C-major notes are 65 (F) or 67 (G), the tie takes the lower 65
    expect(m.midi).toBe(65);
  });
});
