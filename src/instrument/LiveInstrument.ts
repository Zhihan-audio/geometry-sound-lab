// The performance synthesizer for the instrument mode.
// One continuous voice follows the gesture (sine+triangle blend, subtle
// harmonic layer, low-pass filter, vibrato from curvature, small reverb).
// Corner accents, closure cadences and scheduled theme/composition notes all
// speak the same musical language — no UI beeps.
import { midiToFrequency } from '../audio/SonificationMapper';
import type { InstrumentParams } from './models';

export interface NoteOpts {
  midi: number;
  /** AudioContext time to start at */
  when: number;
  /** Duration in seconds */
  dur: number;
  /** Dynamics 0..1 */
  vel: number;
  pan?: number;
  /** 0..1 filter openness */
  bright?: number;
  accent?: boolean;
}

const PORTAMENTO = 0.03;
const PARAM_GLIDE = 0.04;

function cutoffFor(bright: number): number {
  return 250 + Math.pow(Math.max(0, Math.min(1, bright)), 1.4) * 4800;
}

/** Small synthetic room: stereo noise burst with exponential decay */
function makeImpulse(ctx: AudioContext, seconds = 1.3, decay = 2.8): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(seconds * rate);
  const buffer = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buffer;
}

interface VoiceNodes {
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  oscH: OscillatorNode;
  hGain: GainNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: StereoPannerNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  midi: number;
}

export class LiveInstrument {
  private bus: GainNode;
  private reverb: ConvolverNode;
  private reverbReturn: GainNode;
  private voice: VoiceNodes | null = null;
  private drone: { oscs: OscillatorNode[]; gain: GainNode } | null = null;
  private scheduled = new Set<{ stop: (at: number) => void }>();

  constructor(
    private ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.9;
    this.bus.connect(destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.3;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.bus);
  }

  now(): number {
    return this.ctx.currentTime;
  }

  // ---------- continuous performance voice ----------

  startVoice(p: InstrumentParams): void {
    if (this.voice) {
      this.updateVoice(p);
      return;
    }
    const ctx = this.ctx;
    const freq = midiToFrequency(p.midi);

    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = freq;
    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = freq;
    const oscH = ctx.createOscillator();
    oscH.type = 'sine';
    oscH.frequency.value = freq * 2;

    const aGain = ctx.createGain();
    aGain.gain.value = 0.68;
    const bGain = ctx.createGain();
    bGain.gain.value = 0.3;
    const hGain = ctx.createGain();
    hGain.gain.value = p.harmonic * 0.1;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffFor(p.brightness);
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    const panner = ctx.createStereoPanner();
    panner.pan.value = p.pan;

    const send = ctx.createGain();
    send.gain.value = 0.12 + p.modDepth * 0.08;

    // Vibrato LFO driven by curvature
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = p.modDepth * freq * 0.008;
    lfo.connect(lfoGain);
    lfoGain.connect(oscA.frequency);
    lfoGain.connect(oscB.frequency);

    oscA.connect(aGain);
    oscB.connect(bGain);
    oscH.connect(hGain);
    aGain.connect(filter);
    bGain.connect(filter);
    hGain.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.bus);
    panner.connect(send);
    send.connect(this.reverb);

    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(p.gain, t + 0.04);

    oscA.start();
    oscB.start();
    oscH.start();
    lfo.start();

    this.voice = { oscA, oscB, oscH, hGain, filter, gain, panner, lfo, lfoGain, midi: p.midi };
  }

  updateVoice(p: InstrumentParams): void {
    const v = this.voice;
    if (!v) return;
    const t = this.ctx.currentTime;
    const freq = midiToFrequency(p.midi);

    if (p.midi !== v.midi) {
      // Note change: short portamento glide plus a tiny articulation dip so
      // steps stay audible without a mechanical re-trigger
      v.oscA.frequency.setTargetAtTime(freq, t, PORTAMENTO);
      v.oscB.frequency.setTargetAtTime(freq, t, PORTAMENTO);
      v.oscH.frequency.setTargetAtTime(freq * 2, t, PORTAMENTO);
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(p.gain * 0.72, t, 0.012);
      v.gain.gain.setTargetAtTime(p.gain, t + 0.03, 0.03);
      v.midi = p.midi;
    } else {
      v.gain.gain.setTargetAtTime(p.gain, t, PARAM_GLIDE);
    }
    v.panner.pan.setTargetAtTime(p.pan, t, PARAM_GLIDE);
    v.filter.frequency.setTargetAtTime(cutoffFor(p.brightness), t, PARAM_GLIDE);
    v.hGain.gain.setTargetAtTime(p.harmonic * 0.1, t, PARAM_GLIDE);
    v.lfoGain.gain.setTargetAtTime(p.modDepth * freq * 0.008, t, 0.08);
  }

  stopVoice(releaseSec = 0.25): void {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0.0001, t, releaseSec / 3);
    const stopAt = t + releaseSec + 0.2;
    for (const osc of [v.oscA, v.oscB, v.oscH, v.lfo]) {
      try {
        osc.stop(stopAt);
      } catch {
        // already stopped
      }
    }
    v.oscA.onended = () => {
      try {
        v.gain.disconnect();
        v.panner.disconnect();
        v.filter.disconnect();
      } catch {
        // already disconnected
      }
    };
  }

  get voiceActive(): boolean {
    return this.voice !== null;
  }

  // ---------- musical events ----------

  /** Corner accent: a light in-key pluck (root + soft fifth) */
  playAccent(midi: number, pan = 0): void {
    const t = this.ctx.currentTime;
    this.pluck(midi, t, 0.5, pan);
    this.pluck(midi + 7, t + 0.012, 0.22, pan);
  }

  private pluck(midi: number, when: number, vel: number, pan: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFrequency(midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(vel * 0.5, when + 0.006);
    gain.gain.setTargetAtTime(0.0001, when + 0.02, 0.045);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.bus);
    const send = ctx.createGain();
    send.gain.value = 0.15;
    panner.connect(send);
    send.connect(this.reverb);
    osc.start(when);
    osc.stop(when + 0.5);
    osc.onended = () => {
      try {
        gain.disconnect();
        panner.disconnect();
        send.disconnect();
      } catch {
        // done
      }
    };
  }

  /**
   * Closure cadence: root → fifth → tonic chord. `third` is the scale's third
   * in semitones (3 for dorian/minor, 4 for major pentatonic).
   */
  playCadence(tonicMidi: number, third: number): void {
    const t = this.ctx.currentTime + 0.03;
    this.scheduleNote({ midi: tonicMidi, when: t, dur: 0.32, vel: 0.75, bright: 0.6 });
    this.scheduleNote({ midi: tonicMidi + 7, when: t + 0.34, dur: 0.32, vel: 0.8, bright: 0.65 });
    const chordAt = t + 0.7;
    this.scheduleNote({ midi: tonicMidi, when: chordAt, dur: 1.3, vel: 0.85, bright: 0.55 });
    this.scheduleNote({ midi: tonicMidi + third, when: chordAt, dur: 1.3, vel: 0.6, bright: 0.5 });
    this.scheduleNote({ midi: tonicMidi + 7, when: chordAt, dur: 1.3, vel: 0.65, bright: 0.5 });
    this.scheduleNote({ midi: tonicMidi + 12, when: chordAt + 0.05, dur: 1.25, vel: 0.4, bright: 0.6 });
  }

  // ---------- scheduled playback (theme & composition) ----------

  scheduleNote(opts: NoteOpts): void {
    const ctx = this.ctx;
    const { midi, when, dur } = opts;
    const vel = Math.max(0.05, Math.min(1, opts.vel));
    const pan = opts.pan ?? 0;
    const bright = opts.bright ?? 0.6;
    const freq = midiToFrequency(midi);

    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = freq;
    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = freq;
    const bGain = ctx.createGain();
    bGain.gain.value = 0.32;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffFor(bright) * (0.7 + vel * 0.5);
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    const send = ctx.createGain();
    send.gain.value = 0.13;

    const attack = opts.accent ? 0.008 : 0.028;
    const peak = vel * 0.72;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + attack);
    gain.gain.setTargetAtTime(peak * 0.72, when + attack, Math.max(0.05, dur * 0.3));
    gain.gain.setTargetAtTime(0.0001, when + dur * 0.78, Math.max(0.04, dur * 0.12));

    oscA.connect(filter);
    oscB.connect(bGain);
    bGain.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.bus);
    panner.connect(send);
    send.connect(this.reverb);

    oscA.start(when);
    oscB.start(when);
    const stopAt = when + dur + 0.4;
    oscA.stop(stopAt);
    oscB.stop(stopAt);

    const handle = {
      stop: (at: number) => {
        try {
          gain.gain.cancelScheduledValues(at);
          gain.gain.setTargetAtTime(0.0001, at, 0.03);
          oscA.stop(at + 0.15);
          oscB.stop(at + 0.15);
        } catch {
          // already stopped
        }
      },
    };
    this.scheduled.add(handle);
    oscA.onended = () => {
      this.scheduled.delete(handle);
      try {
        gain.disconnect();
        panner.disconnect();
        send.disconnect();
      } catch {
        // done
      }
    };
  }

  cancelScheduled(): void {
    const t = this.ctx.currentTime;
    for (const handle of [...this.scheduled]) handle.stop(t);
    this.scheduled.clear();
  }

  // ---------- drone ----------

  startDrone(midi: number): void {
    if (this.drone) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.bus);
    const send = ctx.createGain();
    send.gain.value = 0.2;
    gain.connect(send);
    send.connect(this.reverb);

    const freqs = [midiToFrequency(midi - 12), midiToFrequency(midi - 12) * 1.003];
    const oscs = freqs.map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(gain);
      o.start();
      return o;
    });
    const t = ctx.currentTime;
    gain.gain.setTargetAtTime(0.055, t, 0.5);
    this.drone = { oscs, gain };
  }

  stopDrone(fadeSec = 1.2): void {
    const d = this.drone;
    if (!d) return;
    this.drone = null;
    const t = this.ctx.currentTime;
    d.gain.gain.setTargetAtTime(0.0001, t, fadeSec / 3);
    for (const o of d.oscs) {
      try {
        o.stop(t + fadeSec + 0.3);
      } catch {
        // already stopped
      }
    }
  }

  /** Stop everything the instrument is sounding right now */
  silence(): void {
    this.stopVoice(0.12);
    this.cancelScheduled();
    this.stopDrone(0.3);
  }

  dispose(): void {
    this.silence();
    try {
      this.bus.disconnect();
      this.reverbReturn.disconnect();
    } catch {
      // done
    }
  }
}
