// Audio engine: shared AudioContext, main voice (oscillator + pan + envelope), noise hint, buses and volume
export type Waveform = 'sine' | 'triangle' | 'softsquare';

export const WAVEFORM_LABELS: Record<Waveform, string> = {
  sine: 'Sine — pure and soft',
  triangle: 'Triangle — bright',
  softsquare: 'Soft square — mellow',
};

const FADE_IN_S = 0.03;
const GLIDE_S = 0.02;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private mainBus: GainNode | null = null;
  private cueBus: GainNode | null = null;

  private voiceOsc: OscillatorNode | null = null;
  private voiceFilter: BiquadFilterNode | null = null;
  private voiceGain: GainNode | null = null;
  private voicePanner: StereoPannerNode | null = null;

  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;

  private waveform: Waveform = 'sine';
  private volumes = { master: 0.8, main: 0.8, cue: 0.7 };
  private muted = false;
  private ducked = false;

  onError: ((message: string) => void) | null = null;

  /** Create or resume the AudioContext; on failure returns null and reports the error */
  ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {
          this.onError?.('Audio could not resume. Click any button and try again.');
        });
      }
      return this.ctx;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volumes.master;
      this.master.connect(this.ctx.destination);

      this.mainBus = this.ctx.createGain();
      this.mainBus.gain.value = this.volumes.main;
      this.mainBus.connect(this.master);

      this.cueBus = this.ctx.createGain();
      this.cueBus.gain.value = this.volumes.cue;
      this.cueBus.connect(this.master);

      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return this.ctx;
    } catch (err) {
      console.error('Failed to create AudioContext', err);
      this.onError?.('Could not start the audio system. Please check your sound settings and restart the app.');
      this.ctx = null;
      return null;
    }
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get cueDestination(): GainNode | null {
    return this.cueBus;
  }

  /** Master bus (under master volume and mute control) — attach point for the instrument-mode synth */
  get masterDestination(): GainNode | null {
    return this.master;
  }

  get voiceActive(): boolean {
    return this.voiceOsc !== null;
  }

  setWaveform(w: Waveform): void {
    this.waveform = w;
    if (this.voiceOsc && this.voiceFilter && this.ctx) {
      this.voiceOsc.type = w === 'softsquare' ? 'square' : w;
      this.voiceFilter.frequency.setTargetAtTime(
        w === 'softsquare' ? 1200 : 18000,
        this.ctx.currentTime,
        0.01,
      );
    }
  }

  setMasterVolume(v: number): void {
    this.volumes.master = Math.max(0, Math.min(1, v));
    this.applyMaster();
  }

  setMainVolume(v: number): void {
    this.volumes.main = Math.max(0, Math.min(1, v));
    if (this.mainBus && this.ctx) {
      this.mainBus.gain.setTargetAtTime(this.volumes.main, this.ctx.currentTime, 0.02);
    }
  }

  setCueVolume(v: number): void {
    this.volumes.cue = Math.max(0, Math.min(1, v));
    if (this.cueBus && this.ctx) {
      this.cueBus.gain.setTargetAtTime(this.volumes.cue, this.ctx.currentTime, 0.02);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private applyMaster(): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : this.volumes.master,
        this.ctx.currentTime,
        0.01,
      );
    }
  }

  /** Start the main voice; if already playing, glide smoothly to the new parameters */
  startVoice(frequency: number, pan: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.mainBus) return;

    if (this.voiceOsc) {
      this.updateVoice(frequency, pan);
      this.duckVoice(false);
      return;
    }

    const osc = ctx.createOscillator();
    osc.type = this.waveform === 'softsquare' ? 'square' : this.waveform;
    osc.frequency.value = frequency;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.waveform === 'softsquare' ? 1200 : 18000;
    filter.Q.value = 0.5;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.mainBus);
    osc.start();

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + FADE_IN_S); // fade in to avoid clicks

    this.voiceOsc = osc;
    this.voiceFilter = filter;
    this.voiceGain = gain;
    this.voicePanner = panner;
    this.ducked = false;
  }

  /** Glide smoothly to a new frequency and pan */
  updateVoice(frequency: number, pan: number, glide: number = GLIDE_S): void {
    if (!this.ctx || !this.voiceOsc || !this.voicePanner) return;
    const now = this.ctx.currentTime;
    this.voiceOsc.frequency.setTargetAtTime(Math.max(20, frequency), now, glide);
    this.voicePanner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, glide);
  }

  /** Temporarily duck the main voice during vertex pauses / pause (keeps the oscillator alive) */
  duckVoice(ducked: boolean): void {
    if (!this.ctx || !this.voiceGain) return;
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    const now = this.ctx.currentTime;
    this.voiceGain.gain.cancelScheduledValues(now);
    this.voiceGain.gain.setTargetAtTime(ducked ? 0.0001 : 1, now, 0.015);
  }

  stopVoice(fadeMs = 60): void {
    if (!this.ctx || !this.voiceOsc || !this.voiceGain) {
      this.voiceOsc = null;
      this.voiceGain = null;
      this.voicePanner = null;
      this.voiceFilter = null;
      return;
    }
    const osc = this.voiceOsc;
    const gain = this.voiceGain;
    const panner = this.voicePanner;
    const filter = this.voiceFilter;
    const now = this.ctx.currentTime;
    const fade = Math.max(0.02, fadeMs / 1000);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0.0001, now, fade / 3); // fade out to avoid clicks
    try {
      osc.stop(now + fade + 0.05);
    } catch {
      // already stopped
    }
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
        panner?.disconnect();
        filter?.disconnect();
      } catch {
        // already disconnected
      }
    };
    this.voiceOsc = null;
    this.voiceGain = null;
    this.voicePanner = null;
    this.voiceFilter = null;
    this.ducked = false;
  }

  /** Active exploration mode: soft noise hint when the pointer leaves the line */
  setNoiseActive(active: boolean): void {
    if (!active) {
      // Turning noise off must not create an AudioContext (cleanup paths may run with no audio)
      if (this.ctx && this.noiseGain) {
        this.noiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      }
      return;
    }
    const ctx = this.ensure();
    if (!ctx || !this.mainBus) return;
    if (active) {
      if (!this.noiseSource) {
        const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain);
        gain.connect(this.mainBus);
        src.start();
        this.noiseSource = src;
        this.noiseGain = gain;
      }
      this.noiseGain?.gain.setTargetAtTime(0.03, ctx.currentTime, 0.05);
    }
  }

  dispose(): void {
    this.stopVoice(20);
    try {
      this.noiseSource?.stop();
    } catch {
      // already stopped
    }
    this.noiseSource = null;
    this.noiseGain = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
