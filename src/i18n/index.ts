// Lightweight i18n: English source text as keys (gettext style), full Chinese support
import { zh } from './zh';

export type Locale = 'en' | 'zh';

let currentLocale: Locale = 'en';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Translate: English source text is the key; falls back to English when missing */
export function t(enText: string): string {
  if (currentLocale === 'zh') {
    return zh[enText] ?? enText;
  }
  return enText;
}

/** Inline bilingual pick — for composed/templated strings */
export function tl(en: string, zhText: string): string {
  return currentLocale === 'zh' ? zhText : en;
}

/** Bilingual text pair (used by tutorial steps and welcome content) */
export interface Bi {
  en: string;
  zh: string;
}

/** Resolve a bilingual pair for the current locale */
export function tt(text: Bi): string {
  return currentLocale === 'zh' ? text.zh : text.en;
}
