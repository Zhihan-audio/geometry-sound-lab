// Cue sound engine: start, end, vertex, intersection, closure, error, quiz right/wrong
import type { AudioEngine } from './AudioEngine';

export type CueType =
  | 'start'
  | 'end'
  | 'vertex'
  | 'intersection'
  | 'closure'
  | 'error'
  | 'correct'
  | 'wrong';

export const CUE_LABELS: Record<CueType, string> = {
  start: 'Start sound',
  end: 'Finish sound',
  vertex: 'Corner click',
  intersection: 'Crossing pulse',
  closure: 'Closing chime',
  error: 'Error sound',
  correct: 'Correct! sound',
  wrong: 'Try-again sound',
};

interface Blip {
  freq: number;
  at: number; // seconds, relative to now
  dur: number;
  type: OscillatorType;
  peak?: number;
}

export class CueSoundEngine {
  constructor(private audio: AudioEngine) {}

  play(type: CueType, pan = 0): void {
    const ctx = this.audio.ensure();
    const dest = this.audio.cueDestination;
    if (!ctx || !dest) return;

    const blips = this.designFor(type);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(dest);

    const now = ctx.currentTime + 0.005;
    for (const b of blips) {
      const osc = ctx.createOscillator();
      osc.type = b.type;
      osc.frequency.value = b.freq;
      const gain = ctx.createGain();
      const peak = b.peak ?? 0.5;
      const t0 = now + b.at;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.008);
      gain.gain.setTargetAtTime(0.0001, t0 + b.dur * 0.55, b.dur * 0.22);
      osc.connect(gain);
      gain.connect(panner);
      osc.start(t0);
      osc.stop(t0 + b.dur + 0.25);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          // already disconnected
        }
      };
    }
  }

  // Cue sounds are spread apart in register, rhythm and timbre at once, so they can be told apart by ear alone:
  // error (very low 87-110Hz) < wrong (low-mid 262-392) < start/end (440-880 octave) <
  // intersection (587 sawtooth double pulse) < closure (523-1047 octave arpeggio) < correct (784-1568 octave leap) < vertex (very high 2093)
  private designFor(type: CueType): Blip[] {
    switch (type) {
      case 'start':
        // Rising perfect octave: get ready to start
        return [
          { freq: 440, at: 0, dur: 0.09, type: 'sine' },
          { freq: 880, at: 0.11, dur: 0.1, type: 'sine' },
        ];
      case 'end':
        // Falling perfect octave: plain ending (mirror image of the start cue)
        return [
          { freq: 880, at: 0, dur: 0.09, type: 'sine' },
          { freq: 440, at: 0.11, dur: 0.12, type: 'sine' },
        ];
      case 'vertex':
        // Single short very-high click (the highest of all cue sounds)
        return [{ freq: 2093, at: 0, dur: 0.045, type: 'triangle', peak: 0.55 }];
      case 'intersection':
        // Mid-register sawtooth double pulse: register and timbre both far from the vertex cue
        return [
          { freq: 587.33, at: 0, dur: 0.04, type: 'sawtooth', peak: 0.32 },
          { freq: 587.33, at: 0.075, dur: 0.04, type: 'sawtooth', peak: 0.32 },
        ];
      case 'closure':
        // Three-note rising arpeggio across a full octave: the shape has closed
        return [
          { freq: 523.25, at: 0, dur: 0.1, type: 'sine' },
          { freq: 783.99, at: 0.1, dur: 0.1, type: 'sine' },
          { freq: 1046.5, at: 0.2, dur: 0.18, type: 'sine' },
        ];
      case 'error':
        // Very deep double thud (the lowest of all cue sounds)
        return [
          { freq: 110, at: 0, dur: 0.14, type: 'square', peak: 0.28 },
          { freq: 87.31, at: 0.17, dur: 0.2, type: 'square', peak: 0.28 },
        ];
      case 'correct':
        // Bright rising octave leap
        return [
          { freq: 783.99, at: 0, dur: 0.1, type: 'triangle' },
          { freq: 1567.98, at: 0.11, dur: 0.16, type: 'triangle' },
        ];
      case 'wrong':
        // Gentle falling perfect fifth in the low-mid register
        return [
          { freq: 392, at: 0, dur: 0.12, type: 'triangle', peak: 0.4 },
          { freq: 261.63, at: 0.14, dur: 0.16, type: 'triangle', peak: 0.4 },
        ];
    }
  }
}
