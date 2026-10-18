// Globally shared audio engine singleton: the whole app creates only one AudioContext
import { AudioEngine } from '../audio/AudioEngine';
import { CueSoundEngine } from '../audio/CueSoundEngine';
import { PlaybackScheduler, type SchedulerSettings } from '../audio/PlaybackScheduler';
import { ExplorationEngine, type ExplorationSettings } from '../audio/ExplorationEngine';
import type { AppSettings } from '../state/store';

export interface EngineBundle {
  audio: AudioEngine;
  cues: CueSoundEngine;
  scheduler: PlaybackScheduler;
  exploration: ExplorationEngine;
}

/** React syncs here on every render; engines read the latest settings live via getters */
export const engineSettings: { current: AppSettings } = {
  current: {
    playbackSpeed: 1,
    minMidi: 48,
    maxMidi: 84,
    pitchMode: 'quantized',
    selectedScale: 'major',
    waveform: 'sine',
    masterVolume: 0.8,
    mainVoiceVolume: 0.8,
    cueVolume: 0.7,
    vertexPauseMs: 150,
    vertexCueEnabled: true,
    intersectionCueEnabled: true,
    closureCueEnabled: true,
    loopEnabled: false,
    snapEnabled: true,
    speechEnabled: true,
    speechVoiceURI: null,
    speechRate: 1.5,
    speakFocus: true,
    playDirection: 'clockwise',
    performanceScale: 'dorian',
    variationStrength: 0.35,
    locale: 'en',
    theme: 'light',
    fontScale: 1,
    lineWidth: 2.5,
    hideVisuals: false,
    muted: false,
  },
};

function toSchedulerSettings(): SchedulerSettings {
  const s = engineSettings.current;
  return {
    speed: s.playbackSpeed,
    vertexPauseMs: s.vertexPauseMs,
    vertexCueEnabled: s.vertexCueEnabled,
    intersectionCueEnabled: s.intersectionCueEnabled,
    closureCueEnabled: s.closureCueEnabled,
    loopEnabled: s.loopEnabled,
    pitch: {
      minMidi: s.minMidi,
      maxMidi: s.maxMidi,
      pitchMode: s.pitchMode,
      scale: s.selectedScale,
    },
  };
}

function toExplorationSettings(): ExplorationSettings {
  const s = engineSettings.current;
  return {
    speed: s.playbackSpeed,
    snapEnabled: s.snapEnabled,
    pitch: {
      minMidi: s.minMidi,
      maxMidi: s.maxMidi,
      pitchMode: s.pitchMode,
      scale: s.selectedScale,
    },
  };
}

let bundle: EngineBundle | null = null;

export function getEngine(): EngineBundle {
  if (!bundle) {
    const audio = new AudioEngine();
    const cues = new CueSoundEngine(audio);
    const scheduler = new PlaybackScheduler(audio, cues, toSchedulerSettings);
    const exploration = new ExplorationEngine(audio, cues, toExplorationSettings);
    bundle = { audio, cues, scheduler, exploration };
  }
  return bundle;
}

export function disposeEngine(): void {
  if (bundle) {
    bundle.scheduler.stop();
    bundle.exploration.stop();
    bundle.audio.dispose();
    bundle = null;
  }
}
