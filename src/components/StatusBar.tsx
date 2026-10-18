// Status bar and aria-live announcement area
import { useStore, resolveShape } from '../state/store';
import { formatUnits, midiToNoteName } from '../app/describe';
import { t, tl } from '../i18n';

const MODE_TEXT: Record<string, string> = {
  continuous: 'Continuous outline',
  segment: 'Edge by edge',
  exploration: 'Free exploration',
};

const STATUS_TEXT: Record<string, string> = {
  idle: 'Ready',
  playing: 'Playing',
  paused: 'Paused',
  stopped: 'Stopped',
};

export default function StatusBar() {
  const { state } = useStore();
  const shape = resolveShape(state);
  const pos = state.currentPosition;

  return (
    <div>
      <div className="status-bar">
        <span>
          {t('Shape')}: <strong>{shape ? t(shape.name) : t('None')}</strong>
        </span>
        <span>
          {t('Mode')}: <strong>{t(MODE_TEXT[state.playbackMode])}</strong>
        </span>
        <span>
          {t('Status')}: <strong>{t(STATUS_TEXT[state.playbackStatus])}</strong>
        </span>
        {state.segmentCount > 0 && (
          <span>
            {t('Edge')}:{' '}
            <strong>
              {state.currentSegmentIndex + 1} / {state.segmentCount}
            </strong>
          </span>
        )}
        {pos && (
          <>
            <span>
              {t('Position')}:{' '}
              <strong>
                ({formatUnits(pos.x)}, {formatUnits(pos.y)})
              </strong>
            </span>
            <span>
              {t('Pitch')}: <strong>{midiToNoteName(pos.midi)}</strong>
            </span>
            <span>
              {t('Pan')}:{' '}
              <strong>
                {pos.pan < -0.05 ? tl('left', '偏左') : pos.pan > 0.05 ? tl('right', '偏右') : tl('center', '居中')} {pos.pan.toFixed(2)}
              </strong>
            </span>
          </>
        )}
        {state.playbackMode === 'exploration' && (
          <span>
            {t('Pointer')}: <strong>{state.explorationOnLine ? t('on a line') : t('not on a line')}</strong>
          </span>
        )}
      </div>
      <div className="live-region" role="status" aria-live="polite" aria-atomic="true">
        <span key={state.liveMessage.id}>{state.liveMessage.text || state.statusMessage}</span>
      </div>
    </div>
  );
}
