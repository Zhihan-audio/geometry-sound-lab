import { describe, expect, it } from 'vitest';
import { validateShapeData } from './shapeValidation';
import { getLibraryShape } from './shapeLibrary';

describe('shape data validation', () => {
  it('built-in shapes pass validation after serialization (export/import round trip)', () => {
    const original = getLibraryShape('poly-triangle')!;
    const json = JSON.parse(JSON.stringify(original));
    const result = validateShapeData(json);
    expect(result.ok).toBe(true);
    expect(result.shape!.points).toHaveLength(3);
    expect(result.shape!.segments).toHaveLength(3);
  });

  it('non-object data is rejected', () => {
    expect(validateShapeData(null).ok).toBe(false);
    expect(validateShapeData('hello').ok).toBe(false);
    expect(validateShapeData([1, 2]).ok).toBe(false);
  });

  it('missing points or segments is rejected', () => {
    expect(validateShapeData({}).ok).toBe(false);
    expect(validateShapeData({ points: [] }).ok).toBe(false);
  });

  it('a segment referencing a missing vertex is rejected', () => {
    const result = validateShapeData({
      points: [{ id: 'a', x: 0.1, y: 0.1 }],
      segments: [{ id: 's', startPointId: 'a', endPointId: 'missing', order: 0 }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('references a missing point');
  });

  it('duplicate point ids are rejected', () => {
    const result = validateShapeData({
      points: [
        { id: 'a', x: 0.1, y: 0.1 },
        { id: 'a', x: 0.2, y: 0.2 },
      ],
      segments: [],
    });
    expect(result.ok).toBe(false);
  });

  it('out-of-range coordinates are clamped to 0..1', () => {
    const result = validateShapeData({
      points: [{ id: 'a', x: -0.5, y: 1.5 }],
      segments: [],
    });
    expect(result.ok).toBe(true);
    expect(result.shape!.points[0].x).toBe(0);
    expect(result.shape!.points[0].y).toBe(1);
  });

  it('an invalid playback direction falls back to forward', () => {
    const result = validateShapeData({
      points: [{ id: 'a', x: 0.5, y: 0.5 }],
      segments: [],
      playbackDirection: 'sideways',
    });
    expect(result.ok).toBe(true);
    expect(result.shape!.playbackDirection).toBe('forward');
  });
});
