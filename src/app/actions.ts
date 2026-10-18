// Global actions context: components call playback, navigation, settings etc. via useActions()
import { createContext, useContext } from 'react';
import type { GeometryShape } from '../geometry/geometryTypes';
import type { CueType } from '../audio/CueSoundEngine';
import type { PlaybackMode } from '../state/store';

export interface AdhocPlayOptions {
  speedFactor?: number;
  segmented?: boolean;
}

export interface AppActions {
  selectShape(id: string): void;
  play(): void;
  pauseOrResume(): void;
  stopPlayback(): void;
  replay(): void;
  nextSegment(): void;
  prevSegment(): void;
  replaySegment(): void;
  setMode(mode: PlaybackMode): void;
  toggleExploration(): void;
  toggleMute(): void;
  previewCue(type: CueType): void;
  playAdhocShape(shape: GeometryShape, opts?: AdhocPlayOptions): void;
  announce(text: string, speakIt?: boolean): void;
  saveCustomShape(shape: GeometryShape): void;
  deleteCustomShape(id: string): void;
}

export const ActionsContext = createContext<AppActions | null>(null);

export function useActions(): AppActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions must be used inside ActionsContext.Provider');
  return ctx;
}
