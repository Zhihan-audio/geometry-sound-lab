import { describe, expect, it } from 'vitest';
import {
  clamp01,
  mapPosition,
  midiToFrequency,
  xToPan,
  yToMidi,
} from './SonificationMapper';

describe('声像映射 xToPan', () => {
  it('x = 0 对应 pan = -1（最左）', () => {
    expect(xToPan(0)).toBe(-1);
  });

  it('x = 0.5 对应 pan = 0（中间）', () => {
    expect(xToPan(0.5)).toBe(0);
  });

  it('x = 1 对应 pan = 1（最右）', () => {
    expect(xToPan(1)).toBe(1);
  });

  it('超出范围的 x 被限制在 0..1', () => {
    expect(xToPan(-0.5)).toBe(-1);
    expect(xToPan(1.7)).toBe(1);
  });
});

describe('音高映射 yToMidi', () => {
  it('y = 0 对应最低 MIDI 音高', () => {
    expect(yToMidi(0, 48, 84)).toBe(48);
  });

  it('y = 1 对应最高 MIDI 音高', () => {
    expect(yToMidi(1, 48, 84)).toBe(84);
  });

  it('y = 0.5 对应中间音高', () => {
    expect(yToMidi(0.5, 48, 84)).toBe(66);
  });

  it('超出范围的 y 被限制在 0..1', () => {
    expect(yToMidi(-2, 48, 84)).toBe(48);
    expect(yToMidi(3, 48, 84)).toBe(84);
  });
});

describe('MIDI 转频率', () => {
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
  it('非法数值回退为 0', () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
  });
});

describe('mapPosition 综合映射', () => {
  const settings = { minMidi: 48, maxMidi: 84, pitchMode: 'continuous' as const, scale: 'major' as const };

  it('左下角：pan=-1，最低音', () => {
    const m = mapPosition(0, 0, settings);
    expect(m.pan).toBe(-1);
    expect(m.midi).toBe(48);
  });

  it('量化模式下音高吸附到音阶', () => {
    const m = mapPosition(0.5, 0.5, { ...settings, pitchMode: 'quantized' });
    // yToMidi(0.5)=66（F#4），C 大调最近音是 65（F）或 67（G），距离相同取较低的 65
    expect(m.midi).toBe(65);
  });
});
