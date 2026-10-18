import { describe, expect, it } from 'vitest';
import {
  buildNoteTable,
  nearestIndexInTable,
  NoteHysteresis,
  PERFORMANCE_SCALES,
  yToTableIndex,
} from './scales';

describe('演奏音阶表', () => {
  it('C Dorian 的音级正确（C D Eb F G A Bb）', () => {
    expect(PERFORMANCE_SCALES.dorian).toEqual([0, 2, 3, 5, 7, 9, 10]);
  });

  it('音阶表覆盖 C3 到 C6，首尾都是主音', () => {
    const table = buildNoteTable('dorian', 48, 3);
    expect(table[0]).toBe(48); // C3
    expect(table[table.length - 1]).toBe(84); // C6
    expect(table).toHaveLength(7 * 3 + 1);
    // 严格升序
    for (let i = 1; i < table.length; i++) {
      expect(table[i]).toBeGreaterThan(table[i - 1]);
    }
  });

  it('五声音阶表长度正确', () => {
    expect(buildNoteTable('majorPentatonic', 48, 3)).toHaveLength(5 * 3 + 1);
  });

  it('y=0 是最低音，y=1 是最高音', () => {
    const table = buildNoteTable('dorian');
    expect(table[yToTableIndex(0, table.length)]).toBe(48);
    expect(table[yToTableIndex(1, table.length)]).toBe(84);
  });

  it('nearestIndexInTable 找到最近的音', () => {
    const table = buildNoteTable('dorian', 48, 1); // C3..C4
    expect(table[nearestIndexInTable(table, 48)]).toBe(48);
    expect(table[nearestIndexInTable(table, 49)]).toBeLessThanOrEqual(50);
    expect(table[nearestIndexInTable(table, 84)]).toBe(60); // 超界取最高
  });
});

describe('音符迟滞（防抖动）', () => {
  const LEN = 22; // dorian 3 octaves

  it('第一次映射直接取最近音', () => {
    const h = new NoteHysteresis();
    expect(h.map(0.5, LEN)).toBe(Math.round(0.5 * (LEN - 1)));
  });

  it('在音符边界附近轻微抖动不换音', () => {
    const h = new NoteHysteresis(0.18);
    const idx = h.map(10 / (LEN - 1), LEN); // 正好落在 10 号音
    expect(idx).toBe(10);
    // 边界在 10.5：来回 10.45 ↔ 10.55 抖动（普通量化会不停切换）
    expect(h.map(10.45 / (LEN - 1), LEN)).toBe(10);
    expect(h.map(10.55 / (LEN - 1), LEN)).toBe(10);
    expect(h.map(10.6 / (LEN - 1), LEN)).toBe(10); // 仍在 0.5+0.18 以内
  });

  it('明确越过边界后换音', () => {
    const h = new NoteHysteresis(0.18);
    h.map(10 / (LEN - 1), LEN);
    expect(h.map(10.75 / (LEN - 1), LEN)).toBe(11);
  });

  it('大幅移动直接跳到目标音（快速扫弦不受限）', () => {
    const h = new NoteHysteresis();
    h.map(0, LEN);
    expect(h.map(1, LEN)).toBe(LEN - 1);
  });

  it('reset 后重新开始', () => {
    const h = new NoteHysteresis();
    h.map(0.9, LEN);
    h.reset();
    expect(h.current).toBeNull();
    expect(h.map(0.1, LEN)).toBe(Math.round(0.1 * (LEN - 1)));
  });
});
