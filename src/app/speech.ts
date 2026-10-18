// Central speech service: natural-voice selection, spoken announcements,
// and accessible-name reading for the self-voicing mode.
// Voice quality: macOS ships many voices; we auto-pick Premium > Enhanced >
// known natural voices, and never auto-pick novelty voices (Albert, Bubbles…).
//
// Inside Electron on macOS we speak through the native `say` synthesizer
// (exposed as window.nativeSpeech by the preload script) because Chromium's
// Web Speech API is unreliable there. In a plain browser we fall back to
// speechSynthesis.
import { engineSettings } from './engine';
import { getLocale, type Locale } from '../i18n';

interface NativeSpeechBridge {
  speak(opts: { text: string; voice?: string; rate?: number }): Promise<void>;
  cancel(): Promise<void>;
  voices(): Promise<{ name: string; lang: string }[]>;
}

declare global {
  interface Window {
    nativeSpeech?: NativeSpeechBridge;
  }
}

/** Base words-per-minute for the native synthesizer at 1.0x speed */
const BASE_WPM = 175;

/**
 * Safety-net timeout for a speak call. The real completion signal is the
 * synthesizer itself (say-process exit / utterance onend); this bound only
 * guards against a lost signal, so it must be a generous OVER-estimate.
 * Chinese needs far more time per character than English — every character
 * is a full syllable (~3–4 per second), so an English-tuned bound would fire
 * mid-sentence and let the next line cut this one off.
 */
export function speakSafetyTimeoutMs(textLength: number, rate: number, locale: Locale): number {
  const perCharMs = locale === 'zh' ? 600 : 220;
  return 8000 + (textLength * perCharMs) / Math.max(0.5, Math.min(1.5, rate));
}

/** Joke / sound-effect voices that should never be offered at all */
const NOVELTY_NAMES = [
  'albert',
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'deranged',
  'wobble',
  'good news',
  'jester',
  'organ',
  'superstar',
  'trinoids',
  'whisper',
  'zarvox',
  'fred',
  'junior',
  'kathy',
  'ralph',
];

/**
 * Cartoon persona voices (ship in many languages). Kept as valid low-priority
 * fallbacks — on some systems they are the only voices for a language.
 */
const PERSONA_NAMES = ['eddy', 'flo', 'grandma', 'grandpa', 'reed', 'rocko', 'sandy', 'shelley'];

/** English voices known to sound natural on macOS */
const PREFERRED_NAMES = [
  'ava',
  'samantha',
  'zoe',
  'allison',
  'evan',
  'nathan',
  'joelle',
  'susan',
  'tom',
  'alex',
  'nicky',
  'aaron',
];

/** Chinese voices known to sound natural on macOS */
const PREFERRED_ZH_NAMES = [
  'tingting',
  'ting-ting',
  'meijia',
  'mei-jia',
  'lili',
  'sinji',
  'yue',
  'han',
  'binbin',
  'shasha',
];

export interface VoiceLite {
  name: string;
  lang: string;
  localService: boolean;
  voiceURI: string;
}

export function isNoveltyVoice(name: string): boolean {
  const n = name.toLowerCase();
  return NOVELTY_NAMES.some((bad) => n.startsWith(bad) || n.includes(`${bad} `));
}

/** Score a voice for the given UI language; voices of other languages score -1000 */
export function scoreVoiceFor(v: VoiceLite, locale: Locale): number {
  if (isNoveltyVoice(v.name)) return -1000;
  const name = v.name.toLowerCase();
  const lang = v.lang.toLowerCase().replace('_', '-');
  let score = 0;
  if (locale === 'zh') {
    if (!lang.startsWith('zh')) return -1000;
    if (lang.startsWith('zh-cn')) score += 20;
    else score += 10;
    if (PREFERRED_ZH_NAMES.some((good) => name.startsWith(good))) score += 30;
  } else {
    if (!lang.startsWith('en')) return -1000;
    if (lang.startsWith('en-us')) score += 20;
    else score += 10;
    if (PREFERRED_NAMES.some((good) => name.startsWith(good))) score += 30;
  }
  if (name.includes('premium')) score += 100;
  if (name.includes('enhanced')) score += 60;
  if (name.includes('siri')) score += 90;
  if (v.localService) score += 5;
  // Persona voices stay available but sink to the bottom of the ranking
  if (PERSONA_NAMES.some((p) => name.startsWith(p))) score = Math.max(1, score - 100);
  return score;
}

/** Back-compat English scoring (kept for existing tests/callers) */
export function scoreVoice(v: VoiceLite): number {
  return scoreVoiceFor(v, 'en');
}

/** Voices usable for the given language, best first, novelty voices removed */
export function filterVoicesFor<T extends VoiceLite>(voices: T[], locale: Locale): T[] {
  return voices
    .filter((v) => scoreVoiceFor(v, locale) > 0)
    .sort((a, b) => scoreVoiceFor(b, locale) - scoreVoiceFor(a, locale));
}

export function filterEnglishVoices<T extends VoiceLite>(voices: T[]): T[] {
  return filterVoicesFor(voices, 'en');
}

export function pickBestVoiceFor<T extends VoiceLite>(voices: T[], locale: Locale): T | null {
  const ranked = filterVoicesFor(voices, locale);
  return ranked.length > 0 ? ranked[0] : null;
}

export function pickBestVoice<T extends VoiceLite>(voices: T[]): T | null {
  return pickBestVoiceFor(voices, 'en');
}

// ---------- Service ----------

class SpeechService {
  private voices: SpeechSynthesisVoice[] = [];
  private nativeVoices: VoiceLite[] = [];
  private native: NativeSpeechBridge | null = null;
  private changeListeners = new Set<() => void>();

  constructor() {
    if (typeof window === 'undefined') return;
    if (window.nativeSpeech) {
      this.native = window.nativeSpeech;
      void this.native
        .voices()
        .then((list) => {
          this.nativeVoices = list.map((v) => ({
            name: v.name,
            lang: v.lang.replace('_', '-'),
            localService: true,
            voiceURI: v.name,
          }));
          for (const fn of this.changeListeners) fn();
        })
        .catch(() => undefined);
      return;
    }
    if (typeof speechSynthesis !== 'undefined') {
      this.refreshVoices();
      try {
        speechSynthesis.addEventListener?.('voiceschanged', () => {
          this.refreshVoices();
          for (const fn of this.changeListeners) fn();
        });
      } catch {
        // older engines: getVoices() only
      }
    }
  }

  private refreshVoices(): void {
    try {
      this.voices = speechSynthesis.getVoices();
    } catch {
      this.voices = [];
    }
  }

  get isSupported(): boolean {
    return this.native !== null || typeof speechSynthesis !== 'undefined';
  }

  onVoicesChanged(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  /** Voices for the current UI language, best first (settings dropdown) */
  listVoices(): { voiceURI: string; name: string; lang: string }[] {
    const locale = getLocale();
    if (this.native) {
      return filterVoicesFor(this.nativeVoices, locale).map((v) => ({
        voiceURI: v.voiceURI,
        name: v.name,
        lang: v.lang,
      }));
    }
    if (this.voices.length === 0) this.refreshVoices();
    return filterVoicesFor(this.voices, locale).map((v) => ({
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang,
    }));
  }

  private resolveVoice(preferredURI: string | null, locale: Locale): SpeechSynthesisVoice | null {
    if (this.voices.length === 0) this.refreshVoices();
    if (preferredURI) {
      const chosen = this.voices.find((v) => v.voiceURI === preferredURI);
      // Only honor the stored voice when it matches the current language
      if (chosen && scoreVoiceFor(chosen, locale) > 0) return chosen;
    }
    return pickBestVoiceFor(this.voices, locale);
  }

  /**
   * Speak text with the configured natural voice. Interrupts previous speech.
   * Resolves when speech ends (with a safety timeout so callers never hang).
   */
  speak(text: string, opts: { rateOverride?: number } = {}): Promise<void> {
    if (this.native) {
      const locale = getLocale();
      const settings = engineSettings.current;
      const rate = Math.max(0.5, Math.min(3, opts.rateOverride ?? settings.speechRate ?? 1.5));
      const preferred = settings.speechVoiceURI ?? null;
      const localeVoices = filterVoicesFor(this.nativeVoices, locale);
      const voice =
        (preferred && localeVoices.some((v) => v.voiceURI === preferred)
          ? preferred
          : pickBestVoiceFor(this.nativeVoices, locale)?.voiceURI) ?? undefined;
      const request = this.native
        .speak({ text, voice, rate: Math.round(BASE_WPM * rate) })
        .catch(() => undefined);
      // Safety timeout so a lost IPC reply can never hang the tutorial flow.
      // Deliberately generous — resolving early would cut speech mid-sentence.
      const timeout = new Promise<void>((r) =>
        setTimeout(r, speakSafetyTimeoutMs(text.length, rate, locale)),
      );
      return Promise.race([request, timeout]).then(() => undefined);
    }
    return new Promise((resolve) => {
      try {
        if (!this.isSupported) {
          setTimeout(resolve, Math.min(4000, 400 + text.length * 40));
          return;
        }
        speechSynthesis.cancel();
        const locale = getLocale();
        const settings = engineSettings.current;
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = locale === 'zh' ? 'zh-CN' : 'en-US';
        const rate = opts.rateOverride ?? settings.speechRate ?? 1.5;
        utter.rate = Math.max(0.5, Math.min(3, rate));
        utter.pitch = 1;
        const voice = this.resolveVoice(settings.speechVoiceURI ?? null, locale);
        if (voice) utter.voice = voice;

        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        utter.onend = finish;
        utter.onerror = finish;
        speechSynthesis.speak(utter);
        // Generous safety net only — onend is the real completion signal
        setTimeout(finish, speakSafetyTimeoutMs(text.length, utter.rate, locale));
      } catch {
        resolve();
      }
    });
  }

  cancel(): void {
    if (this.native) {
      void this.native.cancel().catch(() => undefined);
      return;
    }
    try {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

export const speech = new SpeechService();

// ---------- Accessible-name reading (self-voicing focus reader) ----------

function cleanText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function labelTextFor(el: HTMLElement): string {
  const explicit = el.getAttribute('aria-label');
  if (explicit) return explicit;
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label instanceof HTMLElement) return cleanText(label);
  }
  const wrapping = el.closest('label');
  if (wrapping instanceof HTMLElement) {
    const clone = wrapping.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea, [aria-hidden="true"]').forEach((n) => n.remove());
    const text = clone.textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return cleanText(el);
}

/**
 * A compact accessible name + role + state description, in the spirit of a
 * screen reader, for the built-in focus reader.
 */
export function accessibleNameFor(el: HTMLElement): string {
  const parts: string[] = [];
  const name = labelTextFor(el);

  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') {
      parts.push(name, 'checkbox', el.checked ? 'checked' : 'not checked');
    } else if (el.type === 'radio') {
      parts.push(name, 'radio button', el.checked ? 'selected' : 'not selected');
    } else if (el.type === 'range') {
      parts.push(name, 'slider', el.getAttribute('aria-valuetext') ?? el.value);
    } else {
      parts.push(name, 'edit field', el.value);
    }
  } else if (el instanceof HTMLSelectElement) {
    const chosen = el.selectedOptions[0]?.textContent?.trim() ?? '';
    parts.push(name, 'menu', chosen);
  } else if (el instanceof HTMLTextAreaElement) {
    parts.push(name, 'edit field');
  } else if (el instanceof HTMLButtonElement || el.getAttribute('role') === 'button') {
    parts.push(name, 'button');
    const pressed = el.getAttribute('aria-pressed');
    if (pressed === 'true') parts.push('on');
    if (el instanceof HTMLButtonElement && el.disabled) parts.push('unavailable');
  } else if (el.getAttribute('role') === 'option') {
    parts.push(name);
    if (el.getAttribute('aria-selected') === 'true') parts.push('selected');
  } else {
    parts.push(name);
  }
  return parts.filter(Boolean).join(', ');
}
