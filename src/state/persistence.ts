// 本地保存：设置、自定义图形、教学进度；数据损坏自动回退默认值
import type { GeometryShape } from '../geometry/geometryTypes';
import { validateShapeData } from '../geometry/shapeValidation';

const SETTINGS_KEY = 'gsl.settings.v1';
const SHAPES_KEY = 'gsl.customShapes.v1';
const PROGRESS_KEY = 'gsl.progress.v1';
const TUTORIAL_KEY = 'gsl.tutorialDone.v1';
const PITCH_MIGRATED_KEY = 'gsl.notePitchDefault.v1';

/** One-time migration marker: scale-note pitch became the default */
export function loadPitchMigrated(): boolean {
  try {
    return localStorage.getItem(PITCH_MIGRATED_KEY) === '1';
  } catch {
    return false;
  }
}

export function savePitchMigrated(): void {
  try {
    localStorage.setItem(PITCH_MIGRATED_KEY, '1');
  } catch {
    // ignore
  }
}

const RATE_MIGRATED_KEY = 'gsl.speechRate15.v1';

/** One-time migration marker: default speaking speed became 1.5x */
export function loadRateMigrated(): boolean {
  try {
    return localStorage.getItem(RATE_MIGRATED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveRateMigrated(): void {
  try {
    localStorage.setItem(RATE_MIGRATED_KEY, '1');
  } catch {
    // ignore
  }
}

export function loadTutorialDone(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    // ignore
  }
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function loadSettingsPatch(): Record<string, unknown> {
  try {
    const data = safeParse(localStorage.getItem(SETTINGS_KEY));
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch (err) {
    console.warn('Failed to read saved settings, using defaults', err);
  }
  return {};
}

export function saveSettingsPatch(patch: Record<string, unknown>): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(patch));
  } catch (err) {
    console.warn('Failed to save settings', err);
  }
}

export function loadCustomShapes(): GeometryShape[] {
  try {
    const data = safeParse(localStorage.getItem(SHAPES_KEY));
    if (!Array.isArray(data)) return [];
    const shapes: GeometryShape[] = [];
    for (const item of data) {
      const result = validateShapeData(item);
      if (result.ok && result.shape) shapes.push(result.shape);
    }
    return shapes;
  } catch (err) {
    console.warn('Failed to read custom shapes', err);
    return [];
  }
}

export function saveCustomShapes(shapes: GeometryShape[]): void {
  try {
    localStorage.setItem(SHAPES_KEY, JSON.stringify(shapes));
  } catch (err) {
    console.warn('Failed to save custom shapes', err);
  }
}

export interface StageProgress {
  attempts: number;
  correct: number;
}

export type LessonProgress = Record<string, StageProgress>;

export function loadProgress(): LessonProgress {
  try {
    const data = safeParse(localStorage.getItem(PROGRESS_KEY));
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const result: LessonProgress = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (
          typeof v === 'object' &&
          v !== null &&
          typeof (v as StageProgress).attempts === 'number' &&
          typeof (v as StageProgress).correct === 'number'
        ) {
          result[k] = { attempts: (v as StageProgress).attempts, correct: (v as StageProgress).correct };
        }
      }
      return result;
    }
  } catch (err) {
    console.warn('Failed to read lesson progress', err);
  }
  return {};
}

export function saveProgress(progress: LessonProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (err) {
    console.warn('Failed to save lesson progress', err);
  }
}
