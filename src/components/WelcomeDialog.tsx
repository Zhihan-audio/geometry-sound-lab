// First-thing-on-launch spoken orientation for blind students:
// reads the basic controls aloud, then asks whether to start the voice tour.
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { speech } from '../app/speech';
import { t, tt, type Bi } from '../i18n';
import { loadTutorialDone } from '../state/persistence';

export const WELCOME_BASICS: Bi = {
  en:
    'Welcome to Geometry Sound Lab! This app turns shapes into sound so you can hear geometry. ' +
    'Here are the basics. Press the Space bar to play the current shape. ' +
    'Use the Up and Down arrows to pick a shape from the library. ' +
    'Press the letter E to explore a shape freely with the arrow keys. ' +
    'And press the question mark key any time to open the full list of shortcuts — ' +
    'inside it, the Up and Down arrows read each shortcut aloud.',
  zh:
    '欢迎来到几何声音实验室！这个软件把图形变成声音，让你用耳朵听懂几何。' +
    '基本操作：按空格键播放当前图形；用上下方向键在图形库中选择图形；' +
    '按字母 E 用方向键自由探索图形；随时按问号键打开完整快捷键列表，' +
    '在列表里用上下方向键逐条朗读。',
};

export const WELCOME_ASK: Bi = {
  en: 'Would you like to start the guided voice tour now? Press Enter for yes, or Escape to skip.',
  zh: '要现在开始语音教学导览吗？按 Enter 开始，按 Escape 跳过。',
};

export const WELCOME_ASK_AGAIN: Bi = {
  en: 'Would you like to hear the guided voice tour again? Press Enter for yes, or Escape to skip.',
  zh: '要再听一遍语音教学导览吗？按 Enter 开始，按 Escape 跳过。',
};

export const WELCOME_SKIP_MESSAGE: Bi = {
  en: 'Okay! Press T any time for the tour. Pick a shape and have fun exploring!',
  zh: '好的！随时按 T 进入导览。选个图形，开始快乐探索吧！',
};

export default function WelcomeDialog() {
  const { dispatch } = useStore();
  const startRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    startRef.current?.focus();
    let cancelled = false;
    void (async () => {
      await speech.speak(tt(WELCOME_BASICS));
      if (!cancelled) {
        await speech.speak(tt(loadTutorialDone() ? WELCOME_ASK_AGAIN : WELCOME_ASK));
      }
    })();
    return () => {
      cancelled = true;
      speech.cancel();
    };
  }, []);

  const startTour = () => {
    dispatch({ type: 'patch', patch: { welcomeOpen: false, tutorialActive: true } });
  };

  const skip = () => {
    dispatch({ type: 'patch', patch: { welcomeOpen: false } });
    dispatch({ type: 'announce', text: t('Press T any time for the voice tour.') });
    void speech.speak(tt(WELCOME_SKIP_MESSAGE));
  };

  return (
    <div className="dialog-backdrop" onClick={skip}>
      <div
        className="dialog welcome-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="welcome-title">
          <span aria-hidden="true">👋🎵 </span>
          {t('Welcome to Geometry Sound Lab!')}
        </h2>
        <p>{t('This app turns shapes into sound so you can hear geometry.')}</p>
        <ul className="welcome-keys">
          <li>
            <kbd>Space</kbd> — {t('play the current shape')}
          </li>
          <li>
            <kbd>↑</kbd> <kbd>↓</kbd> — {t('pick a shape from the library')}
          </li>
          <li>
            <kbd>E</kbd> — {t('explore a shape freely with the arrow keys')}
          </li>
          <li>
            <kbd>?</kbd> — {t('all keyboard shortcuts')}
          </li>
          <li>
            <kbd>T</kbd> — {t('guided voice tour, any time')}
          </li>
        </ul>
        <p className="lesson-feedback">{t('Would you like to start the guided voice tour now?')}</p>
        <div className="tutorial-buttons">
          <button ref={startRef} className="primary" onClick={startTour}>
            {t('Yes — start the tour (Enter)')}
          </button>
          <button onClick={skip}>{t('Not now (Escape)')}</button>
        </div>
      </div>
    </div>
  );
}
