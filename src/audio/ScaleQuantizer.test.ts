import { describe, expect, it } from 'vitest';
import { quantizeMidi } from './ScaleQuantizer';

describe('音阶量化', () => {
  it('半音阶：量化到最近的整数半音', () => {
    expect(quantizeMidi(63.4, 'chromatic')).toBe(63);
    expect(quantizeMidi(63.6, 'chromatic')).toBe(64);
  });

  it('C 大调：61.6 → 62（D）', () => {
    expect(quantizeMidi(61.6, 'major')).toBe(62);
  });

  it('C 大调：60 保持不变', () => {
    expect(quantizeMidi(60, 'major')).toBe(60);
  });

  it('C 大调：61 等距时取较低的音（60）', () => {
    expect(quantizeMidi(61, 'major')).toBe(60);
  });

  it('五声音阶：65.6 → 67（G，最近的五声音）', () => {
    // 五声音阶音级 {0,2,4,7,9}：65.6 与 64 差 1.6，与 67 差 1.4 → 67
    expect(quantizeMidi(65.6, 'pentatonic')).toBe(67);
  });

  it('全音音阶：63.1 → 64', () => {
    expect(quantizeMidi(63.1, 'wholeTone')).toBe(64);
  });

  it('结果始终在音阶内', () => {
    for (let m = 48; m <= 84; m += 0.37) {
      const q = quantizeMidi(m, 'pentatonic');
      expect([0, 2, 4, 7, 9]).toContain(((q % 12) + 12) % 12);
    }
  });
});
