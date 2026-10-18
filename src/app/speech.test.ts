import { describe, expect, it } from 'vitest';
import {
  filterEnglishVoices,
  filterVoicesFor,
  isNoveltyVoice,
  pickBestVoice,
  pickBestVoiceFor,
  scoreVoice,
  scoreVoiceFor,
  speakSafetyTimeoutMs,
  type VoiceLite,
} from './speech';

const v = (name: string, lang = 'en-US', localService = true): VoiceLite => ({
  name,
  lang,
  localService,
  voiceURI: name,
});

describe('voice quality detection', () => {
  it('detects novelty/robotic voices (should not be auto-selected)', () => {
    expect(isNoveltyVoice('Albert')).toBe(true);
    expect(isNoveltyVoice('Bubbles')).toBe(true);
    expect(isNoveltyVoice('Fred')).toBe(true);
    expect(isNoveltyVoice('Zarvox')).toBe(true);
    expect(isNoveltyVoice('Samantha')).toBe(false);
    expect(isNoveltyVoice('Ava (Premium)')).toBe(false);
  });

  it('Premium > Enhanced > plain natural voices', () => {
    const premium = scoreVoice(v('Ava (Premium)'));
    const enhanced = scoreVoice(v('Samantha (Enhanced)'));
    const plain = scoreVoice(v('Samantha'));
    const unknown = scoreVoice(v('SomeVoice'));
    expect(premium).toBeGreaterThan(enhanced);
    expect(enhanced).toBeGreaterThan(plain);
    expect(plain).toBeGreaterThan(unknown);
  });

  it('prefers en-US over other English regions', () => {
    expect(scoreVoice(v('Daniel', 'en-GB'))).toBeLessThan(scoreVoice(v('Daniel', 'en-US')));
  });

  it('excludes non-English voices', () => {
    expect(scoreVoice(v('Ting-Ting', 'zh-CN'))).toBeLessThan(0);
  });
});

describe('automatic voice selection', () => {
  it('automatically picks the highest-quality voice', () => {
    const best = pickBestVoice([
      v('Albert'),
      v('Samantha'),
      v('Ava (Premium)'),
      v('Evan (Enhanced)'),
    ]);
    expect(best?.name).toBe('Ava (Premium)');
  });

  it('falls back to Enhanced without Premium, then to known natural voices', () => {
    expect(pickBestVoice([v('Samantha'), v('Evan (Enhanced)')])?.name).toBe('Evan (Enhanced)');
    expect(pickBestVoice([v('SomeVoice'), v('Samantha')])?.name).toBe('Samantha');
  });

  it('returns null when only novelty voices exist (falls back to system default)', () => {
    expect(pickBestVoice([v('Albert'), v('Bubbles'), v('Zarvox')])).toBeNull();
  });

  it('dropdown list excludes novelty and non-English voices, sorted by quality', () => {
    const list = filterEnglishVoices([
      v('Albert'),
      v('Ting-Ting', 'zh-CN'),
      v('Samantha'),
      v('Ava (Premium)'),
    ]);
    expect(list.map((x) => x.name)).toEqual(['Ava (Premium)', 'Samantha']);
  });
});

describe('Chinese voice selection', () => {
  it('offers only Chinese voices in the Chinese UI, Premium first', () => {
    const voices = [
      v('Samantha'),
      v('Tingting', 'zh_CN'),
      v('Meijia', 'zh_TW'),
      v('Tingting (Premium)', 'zh_CN'),
    ];
    const list = filterVoicesFor(voices, 'zh');
    expect(list.map((x) => x.name)).toEqual(['Tingting (Premium)', 'Tingting', 'Meijia']);
    expect(pickBestVoiceFor(voices, 'zh')?.name).toBe('Tingting (Premium)');
  });

  it('scores English voices negative in Chinese mode (never selected)', () => {
    expect(scoreVoiceFor(v('Ava (Premium)'), 'zh')).toBeLessThan(0);
    expect(scoreVoiceFor(v('Tingting', 'zh_CN'), 'zh')).toBeGreaterThan(0);
  });

  it('prefers zh-CN over other Chinese regions', () => {
    expect(scoreVoiceFor(v('Tingting', 'zh_CN'), 'zh')).toBeGreaterThan(
      scoreVoiceFor(v('Meijia', 'zh_TW'), 'zh'),
    );
  });
});

describe('speech safety timeout (last-resort only, never cuts in early)', () => {
  it('estimates Chinese with more time per character (much longer than English)', () => {
    expect(speakSafetyTimeoutMs(110, 1, 'zh')).toBeGreaterThan(speakSafetyTimeoutMs(110, 1, 'en') * 2);
  });

  it('timeout for a 110-character Chinese tour line far exceeds real speaking time (about 27 s)', () => {
    expect(speakSafetyTimeoutMs(110, 1, 'zh')).toBeGreaterThan(45000);
  });

  it('relaxes the timeout accordingly at slow speech rates', () => {
    expect(speakSafetyTimeoutMs(100, 0.6, 'zh')).toBeGreaterThan(speakSafetyTimeoutMs(100, 1, 'zh'));
  });

  it('timeout for long English sentences also covers slow speech', () => {
    // 300 characters of English at 0.6x speed takes about 30 seconds
    expect(speakSafetyTimeoutMs(300, 0.6, 'en')).toBeGreaterThan(60000);
  });
});

