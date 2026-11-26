import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { en } from "./en";
import { zhCN, type Messages } from "./zh-CN";

export type Locale = "zh-CN" | "en";
export type LanguagePreference = "system" | Locale;

export function sanitizeLanguagePreference(val: unknown): LanguagePreference {
  if (val === "zh-CN" || val === "en" || val === "system") {
    return val;
  }
  return "system";
}

export function detectSystemLocale(): Locale {
  if (typeof navigator === "undefined") {
    return "zh-CN";
  }
  const primary = (
    navigator.languages?.[0] ||
    navigator.language ||
    "zh-CN"
  ).toLowerCase();
  return primary.startsWith("zh") ? "zh-CN" : "en";
}

export function resolveLocale(
  preference: LanguagePreference,
  systemLocale: Locale
): Locale {
  return preference === "system" ? systemLocale : preference;
}

export function getMessages(locale: Locale): Messages {
  return locale === "en" ? en : zhCN;
}

export interface I18nContextValue {
  locale: Locale;
  languagePreference: LanguagePreference;
  setLanguagePreference: (next: LanguagePreference) => void;
  toggleLocale: () => void;
  m: Messages;
}

const DEFAULT_I18N: I18nContextValue = {
  locale: "zh-CN",
  languagePreference: "system",
  setLanguagePreference: () => {},
  toggleLocale: () => {},
  m: zhCN,
};

export const I18nContext = createContext<I18nContextValue>(DEFAULT_I18N);

export function useI18nController(
  languagePreference: LanguagePreference,
  onChangePreference: (next: LanguagePreference) => void
): I18nContextValue {
  const [systemLocale, setSystemLocale] = useState<Locale>(detectSystemLocale);

  useEffect(() => {
    const handleLanguageChange = () => {
      setSystemLocale(detectSystemLocale());
    };
    window.addEventListener("languagechange", handleLanguageChange);
    return () =>
      window.removeEventListener("languagechange", handleLanguageChange);
  }, []);

  const locale = resolveLocale(languagePreference, systemLocale);
  const m = useMemo(() => getMessages(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    invoke("set_locale", { locale }).catch(() => {});
  }, [locale]);

  const toggleLocale = useCallback(() => {
    const next: Locale = locale === "zh-CN" ? "en" : "zh-CN";
    onChangePreference(next);
  }, [locale, onChangePreference]);

  return useMemo(
    () => ({
      locale,
      languagePreference,
      setLanguagePreference: onChangePreference,
      toggleLocale,
      m,
    }),
    [locale, languagePreference, onChangePreference, toggleLocale, m]
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
