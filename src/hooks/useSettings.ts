import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  sanitizeLanguagePreference,
  type LanguagePreference,
} from "../i18n";
import {
  detectInitialPlatform,
  getDefaultShellForPlatform,
  type PlatformId,
} from "../utils/platform";

export type CursorStyle = "block" | "bar" | "underline";

export interface AppSettings {
  language: LanguagePreference;
  terminalFontSize: number;
  terminalLineHeight: number;
  terminalCursorStyle: CursorStyle;
  terminalCursorBlink: boolean;
  terminalScrollback: number;
  keepTerminalDarkInLightMode: boolean;
  defaultShell: string;
  closeToTray: boolean;
  notifyOnCrash: boolean;
  editorCommand: string;
}

export const SETTINGS_STORAGE_KEY = "devpanel-settings-v1";

const INITIAL_PLATFORM = detectInitialPlatform();

export const DEFAULT_SETTINGS: AppSettings = {
  language: "system",
  terminalFontSize: 13,
  terminalLineHeight: 1.35,
  terminalCursorStyle: "block",
  terminalCursorBlink: true,
  terminalScrollback: 5000,
  keepTerminalDarkInLightMode: false,
  defaultShell: getDefaultShellForPlatform(INITIAL_PLATFORM),
  closeToTray: true,
  notifyOnCrash: true,
  editorCommand: "code",
};

function clampFontSize(val: unknown): number {
  if (typeof val !== "number" || Number.isNaN(val)) {
    return DEFAULT_SETTINGS.terminalFontSize;
  }
  return Math.min(18, Math.max(11, Math.round(val)));
}

function sanitizeLineHeight(val: unknown): number {
  if (typeof val !== "number" || Number.isNaN(val)) {
    return DEFAULT_SETTINGS.terminalLineHeight;
  }
  return Math.min(1.8, Math.max(1.0, Number(val.toFixed(2))));
}

function sanitizeCursorStyle(val: unknown): CursorStyle {
  return val === "bar" || val === "underline" || val === "block"
    ? val
    : DEFAULT_SETTINGS.terminalCursorStyle;
}

function sanitizeScrollback(val: unknown): number {
  if (typeof val !== "number" || Number.isNaN(val)) {
    return DEFAULT_SETTINGS.terminalScrollback;
  }
  return Math.min(50000, Math.max(1000, Math.round(val)));
}

function parseSettings(raw: string | null): AppSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      language: sanitizeLanguagePreference(parsed.language),
      terminalFontSize: clampFontSize(parsed.terminalFontSize),
      terminalLineHeight: sanitizeLineHeight(parsed.terminalLineHeight),
      terminalCursorStyle: sanitizeCursorStyle(parsed.terminalCursorStyle),
      terminalCursorBlink:
        typeof parsed.terminalCursorBlink === "boolean"
          ? parsed.terminalCursorBlink
          : DEFAULT_SETTINGS.terminalCursorBlink,
      terminalScrollback: sanitizeScrollback(parsed.terminalScrollback),
      keepTerminalDarkInLightMode:
        typeof parsed.keepTerminalDarkInLightMode === "boolean"
          ? parsed.keepTerminalDarkInLightMode
          : DEFAULT_SETTINGS.keepTerminalDarkInLightMode,
      defaultShell:
        typeof parsed.defaultShell === "string" && parsed.defaultShell.trim()
          ? parsed.defaultShell.trim()
          : DEFAULT_SETTINGS.defaultShell,
      closeToTray:
        typeof parsed.closeToTray === "boolean"
          ? parsed.closeToTray
          : DEFAULT_SETTINGS.closeToTray,
      notifyOnCrash:
        typeof parsed.notifyOnCrash === "boolean"
          ? parsed.notifyOnCrash
          : DEFAULT_SETTINGS.notifyOnCrash,
      editorCommand:
        typeof parsed.editorCommand === "string" && parsed.editorCommand.trim()
          ? parsed.editorCommand.trim()
          : DEFAULT_SETTINGS.editorCommand,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function readStoredSettings(): AppSettings {
  try {
    return parseSettings(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(readStoredSettings);
  const [platform, setPlatform] = useState<PlatformId>(INITIAL_PLATFORM);

  useEffect(() => {
    invoke<PlatformId>("get_platform")
      .then((os) => {
        if (os === "windows" || os === "macos" || os === "linux") {
          setPlatform(os);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    invoke("set_close_to_tray", { enabled: settings.closeToTray }).catch(() => {});
  }, [settings.closeToTray]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SETTINGS_STORAGE_KEY) return;
      setSettings(parseSettings(event.newValue));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next: AppSettings = {
        ...prev,
        ...patch,
        language: sanitizeLanguagePreference(patch.language ?? prev.language),
        terminalFontSize: clampFontSize(
          patch.terminalFontSize ?? prev.terminalFontSize
        ),
        terminalLineHeight: sanitizeLineHeight(
          patch.terminalLineHeight ?? prev.terminalLineHeight
        ),
        terminalCursorStyle: sanitizeCursorStyle(
          patch.terminalCursorStyle ?? prev.terminalCursorStyle
        ),
        terminalScrollback: sanitizeScrollback(
          patch.terminalScrollback ?? prev.terminalScrollback
        ),
        editorCommand:
          typeof (patch.editorCommand ?? prev.editorCommand) === "string" &&
          (patch.editorCommand ?? prev.editorCommand).trim()
            ? (patch.editorCommand ?? prev.editorCommand).trim()
            : DEFAULT_SETTINGS.editorCommand,
      };
      try {
        window.localStorage.setItem(
          SETTINGS_STORAGE_KEY,
          JSON.stringify(next)
        );
      } catch {
        // Ignore storage quota or access errors
      }
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    const resetValue: AppSettings = {
      ...DEFAULT_SETTINGS,
      defaultShell: getDefaultShellForPlatform(platform),
    };
    setSettings(resetValue);
    try {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, [platform]);

  return {
    settings,
    platform,
    updateSettings,
    resetSettings,
  };
}
