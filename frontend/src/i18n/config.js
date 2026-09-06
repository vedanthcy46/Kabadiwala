/**
 * i18n — Lightweight translation system for Kabadiwala Connect.
 *
 * No external library. Custom React Context + hook.
 * Supports: English (en), Hindi (hi), Marathi (mr)
 *
 * Usage:
 *   const { t, lang, setLang } = useTranslation();
 *   t('nav.dashboard')           → "Dashboard" / "डैशबोर्ड" / "डॅशबोर्ड"
 *   t('createLot.photos.count', { current: 2, max: 3 }) → "2/3 फ़ोटो"
 *
 * Template variables: use {{varName}} syntax in locale JSON values.
 * Falls back to English for any missing key.
 * Falls back to the key itself if English also missing (never breaks UI).
 *
 * Persistence: language choice is stored in localStorage as 'kc_lang'.
 */

import { createContext, useContext } from 'react';
import { getSession } from '../services/auth';
import en from './locales/en.json';
import hi from './locales/hi.json';
import mr from './locales/mr.json';
import kn from './locales/kn.json';

const LOCALES = { en, hi, mr, kn };
const SUPPORTED = ['en', 'hi', 'mr', 'kn'];
const STORAGE_KEY = 'kc_lang';

function detectInitialLang() {
  // Collector's account preference wins (set at registration/login)
  const sessionLang = getSession()?.preferred_language;
  if (sessionLang && SUPPORTED.includes(sessionLang)) return sessionLang;
  const stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY)
    : null;
  if (stored && SUPPORTED.includes(stored)) return stored;
  // Try browser preference
  const browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
  if (SUPPORTED.includes(browser)) return browser;
  return 'en';
}

/**
 * Resolve a dot-notated key in a locale object.
 * e.g. getKey(en, 'nav.dashboard') → "Dashboard"
 */
function getKey(locale, key) {
  const parts = key.split('.');
  let node = locale;
  for (const part of parts) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Fill {{varName}} placeholders in a translated string.
 */
function interpolate(str, vars) {
  if (!vars || typeof str !== 'string') return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`
  );
}

// ── Context ─────────────────────────────────────────────────────────────────

export const I18nContext = createContext(null);

/**
 * Hook — use this in every component that needs translations.
 *
 * @returns {{ t: Function, lang: string, setLang: Function }}
 */
export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useTranslation must be used inside <I18nProvider>');
  }
  return ctx;
}

/**
 * Translate a key with optional template variables.
 * Falls back: current locale → English → raw key string.
 * Returns arrays unchanged (needed for safety section items).
 *
 * @param {object} locales  — all locale objects
 * @param {string} lang     — active language code
 * @param {string} key      — dot-notated key e.g. 'nav.dashboard'
 * @param {object} [vars]   — template variables e.g. { count: 3 }
 * @returns {string|Array}
 */
export function translate(locales, lang, key, vars) {
  const locale = locales[lang] || locales.en;
  let result = getKey(locale, key);

  // Fallback to English
  if (result === undefined && lang !== 'en') {
    result = getKey(locales.en, key);
  }

  // Return arrays as-is (e.g. safety section items)
  if (Array.isArray(result)) return result;

  // Final fallback — return the key itself so UI never breaks
  if (result === undefined) {
    console.warn(`[i18n] Missing key: "${key}" in "${lang}"`);
    return key;
  }

  return interpolate(result, vars);
}

export { LOCALES, SUPPORTED, STORAGE_KEY, detectInitialLang };
