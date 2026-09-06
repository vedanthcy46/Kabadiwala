/**
 * I18nProvider — wraps the application with multilingual support.
 *
 * Provides:
 *   lang    — current language code ('en' | 'hi' | 'mr' | 'kn')
 *   setLang — switch language (persists to localStorage)
 *   t(key, vars?) — translate a key with optional template variables
 *
 * Mount once at the top of the component tree (in App.jsx).
 */

import { useState, useCallback, useMemo } from 'react';
import {
  I18nContext,
  LOCALES,
  STORAGE_KEY,
  SUPPORTED,
  translate,
  detectInitialLang as getInitialLang,
} from './config.js';

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => getInitialLang());

  const setLang = useCallback((code) => {
    if (!SUPPORTED.includes(code)) return;
    setLangState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // localStorage blocked (private mode etc.) — still works in-session
    }
  }, []);

  // Memoize t() so it only changes when lang changes
  const t = useCallback(
    (key, vars) => translate(LOCALES, lang, key, vars),
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}
