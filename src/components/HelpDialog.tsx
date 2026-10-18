// Keyboard shortcuts help dialog — self-voicing: Up/Down arrows read each shortcut aloud
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { speech } from '../app/speech';
import { getLocale, t, tl } from '../i18n';

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play or pause; toggle sound while exploring'],
  ['Ctrl', 'Stop speech right away'],
  ['Ctrl + Enter', 'Repeat the last announcement'],
  ['Ctrl + ← / →', 'Switch playback mode'],
  ['Ctrl + ↑ / ↓', 'Speed up / slow down'],
  ['R', 'Replay (in edge-by-edge mode, replay the current edge)'],
  ['Escape', 'Stop, exit exploration, or close a dialog'],
  ['←', 'Previous edge; move left while exploring'],
  ['→', 'Next edge; move right while exploring'],
  ['↑', 'Move up while exploring'],
  ['↓', 'Move down while exploring'],
  ['Shift + arrows', 'Move faster while exploring'],
  ['Enter', 'Ask “where am I?”'],
  ['M', 'Switch playback mode'],
  ['E', 'Start or exit free exploration'],
  ['S', 'Toggle line snap'],
  ['F', 'Follow the nearest line automatically'],
  ['V', 'Corner sounds on / off'],
  ['I', 'Crossing sounds on / off'],
  ['C', 'Closing chime on / off'],
  ['L', 'Loop playback on / off'],
  ['+ / -', 'Speed up / slow down'],
  ['0', 'Mute / unmute'],
  ['T', 'Start the voice tour'],
  ['G', 'Open Hand Play (camera hand tracking)'],
  ['Escape (Instrument)', 'Stop the performance or composition'],
  ['N (Instrument)', 'Clear the drawn shape and start over'],
  ['Space / 1-4 (Practice)', 'Hear the sound / answer with numbers'],
  ['P / H / Enter (Practice)', 'Repeat question / hear why / next question'],
  ['N / P / H', 'During the tour: next / previous / hear again'],
  ['?', 'Open or close this help'],
];

/** Turn a key label like "Ctrl + ← / →" into words the voice can read naturally */
function speakableKey(key: string): string {
  const zh = getLocale() === 'zh';
  return key
    .replaceAll('+ / -', zh ? '加号键或减号键' : 'plus or minus')
    .replaceAll('←', zh ? '左方向键' : 'left arrow')
    .replaceAll('→', zh ? '右方向键' : 'right arrow')
    .replaceAll('↑', zh ? '上方向键' : 'up arrow')
    .replaceAll('↓', zh ? '下方向键' : 'down arrow')
    .replaceAll('?', zh ? '问号键' : 'question mark')
    .replaceAll('arrows', zh ? '方向键' : 'arrows')
    .replaceAll('(Instrument)', zh ? '，乐器模式下' : ', in Instrument mode')
    .replaceAll(' / ', zh ? ' 或 ' : ' or ');
}

export default function HelpDialog() {
  const { state, dispatch } = useStore();
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const [cursor, setCursor] = useState(-1);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const speechOnRef = useRef(state.speechEnabled);
  speechOnRef.current = state.speechEnabled;

  // Move focus into the dialog on open; restore it on close (VoiceOver-friendly).
  // Opening also speaks a short how-to, so blind students know the arrows read the list.
  useEffect(() => {
    prevFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    if (speechOnRef.current) {
      void speech.speak(
        tl(
          'Keyboard shortcuts help. Press the Down and Up arrows to hear each shortcut read aloud. Press Escape to close.',
          '快捷键帮助。按上下方向键逐条朗读快捷键，按 Escape 关闭。',
        ),
      );
    }
    return () => {
      prevFocusRef.current?.focus?.();
      speech.cancel();
    };
  }, []);

  const close = () => dispatch({ type: 'patch', patch: { helpOpen: false } });

  // Up/Down walk the list and read each entry; Home/End jump to the ends
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    if (e.key === 'ArrowDown') next = Math.min(SHORTCUTS.length - 1, cursor + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, cursor - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SHORTCUTS.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    setCursor(next);
    rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
    const [key, desc] = SHORTCUTS[next];
    if (speechOnRef.current) {
      void speech.speak(
        `${tl(`${next + 1} of ${SHORTCUTS.length}`, `第 ${next + 1} 条，共 ${SHORTCUTS.length} 条`)}. ${speakableKey(key)}. ${t(desc)}`,
      );
    }
  };

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id="help-dialog-title">
          <span aria-hidden="true">⌨️ </span>
          {t('Keyboard Shortcuts')}
        </h2>
        <p className="settings-note">
          {t('Press the Down and Up arrows to hear each shortcut read aloud.')}{' '}
          {t('Global shortcuts stay quiet while you are typing in a text box or using a slider.')}
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">{t('Key')}</th>
              <th scope="col">{t('What it does')}</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map(([key, desc], i) => (
              <tr
                key={key}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className={i === cursor ? 'help-row-active' : undefined}
              >
                <td>
                  <kbd>{key}</kbd>
                </td>
                <td>{t(desc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ textAlign: 'right', marginBottom: 0 }}>
          <button ref={closeRef} onClick={close}>
            {t('Close (Escape)')}
          </button>
        </p>
      </div>
    </div>
  );
}
