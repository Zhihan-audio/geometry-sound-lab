import { describe, expect, it } from 'vitest';
import {
  landmarkToGrid,
  PinchDetector,
  PointSmoother,
  PresenceDebouncer,
} from './handTracking';

describe('手部坐标映射', () => {
  it('镜像水平方向：手向自己的右边移动，声音向右', () => {
    // 摄像头画面中 x=0.2（画面左侧）= 用户的右手边
    expect(landmarkToGrid({ x: 0.2, y: 0.5 }).x).toBeCloseTo(0.8);
  });

  it('翻转竖直方向：手抬高，y 增大（音高升高）', () => {
    expect(landmarkToGrid({ x: 0.5, y: 0.1 }).y).toBeCloseTo(0.9);
    expect(landmarkToGrid({ x: 0.5, y: 0.9 }).y).toBeCloseTo(0.1);
  });

  it('越界坐标被限制在 0..1', () => {
    const p = landmarkToGrid({ x: -0.3, y: 1.4 });
    expect(p.x).toBe(1);
    expect(p.y).toBe(0);
  });
});

describe('平滑滤波', () => {
  it('第一帧直接采用输入值', () => {
    const s = new PointSmoother(0.3);
    expect(s.push({ x: 0.4, y: 0.6 })).toEqual({ x: 0.4, y: 0.6 });
  });

  it('后续帧逐渐逼近目标（抑制抖动）', () => {
    const s = new PointSmoother(0.5);
    s.push({ x: 0, y: 0 });
    const p1 = s.push({ x: 1, y: 1 });
    expect(p1.x).toBeCloseTo(0.5);
    const p2 = s.push({ x: 1, y: 1 });
    expect(p2.x).toBeCloseTo(0.75);
  });

  it('reset 后重新从第一帧开始', () => {
    const s = new PointSmoother(0.5);
    s.push({ x: 0, y: 0 });
    s.reset();
    expect(s.push({ x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
  });
});

describe('捏合检测（带迟滞）', () => {
  const far = { x: 0.5, y: 0.5 };
  const near = { x: 0.52, y: 0.5 }; // 距离 0.02 < 0.06 → 捏合
  const mid = { x: 0.58, y: 0.5 }; // 距离 0.08：在两阈值之间

  it('拇指食指靠近时触发一次捏合（上升沿）', () => {
    const d = new PinchDetector();
    expect(d.update(far, { x: 0.9, y: 0.5 })).toBe(false);
    expect(d.update(far, near)).toBe(true); // 触发
    expect(d.update(far, near)).toBe(false); // 保持捏合不重复触发
    expect(d.isPinched).toBe(true);
  });

  it('迟滞：略微松开不算释放，明显松开才复位', () => {
    const d = new PinchDetector();
    d.update(far, near); // 捏合
    d.update(far, mid); // 0.08 < 0.1，仍视为捏合
    expect(d.isPinched).toBe(true);
    d.update(far, { x: 0.75, y: 0.5 }); // 0.25 > 0.1 → 释放
    expect(d.isPinched).toBe(false);
    expect(d.update(far, near)).toBe(true); // 可再次触发
  });
});

describe('手部出现/消失防抖', () => {
  it('需要连续多帧才切换状态', () => {
    const p = new PresenceDebouncer(3);
    expect(p.update(true)).toBe(false);
    expect(p.update(true)).toBe(false);
    expect(p.update(true)).toBe(true); // 第 3 帧确认出现
    expect(p.update(false)).toBe(true); // 单帧丢失不切换
    expect(p.update(true)).toBe(true);
    expect(p.update(false)).toBe(true);
    expect(p.update(false)).toBe(true);
    expect(p.update(false)).toBe(false); // 连续 3 帧丢失才确认消失
  });
});
