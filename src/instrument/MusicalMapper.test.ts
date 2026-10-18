import { describe, expect, it } from 'vitest';
import { LiveMusicalMapper } from './MusicalMapper';
import type { LiveFeatures } from './models';

const feat = (over: Partial<LiveFeatures>): LiveFeatures => ({
  x: 0.5,
  y: 0.5,
  speed: 0.5,
  angle: 0,
  curvature: 0,
  corner: false,
  closed: false,
  ...over,
});

function settle(mapper: LiveMusicalMapper, f: LiveFeatures, n = 60) {
  let out = mapper.map(f);
  for (let i = 0; i < n; i++) out = mapper.map(f);
  return out;
}

describe('实时音乐映射', () => {
  it('Y 位置映射到音阶内的音（C Dorian，C3..C6）', () => {
    const m = new LiveMusicalMapper('dorian');
    expect(settle(m, feat({ y: 0 })).midi).toBe(48);
    expect(settle(new LiveMusicalMapper('dorian'), feat({ y: 1 })).midi).toBe(84);
    const mid = settle(new LiveMusicalMapper('dorian'), feat({ y: 0.5 })).midi;
    expect([0, 2, 3, 5, 7, 9, 10]).toContain(((mid - 48) % 12 + 12) % 12); // 在调内
  });

  it('声像限制在 ±0.75，不做完全硬声像', () => {
    const m = new LiveMusicalMapper('dorian');
    expect(settle(m, feat({ x: 0 })).pan).toBeCloseTo(-0.75);
    expect(settle(new LiveMusicalMapper('dorian'), feat({ x: 1 })).pan).toBeCloseTo(0.75);
    expect(settle(new LiveMusicalMapper('dorian'), feat({ x: 0.5 })).pan).toBeCloseTo(0);
  });

  it('速度→动态：快更响、慢更轻，且有下限（慢速仍可听见）', () => {
    const slow = settle(new LiveMusicalMapper('dorian'), feat({ speed: 0.05 }));
    const fast = settle(new LiveMusicalMapper('dorian'), feat({ speed: 2.5 }));
    expect(fast.gain).toBeGreaterThan(slow.gain + 0.2);
    expect(slow.gain).toBeGreaterThan(0.25); // 永不无声
    expect(fast.gain).toBeLessThanOrEqual(1);
  });

  it('动态变化是平滑的（单步不突跳）', () => {
    const m = new LiveMusicalMapper('dorian');
    settle(m, feat({ speed: 0.05 }));
    const before = m.map(feat({ speed: 0.05 })).gain;
    const after = m.map(feat({ speed: 3 })).gain; // 速度突变一帧
    expect(Math.abs(after - before)).toBeLessThan(0.15);
  });

  it('方向→明暗微差：向上更亮，向下更暗', () => {
    const up = settle(new LiveMusicalMapper('dorian'), feat({ angle: Math.PI / 2 }));
    const down = settle(new LiveMusicalMapper('dorian'), feat({ angle: -Math.PI / 2 }));
    expect(up.brightness).toBeGreaterThan(down.brightness);
    expect(up.brightness - down.brightness).toBeLessThan(0.35); // 只是微差，不是换音色
  });

  it('曲率→调制深度：直线干净，曲线流动', () => {
    const straight = settle(new LiveMusicalMapper('dorian'), feat({ curvature: 0 }));
    const curved = settle(new LiveMusicalMapper('dorian'), feat({ curvature: 0.9 }));
    expect(straight.modDepth).toBeLessThan(0.1);
    expect(curved.modDepth).toBeGreaterThan(0.6);
  });

  it('切换音阶后音符表更新且迟滞复位', () => {
    const m = new LiveMusicalMapper('dorian');
    expect(m.noteTable).toHaveLength(22);
    m.setScale('majorPentatonic');
    expect(m.noteTable).toHaveLength(16);
    expect(settle(m, feat({ y: 0 })).midi).toBe(48);
  });
});
