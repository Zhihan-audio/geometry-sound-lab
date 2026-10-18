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

describe('语音质量识别', () => {
  it('识别新奇/机械音色（不应被自动选择）', () => {
    expect(isNoveltyVoice('Albert')).toBe(true);
    expect(isNoveltyVoice('Bubbles')).toBe(true);
    expect(isNoveltyVoice('Fred')).toBe(true);
    expect(isNoveltyVoice('Zarvox')).toBe(true);
    expect(isNoveltyVoice('Samantha')).toBe(false);
    expect(isNoveltyVoice('Ava (Premium)')).toBe(false);
  });

  it('Premium > Enhanced > 普通自然人声', () => {
    const premium = scoreVoice(v('Ava (Premium)'));
    const enhanced = scoreVoice(v('Samantha (Enhanced)'));
    const plain = scoreVoice(v('Samantha'));
    const unknown = scoreVoice(v('SomeVoice'));
    expect(premium).toBeGreaterThan(enhanced);
    expect(enhanced).toBeGreaterThan(plain);
    expect(plain).toBeGreaterThan(unknown);
  });

  it('en-US 优先于其他英语地区', () => {
    expect(scoreVoice(v('Daniel', 'en-GB'))).toBeLessThan(scoreVoice(v('Daniel', 'en-US')));
  });

  it('非英语语音被排除', () => {
    expect(scoreVoice(v('Ting-Ting', 'zh-CN'))).toBeLessThan(0);
  });
});

describe('自动语音选择', () => {
  it('自动选择质量最高的语音', () => {
    const best = pickBestVoice([
      v('Albert'),
      v('Samantha'),
      v('Ava (Premium)'),
      v('Evan (Enhanced)'),
    ]);
    expect(best?.name).toBe('Ava (Premium)');
  });

  it('没有 Premium 时选 Enhanced，没有 Enhanced 时选已知自然人声', () => {
    expect(pickBestVoice([v('Samantha'), v('Evan (Enhanced)')])?.name).toBe('Evan (Enhanced)');
    expect(pickBestVoice([v('SomeVoice'), v('Samantha')])?.name).toBe('Samantha');
  });

  it('只有新奇音色时返回 null（回退系统默认）', () => {
    expect(pickBestVoice([v('Albert'), v('Bubbles'), v('Zarvox')])).toBeNull();
  });

  it('下拉列表排除新奇音色和非英语语音，按质量排序', () => {
    const list = filterEnglishVoices([
      v('Albert'),
      v('Ting-Ting', 'zh-CN'),
      v('Samantha'),
      v('Ava (Premium)'),
    ]);
    expect(list.map((x) => x.name)).toEqual(['Ava (Premium)', 'Samantha']);
  });
});

describe('中文语音选择', () => {
  it('中文界面下只提供中文语音，Premium 优先', () => {
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

  it('英文语音在中文模式下得分为负（不会被选中）', () => {
    expect(scoreVoiceFor(v('Ava (Premium)'), 'zh')).toBeLessThan(0);
    expect(scoreVoiceFor(v('Tingting', 'zh_CN'), 'zh')).toBeGreaterThan(0);
  });

  it('zh-CN 优先于其他中文地区', () => {
    expect(scoreVoiceFor(v('Tingting', 'zh_CN'), 'zh')).toBeGreaterThan(
      scoreVoiceFor(v('Meijia', 'zh_TW'), 'zh'),
    );
  });
});

describe('朗读安全超时（只兜底，不抢跑）', () => {
  it('中文按每字更长的时间估算（远长于英文）', () => {
    expect(speakSafetyTimeoutMs(110, 1, 'zh')).toBeGreaterThan(speakSafetyTimeoutMs(110, 1, 'en') * 2);
  });

  it('110 字中文导览词的超时必须远大于真实朗读时长（约 27 秒）', () => {
    expect(speakSafetyTimeoutMs(110, 1, 'zh')).toBeGreaterThan(45000);
  });

  it('慢速朗读时超时相应放宽', () => {
    expect(speakSafetyTimeoutMs(100, 0.6, 'zh')).toBeGreaterThan(speakSafetyTimeoutMs(100, 1, 'zh'));
  });

  it('英文长句的超时也覆盖慢速朗读', () => {
    // 300 字符英文在 0.6 倍速下约需 30 秒
    expect(speakSafetyTimeoutMs(300, 0.6, 'en')).toBeGreaterThan(60000);
  });
});

