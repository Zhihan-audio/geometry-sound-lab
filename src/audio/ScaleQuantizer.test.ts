import { describe, expect, it } from 'vitest';
import { quantizeMidi } from './ScaleQuantizer';

describe('scale quantization', () => {
  it('chromatic: quantizes to the nearest whole semitone', () => {
    expect(quantizeMidi(63.4, 'chromatic')).toBe(63);
    expect(quantizeMidi(63.6, 'chromatic')).toBe(64);
  });

  it('C major: 61.6 → 62 (D)', () => {
    expect(quantizeMidi(61.6, 'major')).toBe(62);
  });

  it('C major: 60 stays unchanged', () => {
    expect(quantizeMidi(60, 'major')).toBe(60);
  });

  it('C major: 61 is equidistant, takes the lower note (60)', () => {
    expect(quantizeMidi(61, 'major')).toBe(60);
  });

  it('pentatonic: 65.6 → 67 (G, the nearest pentatonic note)', () => {
    // pentatonic pitch classes {0,2,4,7,9}: 65.6 is 1.6 from 64 and 1.4 from 67 → 67
    expect(quantizeMidi(65.6, 'pentatonic')).toBe(67);
  });

  it('whole tone: 63.1 → 64', () => {
    expect(quantizeMidi(63.1, 'wholeTone')).toBe(64);
  });

  it('result always stays within the scale', () => {
    for (let m = 48; m <= 84; m += 0.37) {
      const q = quantizeMidi(m, 'pentatonic');
      expect([0, 2, 4, 7, 9]).toContain(((q % 12) + 12) % 12);
    }
  });
});
