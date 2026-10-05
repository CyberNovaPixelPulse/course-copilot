"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  dictionaries,
  LOCALES,
  type Dictionary,
  type Locale,
} from "@/lib/i18n-dictionaries";

export type { Dictionary, Locale };
export { LOCALES };

const STORAGE_KEY = "cc_locale";

const localeCodes = new Set<string>(LOCALES.map((item) => item.code));

function isLocale(value: string | null): value is Locale {
  return !!value && localeCodes.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeWithEnglish<T>(english: T, localized: unknown): T {
  if (typeof english === "function") {
    return (typeof localized === "function" ? localized : english) as T;
  }
  if (Array.isArray(english)) {
    const items = Array.isArray(localized) ? localized : [];
    return english.map((item, index) => mergeWithEnglish(item, items[index])) as T;
  }
  if (isRecord(english)) {
    const source = isRecord(localized) ? localized : {};
    const merged: Record<string, unknown> = {};
    for (const key of Object.keys(english)) {
      merged[key] = mergeWithEnglish(english[key], source[key]);
    }
    return merged as T;
  }
  if (typeof localized === "string" && localized.length > 0) return localized as T;
  return english;
}

function dictionaryFor(locale: Locale): Dictionary {
  return mergeWithEnglish(dictionaries.en, dictionaries[locale]);
}

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh-TW");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) setLocaleState(stored);
  }, []);

  useEffect(() => {
    const meta = LOCALES.find((item) => item.code === locale) ?? LOCALES[0];
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = meta.htmlLang;
    document.documentElement.dir = meta.dir;
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale: setLocaleState,
      t: dictionaryFor(locale),
    }),
    [locale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useI18n must be used within LanguageProvider");
  }
  return context;
}
