import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Copy,
  Languages,
  MemoryStick,
  Minus,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  PictureInPicture2,
  Pin,
  PinOff,
  Settings,
  Square,
  X,
} from "lucide-react";
import { useI18n } from "../i18n";
import {
  getThemeDisplayName,
  type ThemeDefinition,
  type ThemePreference,
} from "../themes/themes";
import type { MemorySnapshot } from "../types/project";
import { formatBytesCompact, getMemoryLevel } from "../utils/memoryFormat";
import { formatShortcut, type PlatformId } from "../utils/platform";
import { AppLogo } from "./AppLogo";
import type { SettingsTab } from "./SettingsModal";

interface TitleBarProps {
  runningCount: number;
  totalCount: number;
  preference: ThemePreference;
  activeTheme: ThemeDefinition;
  platform: PlatformId;
  closeToTray: boolean;
  logCollapsed: boolean;
  alwaysOnTop: boolean;
  memorySnapshot?: MemorySnapshot | null;
  onToggleLogPanel: () => void;
  onToggleAlwaysOnTop: () => void;
  onEnterMiniMode: () => void;
  onStopAllProjects: () => void;
  onOpenSettings: (tab: SettingsTab) => void;
  onOpenMemoryMonitor: () => void;
  onMaximizedChange?: (maximized: boolean) => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-titlebar)]";

function getSafeWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export function TitleBar({
  runningCount,
  totalCount,
  preference,
  activeTheme,
  platform,
  closeToTray,
  logCollapsed,
  alwaysOnTop,
  memorySnapshot,
  onToggleLogPanel,
  onToggleAlwaysOnTop,
  onEnterMiniMode,
  onStopAllProjects,
  onOpenSettings,
  onOpenMemoryMonitor,
  onMaximizedChange,
}: TitleBarProps) {
  const { m, locale, toggleLocale } = useI18n();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getSafeWindow();
    if (!win) return;

    let mounted = true;
    let unlistenResize: (() => void) | null = null;

    const syncMaximized = async () => {
      try {
        const maximized = await win.isMaximized();
        if (!mounted) return;
        setIsMaximized(maximized);
        onMaximizedChange?.(maximized);
      } catch {
        // Ignore outside Tauri runtime
      }
    };

    syncMaximized();
    win
      .onResized(() => {
        syncMaximized();
      })
      .then((unlisten) => {
        if (mounted) {
          unlistenResize = unlisten;
        } else {
          unlisten();
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
      unlistenResize?.();
    };
  }, [onMaximizedChange]);

  const handleMinimize = async () => {
    await getSafeWindow()?.minimize().catch(() => {});
  };

  const handleToggleMaximize = async () => {
    const win = getSafeWindow();
    if (!win) return;
    try {
      await win.toggleMaximize();
      const maximized = await win.isMaximized();
      setIsMaximized(maximized);
      onMaximizedChange?.(maximized);
    } catch {
      // Ignore
    }
  };

  const handleClose = async () => {
    await getSafeWindow()?.close().catch(() => {});
  };

  const displayThemeName = getThemeDisplayName(activeTheme, locale);
  const themeBadgeLabel =
    preference === "system"
      ? m.titleBar.systemThemeBadge(displayThemeName)
      : displayThemeName;

  const sysPercent = memorySnapshot?.system.usagePercent ?? null;
  const memLevel = sysPercent !== null ? getMemoryLevel(sysPercent) : "normal";
  const managedRss = memorySnapshot?.managedTotalRssBytes ?? 0;
  const systemTitleText =
    memorySnapshot && memorySnapshot.system.totalBytes > 0
      ? `${sysPercent?.toFixed(1)}% (${formatBytesCompact(memorySnapshot.system.usedBytes)} / ${formatBytesCompact(memorySnapshot.system.totalBytes)})`
      : "--";
  const managedTitleText = formatBytesCompact(managedRss);
  const memoryPillColorClass =
    memLevel === "danger"
      ? "border-[var(--dp-danger-border)] bg-[var(--dp-danger-soft)] text-[var(--dp-danger-text)]"
      : memLevel === "warning"
        ? "border-[var(--dp-warning-border)] bg-[var(--dp-warning-soft)] text-[var(--dp-warning-text)]"
        : "border-[var(--dp-border)] bg-[var(--dp-surface)] text-[var(--dp-fg-secondary)] hover:border-[var(--dp-border-strong)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)]";

  return (
    <header className="relative z-40 flex h-9 shrink-0 items-center justify-between border-b border-[var(--dp-border)] bg-[var(--dp-titlebar)] select-none">
      {/* Left Brand + Status (Draggable) */}
      <div
        data-tauri-drag-region
        onDoubleClick={handleToggleMaximize}
        className="flex h-full items-center gap-2.5 pl-3 pr-2"
      >
        <AppLogo className="pointer-events-none h-4.5 w-4.5 shrink-0" />
        <span className="pointer-events-none text-xs font-semibold tracking-tight text-[var(--dp-fg)]">
          DevPanel
        </span>
        <span
          className={`pointer-events-none inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums ${
            runningCount > 0
              ? "border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] text-[var(--dp-accent-text)]"
              : "border-[var(--dp-border)] bg-[var(--dp-surface)] text-[var(--dp-fg-muted)]"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              runningCount > 0
                ? "bg-[var(--dp-accent)]"
                : "bg-[var(--dp-fg-muted)]"
            }`}
          />
          {runningCount > 0 ? (
            <>
              <span>
                {runningCount}/{totalCount}
              </span>
              <span className="hidden sm:inline">{m.status.running}</span>
            </>
          ) : (
            <>
              <span className="hidden sm:inline">{m.status.idle}</span>
              <span>({totalCount})</span>
            </>
          )}
        </span>
      </div>

      {/* Center Flexible Drag Area */}
      <div
        data-tauri-drag-region
        onDoubleClick={handleToggleMaximize}
        className="h-full flex-1"
      />

      {/* Right Interactive Controls */}
      <div className="flex h-full items-center">
        {runningCount > 0 && (
          <button
            type="button"
            onClick={onStopAllProjects}
            aria-label={m.titleBar.stopAllAria}
            title={m.titleBar.stopAllAria}
            className={`mr-1 inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-[var(--dp-danger-border)] bg-[var(--dp-danger-soft)] px-2 text-[11px] font-medium text-[var(--dp-danger-text)] transition-colors hover:opacity-90 ${FOCUS_RING}`}
          >
            <Square className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
            <span className="hidden sm:inline">{m.common.stopAll}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleLogPanel}
          aria-pressed={logCollapsed}
          aria-label={
            logCollapsed ? m.titleBar.expandLog : m.titleBar.collapseLog
          }
          title={
            logCollapsed
              ? m.titleBar.expandLogTitle(formatShortcut("Ctrl+J", platform))
              : m.titleBar.collapseLogTitle(formatShortcut("Ctrl+J", platform))
          }
          className={`mr-1 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-colors ${
            logCollapsed
              ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
              : "border-transparent text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)]"
          } ${FOCUS_RING}`}
        >
          {logCollapsed ? (
            <PanelRightOpen className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={onToggleAlwaysOnTop}
          aria-pressed={alwaysOnTop}
          aria-label={
            alwaysOnTop
              ? m.titleBar.unpinWindowAria
              : m.titleBar.pinWindowAria
          }
          title={
            alwaysOnTop
              ? m.titleBar.unpinWindowTitle(
                  formatShortcut("Ctrl+Shift+T", platform)
                )
              : m.titleBar.pinWindowTitle(
                  formatShortcut("Ctrl+Shift+T", platform)
                )
          }
          className={`mr-1 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-colors ${
            alwaysOnTop
              ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
              : "border-transparent text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)]"
          } ${FOCUS_RING}`}
        >
          {alwaysOnTop ? (
            <Pin className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={onEnterMiniMode}
          aria-label={m.titleBar.enterMiniModeAria}
          title={m.titleBar.enterMiniModeTitle(
            formatShortcut("Ctrl+Shift+M", platform)
          )}
          className={`mr-1 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-transparent text-[var(--dp-fg-muted)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
        >
          <PictureInPicture2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onOpenMemoryMonitor}
          aria-label={m.titleBar.memoryMonitorAria}
          title={m.titleBar.memoryMonitorTitle(
            systemTitleText,
            managedTitleText,
            formatShortcut("Ctrl+M", platform)
          )}
          className={`mr-1 inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 font-mono-dev text-[11px] font-medium tabular-nums transition-colors ${memoryPillColorClass} ${FOCUS_RING}`}
        >
          <MemoryStick
            className={`h-3.5 w-3.5 ${
              memLevel === "normal" ? "text-[var(--dp-info)]" : ""
            }`}
            aria-hidden="true"
          />
          <span>
            {sysPercent !== null ? `${Math.round(sysPercent)}%` : "--"}
          </span>
          {managedRss > 0 && (
            <span className="hidden text-[10px] opacity-80 md:inline">
              · {managedTitleText}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={toggleLocale}
          aria-label={m.titleBar.switchLanguageAria}
          title={m.titleBar.switchLanguageTitle}
          className={`mr-1 inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] px-2 text-[11px] font-medium text-[var(--dp-fg-secondary)] transition-colors hover:border-[var(--dp-border-strong)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
        >
          <Languages
            className="h-3.5 w-3.5 text-[var(--dp-fg-muted)]"
            aria-hidden="true"
          />
          <span>{m.titleBar.langBadge}</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenSettings("appearance")}
          aria-label={m.titleBar.appearanceAria}
          title={m.titleBar.appearanceAria}
          className={`mr-1 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] px-2 text-[11px] font-medium text-[var(--dp-fg-secondary)] transition-colors hover:border-[var(--dp-border-strong)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
        >
          <Palette
            className="h-3.5 w-3.5 text-[var(--dp-info)]"
            aria-hidden="true"
          />
          <span className="hidden sm:inline">{themeBadgeLabel}</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenSettings("general")}
          aria-label={m.titleBar.openSettingsAria}
          title={m.titleBar.settingsTitle(formatShortcut("Ctrl+,", platform))}
          className={`mr-1.5 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--dp-fg-muted)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <div className="h-4 w-px bg-[var(--dp-border)]" aria-hidden="true" />

        {/* Window Controls */}
        <button
          type="button"
          onClick={handleMinimize}
          aria-label={m.titleBar.minimizeAria}
          title={m.titleBar.minimizeTitle}
          className={`inline-flex h-9 w-11 cursor-pointer items-center justify-center text-[var(--dp-fg-secondary)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
        >
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={handleToggleMaximize}
          aria-label={
            isMaximized ? m.titleBar.restoreAria : m.titleBar.maximizeAria
          }
          title={
            isMaximized ? m.titleBar.restoreTitle : m.titleBar.maximizeTitle
          }
          className={`inline-flex h-9 w-11 cursor-pointer items-center justify-center text-[var(--dp-fg-secondary)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
        >
          {isMaximized ? (
            <Copy className="h-3 w-3 -scale-x-100" aria-hidden="true" />
          ) : (
            <Square className="h-3 w-3" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={handleClose}
          aria-label={
            closeToTray ? m.titleBar.closeToTrayAria : m.titleBar.quitAppAria
          }
          title={
            closeToTray ? m.titleBar.closeToTrayTitle : m.titleBar.quitAppTitle
          }
          className={`inline-flex h-9 w-11 cursor-pointer items-center justify-center text-[var(--dp-fg-secondary)] transition-colors hover:bg-[#e81123] hover:text-white ${FOCUS_RING}`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
