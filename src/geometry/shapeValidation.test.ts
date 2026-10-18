import { describe, expect, it } from 'vitest';
import { validateShapeData } from './shapeValidation';
import { getLibraryShape } from './shapeLibrary';

describe('图形数据校验', () => {
  it('内置图形序列化后可以通过校验（导出导入往返）', () => {
    const original = getLibraryShape('poly-triangle')!;
    const json = JSON.parse(JSON.stringify(original));
    const result = validateShapeData(json);
    expect(result.ok).toBe(true);
    expect(result.shape!.points).toHaveLength(3);
    expect(result.shape!.segments).toHaveLength(3);
  });

  it('非对象数据被拒绝', () => {
    expect(validateShapeData(null).ok).toBe(false);
    expect(validateShapeData('hello').ok).toBe(false);
    expect(validateShapeData([1, 2]).ok).toBe(false);
  });

  it('缺少 points 或 segments 被拒绝', () => {
    expect(validateShapeData({}).ok).toBe(false);
    expect(validateShapeData({ points: [] }).ok).toBe(false);
  });

  it('线段引用不存在的顶点被拒绝', () => {
    const result = validateShapeData({
      points: [{ id: 'a', x: 0.1, y: 0.1 }],
      segments: [{ id: 's', startPointId: 'a', endPointId: 'missing', order: 0 }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('references a missing point');
  });

  it('顶点 id 重复被拒绝', () => {
    const result = validateShapeData({
      points: [
        { id: 'a', x: 0.1, y: 0.1 },
        { id: 'a', x: 0.2, y: 0.2 },
      ],
      segments: [],
    });
    expect(result.ok).toBe(false);
  });

  it('超出范围的坐标被限制在 0..1', () => {
    const result = validateShapeData({
      points: [{ id: 'a', x: -0.5, y: 1.5 }],
      segments: [],
    });
    expect(result.ok).toBe(true);
    expect(result.shape!.points[0].x).toBe(0);
    expect(result.shape!.points[0].y).toBe(1);
  });

  it('无效播放方向回退为 forward', () => {
    const result = validateShapeData({
      points: [{ id: 'a', x: 0.5, y: 0.5 }],
      segments: [],
      playbackDirection: 'sideways',
    });
    expect(result.ok).toBe(true);
    expect(result.shape!.playbackDirection).toBe('forward');
  });
});
