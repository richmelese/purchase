'use client';

/**
 * Tiny i18n layer (no dependency). English source text is the key:
 *
 *   const { t } = useT();
 *   t('Save')                          -> 'አስቀምጥ' in Amharic
 *   t('{n} purchases', { n: 4 })       -> placeholders in {curly} braces
 *
 * A missing translation falls back to the English text, so untranslated strings never break a page.
 * Amharic strings live in ./am/*.ts (one file per area of the app) and are merged in ./am/index.ts.
 * The chosen language is stored in the `lang` cookie so server-rendered HTML matches the client.
 * Plain (non-React) helpers live in ./core.ts.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LANGS, LANG_COOKIE, fill, setCurrentLang, translate, type Lang, type Vars } from './core';

export { LANGS, LANG_COOKIE, isLang, translate, tx, getLang } from './core';
export type { Lang, Vars } from './core';

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (text: string, vars?: Vars) => string;
}

const Ctx = createContext<I18nValue>({ lang: 'en', setLang: () => {}, t: (s, v) => fill(s, v) });

export function I18nProvider({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  setCurrentLang(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setCurrentLang(l);
    setLangState(l);
    try {
      document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch { /* cookies blocked: the choice lasts for this tab only */ }
  }, []);

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t: (text, vars) => translate(lang, text, vars) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);

/** Compact EN | አማ toggle used in the top bar and on the sign-in screens. */
export function LanguageSwitch({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useT();
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label={t('Language')}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          className={l.id === lang ? 'active' : ''}
          aria-pressed={l.id === lang}
          title={l.label}
          onClick={() => setLang(l.id)}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
