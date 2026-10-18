import { describe, expect, it } from 'vitest';
import { parseSayVoices } from './sayVoices';

const SAMPLE = [
  'Alex                en_US    # Most people recognize me by my voice.',
  'Ava (Premium)       en_US    # Hello! My name is Ava.',
  'Samantha (Enhanced) en_US    # Hello! My name is Samantha.',
  'Ting-Ting           zh_CN    # 您好，我叫Ting-Ting。',
  'Daniel              en_GB    # Hello, my name is Daniel.',
  'not a voice line',
  '',
].join('\n');

describe('say -v ? 输出解析', () => {
  it('解析出语音名称与语言（下划线转连字符）', () => {
    const voices = parseSayVoices(SAMPLE);
    expect(voices).toContainEqual({ name: 'Alex', lang: 'en-US' });
    expect(voices).toContainEqual({ name: 'Ava (Premium)', lang: 'en-US' });
    expect(voices).toContainEqual({ name: 'Samantha (Enhanced)', lang: 'en-US' });
    expect(voices).toContainEqual({ name: 'Daniel', lang: 'en-GB' });
    expect(voices).toContainEqual({ name: 'Ting-Ting', lang: 'zh-CN' });
  });

  it('忽略无法解析的行', () => {
    expect(parseSayVoices(SAMPLE)).toHaveLength(5);
    expect(parseSayVoices('')).toHaveLength(0);
    expect(parseSayVoices('garbage\nlines\n')).toHaveLength(0);
  });

  it('带括号后缀的语音名称保持完整（用于 -v 参数）', () => {
    const ava = parseSayVoices(SAMPLE).find((v) => v.name.includes('Premium'));
    expect(ava?.name).toBe('Ava (Premium)');
  });
});
