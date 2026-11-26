import { useEffect, useId, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { ITheme } from "@xterm/xterm";
import {
  Bug,
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  Keyboard,
  Languages,
  Minus,
  Monitor,
  Palette,
  Plus,
  RotateCcw,
  Sliders,
  Tag,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import { APP_META } from "../config/appMeta";
import type { AppSettings, CursorStyle } from "../hooks/useSettings";
import { useI18n, type LanguagePreference } from "../i18n";
import {
  getThemeDisplayDescription,
  getThemeDisplayName,
  THEME_LIST,
  THEMES,
  type ThemeDefinition,
  type ThemePreference,
} from "../themes/themes";
import {
  formatShortcut,
  getShellOptionsForPlatform,
  type PlatformId,
} from "../utils/platform";
import { AppLogo } from "./AppLogo";

export type SettingsTab = "appearance" | "terminal" | "general" | "about";

interface SettingsModalProps {
  isOpen: boolean;
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  onClose: () => void;
  preference: ThemePreference;
  activeTheme: ThemeDefinition;
  effectiveTerminalTheme: ITheme;
  systemDark: boolean;
  platform: PlatformId;
  onChangeTheme: (pref: ThemePreference) => void;
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onResetSettings: () => void;
  configPath: string;
  configError: string | null;
  onOpenConfigFolder: () => void;
  onExportConfig: () => Promise<void>;
  onImportConfig: (replace: boolean) => Promise<void>;
  onOpenUrl: (url: string) => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-modal)]";

const EDITOR_PRESETS = ["code", "cursor", "windsurf"];

const LINE_HEIGHT_OPTIONS = [1.15, 1.25, 1.35, 1.5];
const SCROLLBACK_OPTIONS = [2000, 5000, 10000, 20000];
const TECH_STACK_BADGES = [
  "Tauri 2",
  "React 19",
  "TypeScript",
  "xterm.js 6",
  "Rust PTY",
];

export function SettingsModal({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  preference,
  activeTheme,
  effectiveTerminalTheme,
  systemDark,
  platform,
  onChangeTheme,
  settings,
  onUpdateSettings,
  onResetSettings,
  configPath,
  configError,
  onOpenConfigFolder,
  onExportConfig,
  onImportConfig,
  onOpenUrl,
}: SettingsModalProps) {
  const { m, locale } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const [appVersion, setAppVersion] = useState<string>(APP_META.version);
  const [copiedEmail, setCopiedEmail] = useState(false);

  useEffect(() => {
    getVersion()
      .then((ver) => {
        if (ver) setAppVersion(ver);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;

    const handleClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) {
        dialog.close();
      }
    };

    dialog.addEventListener("click", handleClick);
    return () => dialog.removeEventListener("click", handleClick);
  }, []);

  const darkThemes = THEME_LIST.filter((t) => t.scheme === "dark");
  const lightThemes = THEME_LIST.filter((t) => t.scheme === "light");

  const navItems: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
    { id: "appearance", label: m.settings.tabs.appearance, icon: Palette },
    { id: "terminal", label: m.settings.tabs.terminal, icon: Terminal },
    { id: "general", label: m.settings.tabs.general, icon: Sliders },
    { id: "about", label: m.settings.tabs.about, icon: Info },
  ];

  const cursorStyleOptions: { value: CursorStyle; label: string }[] = [
    { value: "block", label: m.settings.terminal.cursorBlock },
    { value: "bar", label: m.settings.terminal.cursorBar },
    { value: "underline", label: m.settings.terminal.cursorUnderline },
  ];

  const languageOptions: { value: LanguagePreference; label: string }[] = [
    { value: "system", label: m.settings.general.langSystem },
    { value: "zh-CN", label: m.settings.general.langZhCN },
    { value: "en", label: m.settings.general.langEn },
  ];

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard?.writeText(APP_META.email);
      setCopiedEmail(true);
      window.setTimeout(() => setCopiedEmail(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      {...({ closedby: "any" } as Record<string, string>)}
      style={{ boxShadow: "var(--dp-shadow)" }}
      className="devpanel-dialog m-auto h-[min(580px,calc(100vh-2.5rem))] w-[calc(100vw-2rem)] max-w-2xl overflow-hidden rounded-xl border border-[var(--dp-border)] bg-[var(--dp-modal)] p-0 text-[var(--dp-fg)]"
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--dp-border)] px-5 py-3.5 select-none">
          <div className="flex items-center gap-2">
            <Sliders
              className="h-4 w-4 text-[var(--dp-info)]"
              aria-hidden="true"
            />
            <h3 id={titleId} className="text-sm font-semibold text-[var(--dp-fg)]">
              {m.settings.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={m.settings.closeSettingsAria}
            className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
          {/* Category Navigation */}
          <nav
            aria-label={m.settings.navAria}
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--dp-border)] bg-[var(--dp-sidebar)] p-2 select-none sm:w-40 sm:flex-col sm:space-y-1 sm:gap-0 sm:overflow-x-visible sm:border-r sm:border-b-0 sm:p-2.5"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const selected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => onTabChange(item.id)}
                  className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium whitespace-nowrap transition-colors sm:w-full ${
                    selected
                      ? "bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                      : "text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)]"
                  } ${FOCUS_RING}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Panel Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === "appearance" && (
              <div className="space-y-5">
                <div>
                  <h4 className="text-xs font-semibold text-[var(--dp-fg)]">
                    {m.settings.appearance.heading}
                  </h4>
                  <p className="mt-0.5 text-[11px] text-[var(--dp-fg-muted)]">
                    {m.settings.appearance.desc}
                  </p>
                </div>

                {/* System Option */}
                <button
                  type="button"
                  onClick={() => onChangeTheme("system")}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${
                    preference === "system"
                      ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)]"
                      : "border-[var(--dp-border)] bg-[var(--dp-surface)] hover:border-[var(--dp-border-strong)]"
                  } ${FOCUS_RING}`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-info)]">
                      <Monitor className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-[var(--dp-fg)]">
                        {m.settings.appearance.followSystem}
                      </div>
                      <div className="text-[11px] text-[var(--dp-fg-muted)]">
                        {systemDark
                          ? m.settings.appearance.currentSystemDark(
                              getThemeDisplayName(THEMES.midnight, locale)
                            )
                          : m.settings.appearance.currentSystemLight(
                              getThemeDisplayName(THEMES.daylight, locale)
                            )}
                      </div>
                    </div>
                  </div>
                  {preference === "system" && (
                    <Check
                      className="h-4 w-4 shrink-0 text-[var(--dp-info-text)]"
                      aria-hidden="true"
                    />
                  )}
                </button>

                {/* Dark Themes */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold tracking-wider text-[var(--dp-fg-muted)] uppercase">
                    {m.settings.appearance.darkThemes}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {darkThemes.map((theme) => {
                      const selected = preference === theme.id;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => onChangeTheme(theme.id)}
                          className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
                            selected
                              ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)]"
                              : "border-[var(--dp-border)] bg-[var(--dp-surface)] hover:border-[var(--dp-border-strong)]"
                          } ${FOCUS_RING}`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              aria-hidden="true"
                              className="flex items-center -space-x-1"
                            >
                              {theme.swatches.map((hex, i) => (
                                <span
                                  key={i}
                                  style={{ backgroundColor: hex }}
                                  className="h-3.5 w-3.5 rounded-full border border-white/25"
                                />
                              ))}
                            </span>
                            {selected && (
                              <Check
                                className="h-3.5 w-3.5 text-[var(--dp-info-text)]"
                                aria-hidden="true"
                              />
                            )}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-[var(--dp-fg)]">
                              {getThemeDisplayName(theme, locale)}
                            </div>
                            <div className="mt-0.5 text-[10px] leading-snug text-[var(--dp-fg-muted)]">
                              {getThemeDisplayDescription(theme, locale)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Light Themes */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold tracking-wider text-[var(--dp-fg-muted)] uppercase">
                    {m.settings.appearance.lightThemes}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {lightThemes.map((theme) => {
                      const selected = preference === theme.id;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => onChangeTheme(theme.id)}
                          className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
                            selected
                              ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)]"
                              : "border-[var(--dp-border)] bg-[var(--dp-surface)] hover:border-[var(--dp-border-strong)]"
                          } ${FOCUS_RING}`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              aria-hidden="true"
                              className="flex items-center -space-x-1"
                            >
                              {theme.swatches.map((hex, i) => (
                                <span
                                  key={i}
                                  style={{ backgroundColor: hex }}
                                  className="h-3.5 w-3.5 rounded-full border border-black/15"
                                />
                              ))}
                            </span>
                            {selected && (
                              <Check
                                className="h-3.5 w-3.5 text-[var(--dp-info-text)]"
                                aria-hidden="true"
                              />
                            )}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-[var(--dp-fg)]">
                              {getThemeDisplayName(theme, locale)}
                            </div>
                            <div className="mt-0.5 text-[10px] leading-snug text-[var(--dp-fg-muted)]">
                              {getThemeDisplayDescription(theme, locale)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Terminal Dark Override in Light Mode */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] px-3.5 py-3">
                  <div>
                    <div className="text-xs font-medium text-[var(--dp-fg)]">
                      {m.settings.appearance.keepTermDarkTitle}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--dp-fg-muted)]">
                      {m.settings.appearance.keepTermDarkDesc}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.keepTerminalDarkInLightMode}
                    onClick={() =>
                      onUpdateSettings({
                        keepTerminalDarkInLightMode:
                          !settings.keepTerminalDarkInLightMode,
                      })
                    }
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                      settings.keepTerminalDarkInLightMode
                        ? "border-[var(--dp-accent)] bg-[var(--dp-accent)]"
                        : "border-[var(--dp-border-strong)] bg-[var(--dp-bg)]"
                    } ${FOCUS_RING}`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform ${
                        settings.keepTerminalDarkInLightMode
                          ? "translate-x-4"
                          : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {activeTab === "terminal" && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-[var(--dp-fg)]">
                    {m.settings.terminal.heading}
                  </h4>
                  <p className="mt-0.5 text-[11px] text-[var(--dp-fg-muted)]">
                    {m.settings.terminal.desc}
                  </p>
                </div>

                {/* Font Size */}
                <div className="space-y-2 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--dp-fg)]">
                      {m.settings.terminal.fontSize}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            terminalFontSize: settings.terminalFontSize - 1,
                          })
                        }
                        aria-label={m.settings.terminal.decreaseFontAria}
                        className={`cursor-pointer rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] p-1 text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] ${FOCUS_RING}`}
                      >
                        <Minus className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <span className="w-11 text-center font-mono-dev text-xs font-semibold tabular-nums text-[var(--dp-fg)]">
                        {settings.terminalFontSize}px
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            terminalFontSize: settings.terminalFontSize + 1,
                          })
                        }
                        aria-label={m.settings.terminal.increaseFontAria}
                        className={`cursor-pointer rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] p-1 text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] ${FOCUS_RING}`}
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={11}
                    max={18}
                    step={1}
                    aria-label={m.settings.terminal.fontSliderAria}
                    value={settings.terminalFontSize}
                    onChange={(e) =>
                      onUpdateSettings({
                        terminalFontSize: Number(e.target.value),
                      })
                    }
                    className="w-full cursor-pointer"
                  />
                </div>

                {/* Line Height */}
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                  <span className="text-xs font-medium text-[var(--dp-fg)]">
                    {m.settings.terminal.lineHeight}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {LINE_HEIGHT_OPTIONS.map((lh) => {
                      const active = settings.terminalLineHeight === lh;
                      return (
                        <button
                          key={lh}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({ terminalLineHeight: lh })
                          }
                          className={`cursor-pointer rounded-md border px-2.5 py-1 font-mono-dev text-[11px] font-medium tabular-nums transition-colors ${
                            active
                              ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                              : "border-[var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-fg-secondary)] hover:text-[var(--dp-fg)]"
                          } ${FOCUS_RING}`}
                        >
                          {lh}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Cursor Style & Blink */}
                <div className="space-y-3 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--dp-fg)]">
                      {m.settings.terminal.cursorStyle}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {cursorStyleOptions.map((opt) => {
                        const active =
                          settings.terminalCursorStyle === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              onUpdateSettings({
                                terminalCursorStyle: opt.value,
                              })
                            }
                            className={`cursor-pointer rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              active
                                ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                                : "border-[var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-fg-secondary)] hover:text-[var(--dp-fg)]"
                            } ${FOCUS_RING}`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-[var(--dp-border-subtle)] pt-3">
                    <span className="text-xs font-medium text-[var(--dp-fg)]">
                      {m.settings.terminal.cursorBlink}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.terminalCursorBlink}
                      onClick={() =>
                        onUpdateSettings({
                          terminalCursorBlink: !settings.terminalCursorBlink,
                        })
                      }
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                        settings.terminalCursorBlink
                          ? "border-[var(--dp-accent)] bg-[var(--dp-accent)]"
                          : "border-[var(--dp-border-strong)] bg-[var(--dp-bg)]"
                      } ${FOCUS_RING}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform ${
                          settings.terminalCursorBlink
                            ? "translate-x-4"
                            : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Scrollback */}
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                  <span className="text-xs font-medium text-[var(--dp-fg)]">
                    {m.settings.terminal.scrollback}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {SCROLLBACK_OPTIONS.map((rows) => {
                      const active = settings.terminalScrollback === rows;
                      return (
                        <button
                          key={rows}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({ terminalScrollback: rows })
                          }
                          className={`cursor-pointer rounded-md border px-2 py-1 font-mono-dev text-[11px] font-medium tabular-nums transition-colors ${
                            active
                              ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                              : "border-[var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-fg-secondary)] hover:text-[var(--dp-fg)]"
                          } ${FOCUS_RING}`}
                        >
                          {rows}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Live Terminal Preview */}
                <div
                  style={{
                    backgroundColor: effectiveTerminalTheme.background,
                    color: effectiveTerminalTheme.foreground,
                    fontSize: `${settings.terminalFontSize}px`,
                    lineHeight: settings.terminalLineHeight,
                  }}
                  className="rounded-xl border border-[var(--dp-border)] p-3 font-mono-dev"
                >
                  <div>
                    <span style={{ color: effectiveTerminalTheme.green }}>
                      PS D:\Code\DevPanel&gt;
                    </span>{" "}
                    npm run dev
                  </div>
                  <div style={{ color: effectiveTerminalTheme.cyan }}>
                    {m.settings.terminal.previewReady(
                      getThemeDisplayName(activeTheme, locale)
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "general" && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-[var(--dp-fg)]">
                    {m.settings.general.heading}
                  </h4>
                  <p className="mt-0.5 text-[11px] text-[var(--dp-fg-muted)]">
                    {m.settings.general.desc}
                  </p>
                </div>

                {/* Language Selector */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                  <div className="flex items-center gap-2 text-xs font-medium text-[var(--dp-fg)]">
                    <Languages
                      className="h-3.5 w-3.5 text-[var(--dp-info)]"
                      aria-hidden="true"
                    />
                    {m.settings.general.languageLabel}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {languageOptions.map((opt) => {
                      const active = settings.language === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({ language: opt.value })
                          }
                          className={`cursor-pointer rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            active
                              ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                              : "border-[var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-fg-secondary)] hover:text-[var(--dp-fg)]"
                          } ${FOCUS_RING}`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Default Shell */}
                <div className="space-y-2 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                  <div className="text-xs font-medium text-[var(--dp-fg)]">
                    {m.settings.general.defaultShell}
                  </div>
                  <div className="space-y-1.5">
                    {getShellOptionsForPlatform(platform).map((opt) => {
                      const active = settings.defaultShell === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({ defaultShell: opt.value })
                          }
                          className={`flex w-full cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                            active
                              ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                              : "border-[var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-fg-secondary)] hover:text-[var(--dp-fg)]"
                          } ${FOCUS_RING}`}
                        >
                          <span className="font-mono-dev text-[11px]">
                            {opt.label}
                          </span>
                          {active && (
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Close to Tray & Crash Notify */}
                <div className="space-y-3 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium text-[var(--dp-fg)]">
                        {m.settings.general.closeToTrayTitle}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--dp-fg-muted)]">
                        {m.settings.general.closeToTrayDesc}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.closeToTray}
                      onClick={() =>
                        onUpdateSettings({ closeToTray: !settings.closeToTray })
                      }
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                        settings.closeToTray
                          ? "border-[var(--dp-accent)] bg-[var(--dp-accent)]"
                          : "border-[var(--dp-border-strong)] bg-[var(--dp-bg)]"
                      } ${FOCUS_RING}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform ${
                          settings.closeToTray
                            ? "translate-x-4"
                            : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-4 border-t border-[var(--dp-border-subtle)] pt-3">
                    <div>
                      <div className="text-xs font-medium text-[var(--dp-fg)]">
                        {m.settings.general.crashNotifyTitle}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--dp-fg-muted)]">
                        {m.settings.general.crashNotifyDesc}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.notifyOnCrash}
                      onClick={() =>
                        onUpdateSettings({
                          notifyOnCrash: !settings.notifyOnCrash,
                        })
                      }
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                        settings.notifyOnCrash
                          ? "border-[var(--dp-accent)] bg-[var(--dp-accent)]"
                          : "border-[var(--dp-border-strong)] bg-[var(--dp-bg)]"
                      } ${FOCUS_RING}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform ${
                          settings.notifyOnCrash
                            ? "translate-x-4"
                            : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* External Editor */}
                <div className="space-y-2 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--dp-fg)]">
                      {m.settings.general.editorCommand}
                    </span>
                    <div className="flex items-center gap-1">
                      {EDITOR_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({ editorCommand: preset })
                          }
                          className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono-dev text-[10px] transition-colors ${
                            settings.editorCommand === preset
                              ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                              : "border-[var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
                          } ${FOCUS_RING}`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={settings.editorCommand}
                    onChange={(e) =>
                      onUpdateSettings({ editorCommand: e.target.value })
                    }
                    placeholder={m.settings.general.editorPlaceholder}
                    aria-label={m.settings.general.editorCommand}
                    className="dp-input w-full rounded-md border border-[var(--dp-border)] bg-[var(--dp-input-bg)] px-3 py-1.5 font-mono-dev text-xs text-[var(--dp-fg)] focus:border-[var(--dp-info)] focus:outline-none focus:ring-2 focus:ring-[var(--dp-info)]/25"
                  />
                </div>

                {/* Config Path & Import/Export */}
                <div className="space-y-2.5 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--dp-fg)]">
                      {m.settings.general.configFileTitle}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        configError
                          ? "border-[var(--dp-warning-border)] bg-[var(--dp-warning-soft)] text-[var(--dp-warning-text)]"
                          : "border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] text-[var(--dp-accent-text)]"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full ${
                          configError
                            ? "bg-[var(--dp-warning)]"
                            : "bg-[var(--dp-accent)]"
                        }`}
                      />
                      {configError
                        ? m.settings.general.configParseError
                        : m.settings.general.configWatching}
                    </span>
                  </div>
                  <div className="rounded-md border border-[var(--dp-border)] bg-[var(--dp-bg)] px-2.5 py-1.5 font-mono-dev text-[11px] break-all text-[var(--dp-fg-secondary)]">
                    {configPath || "~/.dev-panel/projects.json"}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={onOpenConfigFolder}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-border)] bg-[var(--dp-bg)] px-3 py-1.5 text-xs font-medium text-[var(--dp-fg)] transition-colors hover:bg-[var(--dp-surface-hover)] ${FOCUS_RING}`}
                    >
                      <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      {m.common.openFolder}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onExportConfig()}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-border)] bg-[var(--dp-bg)] px-3 py-1.5 text-xs font-medium text-[var(--dp-fg)] transition-colors hover:bg-[var(--dp-surface-hover)] ${FOCUS_RING}`}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      {m.settings.general.exportBackup}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onImportConfig(false)}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] px-3 py-1.5 text-xs font-medium text-[var(--dp-info-text)] transition-colors hover:opacity-90 ${FOCUS_RING}`}
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      {m.settings.general.mergeImport}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onImportConfig(true)}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-warning-border)] bg-[var(--dp-warning-soft)] px-3 py-1.5 text-xs font-medium text-[var(--dp-warning-text)] transition-colors hover:opacity-90 ${FOCUS_RING}`}
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      {m.settings.general.replaceImport}
                    </button>
                  </div>
                </div>

                {/* Shortcuts Cheat Sheet */}
                <div className="space-y-2 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--dp-fg)]">
                    <Keyboard
                      className="h-3.5 w-3.5 text-[var(--dp-info)]"
                      aria-hidden="true"
                    />
                    {m.settings.general.shortcutsTitle}
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
                    {[
                      { label: m.settings.general.scToggleLog, keys: "Ctrl+J" },
                      { label: m.settings.general.scSearchLog, keys: "Ctrl+F" },
                      {
                        label: m.settings.general.scFocusSearch,
                        keys: "Ctrl+K",
                      },
                      {
                        label: m.settings.general.scNewProject,
                        keys: "Ctrl+N",
                      },
                      {
                        label: m.settings.general.scRestartProject,
                        keys: "Ctrl+Shift+R",
                      },
                      {
                        label: m.settings.general.scOpenSettings,
                        keys: "Ctrl+,",
                      },
                    ].map((item) => (
                      <div
                        key={item.keys}
                        className="flex items-center justify-between rounded border border-[var(--dp-border-subtle)] bg-[var(--dp-bg)]/60 px-2.5 py-1"
                      >
                        <span className="text-[var(--dp-fg-secondary)]">
                          {item.label}
                        </span>
                        <kbd className="font-mono-dev text-[10px] font-semibold text-[var(--dp-fg)]">
                          {formatShortcut(item.keys, platform)}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Reset Defaults */}
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                  <div>
                    <div className="text-xs font-medium text-[var(--dp-fg)]">
                      {m.settings.general.resetTitle}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--dp-fg-muted)]">
                      {m.settings.general.resetDesc}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onResetSettings();
                      onChangeTheme("system");
                    }}
                    className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-danger-border)] bg-[var(--dp-danger-soft)] px-3 py-1.5 text-xs font-medium text-[var(--dp-danger-text)] transition-colors hover:opacity-90 ${FOCUS_RING}`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    {m.settings.general.resetBtn}
                  </button>
                </div>
              </div>
            )}

            {activeTab === "about" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3.5">
                  <AppLogo className="h-12 w-12 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold tracking-tight text-[var(--dp-fg)]">
                        {APP_META.name}
                      </span>
                      <span className="rounded-full border border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] px-2 py-0.5 font-mono-dev text-[10px] font-medium text-[var(--dp-info-text)]">
                        v{appVersion}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--dp-fg-secondary)]">
                      {locale === "en" ? APP_META.taglineEn : APP_META.tagline}
                    </p>
                  </div>
                </div>

                <div className="divide-y divide-[var(--dp-border-subtle)] rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] text-xs">
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-[var(--dp-fg-muted)]">
                      {m.settings.about.author}
                    </span>
                    <span className="font-medium text-[var(--dp-fg)]">
                      {APP_META.author}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-[var(--dp-fg-muted)]">
                      {m.settings.about.email}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-mono-dev text-[11px] text-[var(--dp-fg)]">
                      <span>{APP_META.email}</span>
                      <button
                        type="button"
                        onClick={() => void handleCopyEmail()}
                        aria-label={m.settings.about.copyEmailAria}
                        title={
                          copiedEmail ? m.common.copied : m.common.copy
                        }
                        className={`cursor-pointer rounded p-0.5 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                      >
                        {copiedEmail ? (
                          <Check
                            className="h-3 w-3 text-[var(--dp-accent)]"
                            aria-hidden="true"
                          />
                        ) : (
                          <Copy className="h-3 w-3" aria-hidden="true" />
                        )}
                      </button>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="shrink-0 text-[var(--dp-fg-muted)]">
                      {m.settings.about.repository}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenUrl(APP_META.repository)}
                      className={`inline-flex min-w-0 cursor-pointer items-center gap-1 truncate font-mono-dev text-[11px] text-[var(--dp-info-text)] hover:underline ${FOCUS_RING}`}
                    >
                      <span className="truncate">{APP_META.repository}</span>
                      <ExternalLink
                        className="h-3 w-3 shrink-0"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-[var(--dp-fg-muted)]">
                      {m.settings.about.license}
                    </span>
                    <span className="font-mono-dev text-[11px] text-[var(--dp-fg)]">
                      {APP_META.license}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-[var(--dp-fg-muted)]">
                      {m.settings.about.copyright}
                    </span>
                    <span className="text-[11px] text-[var(--dp-fg-secondary)]">
                      {APP_META.copyright}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                    <span className="text-[var(--dp-fg-muted)]">
                      {m.settings.about.techStack}
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                      {TECH_STACK_BADGES.map((badge) => (
                        <span
                          key={badge}
                          className="rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-1.5 py-0.5 font-mono-dev text-[10px] text-[var(--dp-fg-secondary)]"
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onOpenUrl(APP_META.repository)}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] px-3 py-1.5 text-xs font-medium text-[var(--dp-info-text)] transition-colors hover:opacity-90 ${FOCUS_RING}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    {m.settings.about.githubRepo}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenUrl(APP_META.issuesUrl)}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] px-3 py-1.5 text-xs font-medium text-[var(--dp-fg)] transition-colors hover:bg-[var(--dp-surface-hover)] ${FOCUS_RING}`}
                  >
                    <Bug className="h-3.5 w-3.5" aria-hidden="true" />
                    {m.settings.about.reportIssue}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenUrl(APP_META.releasesUrl)}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] px-3 py-1.5 text-xs font-medium text-[var(--dp-fg)] transition-colors hover:bg-[var(--dp-surface-hover)] ${FOCUS_RING}`}
                  >
                    <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                    {m.settings.about.releases}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
