// Musical memory: the user's recent geometry themes, persisted locally.
import type { MusicalTheme, StoredTheme } from './models';
import { REST } from './models';

const KEY = 'gsl.musicalMemory.v1';
const MAX_THEMES = 5;

function isTheme(v: unknown): v is MusicalTheme {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    Array.isArray(t.pitches) &&
    Array.isArray(t.durations) &&
    t.pitches.length === t.durations.length &&
    t.pitches.every((p) => typeof p === 'number' && (p === REST || (p >= 0 && p <= 127))) &&
    typeof t.seed === 'number' &&
    typeof t.tonicMidi === 'number' &&
    typeof t.bpm === 'number'
  );
}

export function loadThemes(): StoredTheme[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (item): item is StoredTheme =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as StoredTheme).id === 'string' &&
        typeof (item as StoredTheme).name === 'string' &&
        isTheme((item as StoredTheme).theme),
    );
  } catch (err) {
    console.warn('Failed to read musical memory', err);
    return [];
  }
}

export function saveTheme(theme: MusicalTheme, name: string): StoredTheme[] {
  const entry: StoredTheme = {
    id: `theme-${Date.now().toString(36)}`,
    name,
    createdAt: Date.now(),
    theme,
  };
  const next = [entry, ...loadThemes()].slice(0, MAX_THEMES);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('Failed to save musical memory', err);
  }
  return next;
}

export function deleteTheme(id: string): StoredTheme[] {
  const next = loadThemes().filter((t) => t.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('Failed to save musical memory', err);
  }
  return next;
}
