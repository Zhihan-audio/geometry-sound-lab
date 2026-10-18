// Bottom control bar
import { useStore } from '../state/store';
import { useActions } from '../app/actions';
import { t } from '../i18n';

export default function ControlBar() {
  const { state } = useStore();
  const actions = useActions();
  const exploring = state.playbackMode === 'exploration';
  const playing = state.playbackStatus === 'playing';
  const paused = state.playbackStatus === 'paused';

  return (
    <div className="control-bar" role="toolbar" aria-label="Playback controls">
      <button className="primary" onClick={actions.play} aria-keyshortcuts="Space" disabled={exploring}>
        <span aria-hidden="true">▶️ </span>
        {t('Play')}
      </button>
      <button onClick={actions.pauseOrResume} disabled={exploring || (!playing && !paused)}>
        <span aria-hidden="true">{paused ? '⏯️ ' : '⏸️ '}</span>
        {paused ? t('Resume') : t('Pause')}
      </button>
      <button onClick={actions.stopPlayback} aria-keyshortcuts="Escape" disabled={exploring}>
        <span aria-hidden="true">⏹️ </span>
        {t('Stop')}
      </button>
      <button onClick={actions.replay} aria-keyshortcuts="R" disabled={exploring}>
        <span aria-hidden="true">🔁 </span>
        {t('Replay')}
      </button>
      <button onClick={actions.prevSegment} aria-keyshortcuts="ArrowLeft" disabled={exploring}>
        <span aria-hidden="true">⬅️ </span>
        {t('Previous edge')}
      </button>
      <button onClick={actions.nextSegment} aria-keyshortcuts="ArrowRight" disabled={exploring}>
        <span aria-hidden="true">➡️ </span>
        {t('Next edge')}
      </button>
      <button onClick={actions.replaySegment} disabled={exploring || state.playbackMode !== 'segment'}>
        {t('Replay edge')}
      </button>
      <button onClick={actions.toggleExploration} aria-keyshortcuts="E" aria-pressed={exploring}>
        <span aria-hidden="true">🧭 </span>
        {exploring ? t('Exit exploring') : t('Start exploring')}
      </button>
      <button onClick={actions.toggleMute} aria-keyshortcuts="0" aria-pressed={state.muted}>
        <span aria-hidden="true">{state.muted ? '🔇 ' : '🔉 '}</span>
        {state.muted ? t('Unmute') : t('Mute now')}
      </button>
    </div>
  );
}
