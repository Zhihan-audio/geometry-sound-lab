// Floating panel for the voice tour: shows the current step, task and controls
import { useEffect, useState } from 'react';
import type { TutorialController, TutorialPhase } from '../app/tutorial';
import { t, tl, tt } from '../i18n';

const PHASE_TEXT: Record<TutorialPhase, string> = {
  speaking: '🗣️ Speaking…',
  demo: '🎵 Listen…',
  task: '🙌 Your turn!',
  'idle-wait': 'Press N when you are ready',
};

export default function TutorialPanel({ controller }: { controller: TutorialController }) {
  const [snap, setSnap] = useState(() => controller.snapshot());

  useEffect(() => {
    const unsub = controller.subscribe(() => setSnap(controller.snapshot()));
    setSnap(controller.snapshot());
    return unsub;
  }, [controller]);

  if (!snap.active || !snap.step) return null;

  const blurAnd = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    fn();
    e.currentTarget.blur();
  };

  return (
    <section className="tutorial-panel" role="region" aria-label={t('Voice tour')}>
      <p className="tutorial-step-count">
        <span aria-hidden="true">🎙️ </span>
        {tl(
          `Voice Tour — Step ${snap.index + 1} of ${snap.total}`,
          `语音教学 — 第 ${snap.index + 1} 步，共 ${snap.total} 步`,
        )}
      </p>
      <h3>{tt(snap.step.title)}</h3>
      <p className="tutorial-narration">{tt(snap.step.narration)}</p>
      {snap.step.task && (
        <p className="tutorial-task">
          <span aria-hidden="true">👉 </span>
          {tt(snap.step.task.label)}
          {snap.taskDone ? ` ${t('✓ Done!')}` : ''}
        </p>
      )}
      <p className="tutorial-phase" aria-hidden="true">
        {snap.taskDone ? t('✓ Great job — press N to continue') : t(PHASE_TEXT[snap.phase])}
      </p>
      <div className="tutorial-buttons">
        <button onClick={blurAnd(() => controller.repeat())} aria-keyshortcuts="H">
          {t('Hear again (H)')}
        </button>
        <button
          onClick={blurAnd(() => controller.prev())}
          aria-keyshortcuts="P"
          disabled={snap.index === 0}
        >
          {t('Back (P)')}
        </button>
        <button className="primary" onClick={blurAnd(() => controller.next())} aria-keyshortcuts="N">
          {snap.index === snap.total - 1 ? t('Finish (N)') : t('Next (N)')}
        </button>
        <button onClick={blurAnd(() => controller.exit())} aria-keyshortcuts="Escape">
          {t('Exit tour (Esc)')}
        </button>
      </div>
    </section>
  );
}
