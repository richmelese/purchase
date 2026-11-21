// Framework-free part of the i18n layer: safe to import from shared/server code (no 'use client').
import { AM } from './am';

export type Lang = 'en' | 'am';
export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'am', label: 'አማርኛ', short: 'አማ' },
];
export const LANG_COOKIE = 'lang';
export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'am';

const DICTS: Record<Lang, Record<string, string>> = { en: {}, am: AM };

export type Vars = Record<string, string | number | null | undefined>;

export const fill = (s: string, vars?: Vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s;

/** Translate with an explicit language. Missing keys fall back to the English text. */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  if (text == null) return text;
  const hit = lang === 'en' ? undefined : DICTS[lang][text];
  return fill(hit ?? text, vars);
}

// Mirror of the active language for non-React code (API client, date helpers). Set by I18nProvider.
let current: Lang = 'en';
export const getLang = (): Lang => current;
export const setCurrentLang = (l: Lang) => { current = l; };
/** Translate using the active language. Inside components prefer `useT().t` so they re-render on switch. */
export const tx = (text: string, vars?: Vars) => translate(current, text, vars);
