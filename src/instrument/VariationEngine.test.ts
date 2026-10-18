import { describe, expect, it } from 'vitest';
import type { MusicalTheme } from './models';
import { REST } from './models';
import {
  contourOf,
  contourSimilarity,
  generateVariation,
  mulberry32,
  preservesIdentity,
} from './VariationEngine';
import { buildNoteTable } from './scales';

// 一个手工三角形主题：低 → 升 → 峰 → 降 → 低（C Dorian）
const THEME: MusicalTheme = {
  pitches: [48, 51, 55, 60, 67, 60, 55, 50, 48],
  durations: [0.5, 0.5, 0.5, 1, 1, 0.5, 0.5, 0.5, 1],
  velocities: [0.6, 0.65, 0.7, 0.8, 0.9, 0.7, 0.65, 0.6, 0.6],
  accents: [false, false, true, false, true, false, true, false, false],
  contour: [1, 1, 1, 1, -1, -1, -1, -1],
  geometryType: 'triangle-like',
  seed: 123456789,
  scale: 'dorian',
  tonicMidi: 48,
  bpm: 88,
  closed: true,
};

const TABLE = buildNoteTable('dorian', 48);
const inScale = (p: number) => p === REST || TABLE.includes(p);

describe('确定性', () => {
  it('相同 seed 生成完全相同的变奏', () => {
    const a = generateVariation(THEME, 'transposition', 0.4, mulberry32(THEME.seed));
    const b = generateVariation(THEME, 'transposition', 0.4, mulberry32(THEME.seed));
    expect(a.pitches).toEqual(b.pitches);
    expect(a.durations).toEqual(b.durations);
  });

  it('mulberry32 序列可复现且分布在 0..1', () => {
    const r1 = mulberry32(7);
    const r2 = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('六种变奏', () => {
  it('移调：轮廓与节奏完全保留，仍在调内', () => {
    const v = generateVariation(THEME, 'transposition', 0.35);
    expect(contourOf(v.pitches)).toEqual(contourOf(THEME.pitches));
    expect(v.durations).toEqual(THEME.durations);
    expect(v.pitches.some((p, i) => p !== THEME.pitches[i])).toBe(true);
    expect(v.pitches.every(inScale)).toBe(true);
  });

  it('低强度移调不做八度跳跃', () => {
    const v = generateVariation(THEME, 'transposition', 0);
    // 每个音的音级偏移应当很小（≤3 个音级 ≈ 5 半音内）
    for (let i = 0; i < v.pitches.length; i++) {
      expect(Math.abs(v.pitches[i] - THEME.pitches[i])).toBeLessThanOrEqual(7);
    }
  });

  it('节奏变奏：音高不变，时值按增/减值变换', () => {
    const v = generateVariation(THEME, 'rhythmic', 0.3);
    expect(v.pitches).toEqual(THEME.pitches);
    const sum = v.durations.reduce((a, b) => a + b, 0);
    const orig = THEME.durations.reduce((a, b) => a + b, 0);
    expect(sum === orig * 2 || sum === orig * 0.5 || Math.abs(sum - orig * 0.5) < 0.6).toBe(true);
  });

  it('片段化：从主题中取材构成模进，仍在调内', () => {
    const v = generateVariation(THEME, 'fragmentation', 0.45);
    expect(v.pitches.length).toBeGreaterThanOrEqual(9); // 3 音片段 × ≥3 次
    expect(v.pitches.every(inScale)).toBe(true);
    // 片段的音程模式重复出现（模进）：前 3 音与第 4..6 音的内部音程一致
    const d1 = v.pitches[1] - v.pitches[0];
    const d2 = v.pitches[2] - v.pitches[1];
    const d4 = v.pitches[4] - v.pitches[3];
    const d5 = v.pitches[5] - v.pitches[4];
    expect(Math.abs(d1 - d4)).toBeLessThanOrEqual(2); // 音级模进在半音上允许小差
    expect(Math.abs(d2 - d5)).toBeLessThanOrEqual(2);
  });

  it('倒影：轮廓镜像，节奏保留', () => {
    const v = generateVariation(THEME, 'inversion', 0.35);
    expect(v.durations).toEqual(THEME.durations);
    const mirrored = contourOf(THEME.pitches).map((c) => -c);
    expect(contourSimilarity(mirrored, contourOf(v.pitches))).toBeGreaterThanOrEqual(0.8);
    // 围绕首音倒影后按八度移回音域：首音音级类不变
    expect((((v.pitches[0] - THEME.pitches[0]) % 12) + 12) % 12).toBe(0);
  });

  it('逆行：音符与节奏都反向', () => {
    const v = generateVariation(THEME, 'retrograde', 0.35);
    expect(v.pitches).toEqual([...THEME.pitches].reverse());
    expect(v.durations).toEqual([...THEME.durations].reverse());
  });

  it('装饰音：主题音符按序保留为子序列，插入 ≤3 个经过音且在调内', () => {
    const v = generateVariation(THEME, 'ornamentation', 0.5);
    expect(v.pitches.length).toBeGreaterThan(THEME.pitches.length);
    expect(v.pitches.length).toBeLessThanOrEqual(THEME.pitches.length + 3);
    expect(v.pitches.every(inScale)).toBe(true);
    expect(preservesIdentity(v, THEME, 'ornamentation')).toBe(true);
    // 总时值不变（偷取时值给经过音）
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    expect(sum(v.durations)).toBeCloseTo(sum(THEME.durations));
  });
});

describe('辨识度守卫', () => {
  it('全部六种变奏都通过辨识度检查', () => {
    for (const type of [
      'transposition',
      'rhythmic',
      'fragmentation',
      'inversion',
      'retrograde',
      'ornamentation',
    ] as const) {
      const v = generateVariation(THEME, type, 0.35);
      expect(preservesIdentity(v, THEME, type)).toBe(true);
    }
  });

  it('带休止符的主题也能正常变奏', () => {
    const withRest: MusicalTheme = {
      ...THEME,
      pitches: [48, 51, REST, 55, 60, 55, 48],
      durations: [0.5, 0.5, 0.5, 0.5, 1, 0.5, 1],
      velocities: [0.6, 0.6, 0, 0.7, 0.8, 0.7, 0.6],
      accents: [false, false, false, true, false, false, false],
    };
    for (const type of ['transposition', 'inversion', 'retrograde', 'ornamentation'] as const) {
      const v = generateVariation(withRest, type, 0.35);
      expect(v.pitches.every(inScale)).toBe(true);
    }
  });
});
