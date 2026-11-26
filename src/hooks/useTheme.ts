import { useCallback, useEffect, useState } from "react";
import {
  isValidThemeId,
  resolveThemeId,
  THEME_STORAGE_KEY,
  THEMES,
  type ThemeDefinition,
  type ThemePreference,
} from "../themes/themes";

function readStoredPreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isValidThemeId(raw)) {
      return raw;
    }
  } catch {
    // Ignore storage access failures
  }
  return "system";
}

function readSystemDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return true;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyThemeToDocument(
  preference: ThemePreference,
  activeTheme: ThemeDefinition
) {
  const root = document.documentElement;
  root.dataset.theme = activeTheme.id;
  root.classList.toggle("dark", activeTheme.scheme === "dark");

  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute(
      "content",
      preference === "system" ? "light dark" : activeTheme.scheme
    );
  }
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    readStoredPreference
  );
  const [systemDark, setSystemDark] = useState<boolean>(readSystemDark);

  const activeThemeId = resolveThemeId(preference, systemDark);
  const activeTheme = THEMES[activeThemeId];

  useEffect(() => {
    applyThemeToDocument(preference, activeTheme);
  }, [preference, activeTheme]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setPreferenceState(
        isValidThemeId(event.newValue) ? event.newValue : "system"
      );
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      if (next === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // Ignore storage write failures; theme still applies in memory
    }
  }, []);

  return {
    preference,
    setPreference,
    activeTheme,
    systemDark,
  };
}
