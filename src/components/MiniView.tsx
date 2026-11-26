import { useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ExternalLink,
  Maximize2,
  MemoryStick,
  Pin,
  PinOff,
  Play,
  RotateCw,
  Square,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { useI18n } from "../i18n";
import type {
  LaunchBinding,
  MemorySnapshot,
  ProjectConfig,
  ProjectStatus,
  SessionMemoryInfo,
} from "../types/project";
import { formatBytesCompact, getMemoryLevel } from "../utils/memoryFormat";
import { buildMiniSessionItems } from "../utils/miniMode";
import { formatShortcut, type PlatformId } from "../utils/platform";
import {
  countBindingRunning,
  getBindingAggregateStatus,
} from "../utils/projectCommands";
import { AppLogo } from "./AppLogo";

interface MiniViewProps {
  projects: ProjectConfig[];
  bindings: LaunchBinding[];
  statuses: Record<string, ProjectStatus>;
  detectedUrls: Record<string, string>;
  sessionMemoryMap: Record<string, SessionMemoryInfo>;
  memorySnapshot: MemorySnapshot | null;
  runningCount: number;
  totalCount: number;
  alwaysOnTop: boolean;
  closeToTray: boolean;
  platform: PlatformId;
  onToggleAlwaysOnTop: () => void;
  onExitMini: () => void;
  onOpenSessionTerminal: (projectId: string, commandId?: string | null) => void;
  onOpenMemoryMonitor: () => void;
  onStart: (projectId: string, commandId?: string | null) => void;
  onStop: (projectId: string, commandId?: string | null) => void;
  onRestart: (projectId: string, commandId?: string | null) => void;
  onStopAllProjects: () => void;
  onStartBinding: (binding: LaunchBinding) => void;
  onStopBinding: (binding: LaunchBinding) => void;
  onOpenUrl: (url: string) => void;
}

type MiniTab = "running" | "all" | "bindings";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-bg)]";

function getSafeWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export function MiniView({
  projects,
  bindings,
  statuses,
  detectedUrls,
  sessionMemoryMap,
  memorySnapshot,
  runningCount,
  totalCount,
  alwaysOnTop,
  closeToTray,
  platform,
  onToggleAlwaysOnTop,
  onExitMini,
  onOpenSessionTerminal,
  onOpenMemoryMonitor,
  onStart,
  onStop,
  onRestart,
  onStopAllProjects,
  onStartBinding,
  onStopBinding,
  onOpenUrl,
}: MiniViewProps) {
  const { m } = useI18n();
  const [activeTab, setActiveTab] = useState<MiniTab>("running");

  const allItems = useMemo(
    () =>
      buildMiniSessionItems(projects, statuses, detectedUrls, sessionMemoryMap),
    [projects, statuses, detectedUrls, sessionMemoryMap]
  );

  const runningItems = useMemo(
    () => allItems.filter((item) => item.status !== "stopped"),
    [allItems]
  );

  const effectiveTab: MiniTab =
    activeTab === "bindings" && bindings.length === 0 ? "running" : activeTab;

  const visibleItems = effectiveTab === "running" ? runningItems : allItems;

  const sysPercent = memorySnapshot?.system.usagePercent ?? null;
  const memLevel = sysPercent !== null ? getMemoryLevel(sysPercent) : "normal";
  const managedRss = memorySnapshot?.managedTotalRssBytes ?? 0;

  const ramBadgeTone =
    memLevel === "danger"
      ? "border-[var(--dp-danger-border)] bg-[var(--dp-danger-soft)] text-[var(--dp-danger-text)]"
      : memLevel === "warning"
        ? "border-[var(--dp-warning-border)] bg-[var(--dp-warning-soft)] text-[var(--dp-warning-text)]"
        : "border-[var(--dp-border)] bg-[var(--dp-surface)] text-[var(--dp-fg-secondary)]";

  const handleClose = async () => {
    await getSafeWindow()?.close().catch(() => {});
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden border border-[var(--dp-border-strong)] bg-[var(--dp-bg)] text-[var(--dp-fg)]">
      {/* Compact Draggable TitleBar */}
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--dp-border)] bg-[var(--dp-titlebar)] px-2 select-none">
        <div
          data-tauri-drag-region
          onDoubleClick={onExitMini}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1"
        >
          <AppLogo className="pointer-events-none h-4 w-4 shrink-0" />
          <span
            className={`pointer-events-none inline-flex items-center gap-1 rounded-full border px-1.5 py-px font-mono-dev text-[10px] font-medium tabular-nums ${
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
            {runningCount}/{totalCount}
          </span>
          <span
            className={`pointer-events-none inline-flex items-center gap-1 rounded-full border px-1.5 py-px font-mono-dev text-[10px] font-medium tabular-nums ${ramBadgeTone}`}
          >
            <MemoryStick className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            {sysPercent !== null ? `${Math.round(sysPercent)}%` : "--"}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {runningCount > 0 && (
            <button
              type="button"
              onClick={onStopAllProjects}
              aria-label={m.titleBar.stopAllAria}
              title={m.titleBar.stopAllAria}
              className={`cursor-pointer rounded p-1 text-[var(--dp-danger-text)] transition-colors hover:bg-[var(--dp-danger-soft)] ${FOCUS_RING}`}
            >
              <Square className="h-3 w-3 fill-current" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            aria-pressed={alwaysOnTop}
            onClick={onToggleAlwaysOnTop}
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
            className={`cursor-pointer rounded p-1 transition-colors ${
              alwaysOnTop
                ? "bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                : "text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)]"
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
            onClick={onExitMini}
            aria-label={m.miniMode.exitMiniAria}
            title={m.miniMode.exitMiniTitle(
              formatShortcut("Ctrl+Shift+M", platform)
            )}
            className={`cursor-pointer rounded p-1 text-[var(--dp-fg-secondary)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
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
            className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] transition-colors hover:bg-[#e81123] hover:text-white ${FOCUS_RING}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Compact Filter Tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--dp-border-subtle)] bg-[var(--dp-sidebar)] px-2 py-1 select-none">
        <button
          type="button"
          aria-pressed={effectiveTab === "running"}
          onClick={() => setActiveTab("running")}
          className={`flex-1 cursor-pointer rounded px-2 py-1 text-[11px] font-medium tabular-nums transition-colors ${
            effectiveTab === "running"
              ? "bg-[var(--dp-surface)] text-[var(--dp-accent-text)]"
              : "text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
          } ${FOCUS_RING}`}
        >
          {m.miniMode.tabRunning(runningItems.length)}
        </button>
        <button
          type="button"
          aria-pressed={effectiveTab === "all"}
          onClick={() => setActiveTab("all")}
          className={`flex-1 cursor-pointer rounded px-2 py-1 text-[11px] font-medium tabular-nums transition-colors ${
            effectiveTab === "all"
              ? "bg-[var(--dp-surface)] text-[var(--dp-fg)]"
              : "text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
          } ${FOCUS_RING}`}
        >
          {m.miniMode.tabAll(allItems.length)}
        </button>
        {bindings.length > 0 && (
          <button
            type="button"
            aria-pressed={effectiveTab === "bindings"}
            onClick={() => setActiveTab("bindings")}
            className={`flex-1 cursor-pointer rounded px-2 py-1 text-[11px] font-medium tabular-nums transition-colors ${
              effectiveTab === "bindings"
                ? "bg-[var(--dp-surface)] text-[var(--dp-info-text)]"
                : "text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
            } ${FOCUS_RING}`}
          >
            {m.miniMode.tabBindings(bindings.length)}
          </button>
        )}
      </div>

      {/* Scrollable High-Density List */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-1.5">
        {effectiveTab === "bindings" ? (
          bindings.map((binding) => {
            const runningInBinding = countBindingRunning(
              binding,
              projects,
              statuses
            );
            const aggStatus = getBindingAggregateStatus(
              binding,
              projects,
              statuses
            );
            return (
              <div
                key={binding.id}
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--dp-border-subtle)] bg-[var(--dp-sidebar)] px-2.5 py-1.5 hover:border-[var(--dp-border)]"
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <Zap
                    className={`h-3 w-3 shrink-0 ${
                      aggStatus === "running"
                        ? "text-[var(--dp-accent)]"
                        : "text-[var(--dp-fg-muted)]"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs font-medium text-[var(--dp-fg)]">
                    {binding.name}
                  </span>
                  <span className="shrink-0 font-mono-dev text-[10px] tabular-nums text-[var(--dp-fg-muted)]">
                    {runningInBinding}/{binding.targets.length}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  {aggStatus === "stopped" ? (
                    <button
                      type="button"
                      onClick={() => onStartBinding(binding)}
                      aria-label={m.sidebar.startBindingAria(binding.name)}
                      title={m.sidebar.startBindingTitle}
                      className={`cursor-pointer rounded p-1 text-[var(--dp-accent-text)] hover:bg-[var(--dp-accent-soft)] ${FOCUS_RING}`}
                    >
                      <Play
                        className="h-3 w-3 fill-current"
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onStopBinding(binding)}
                      aria-label={m.sidebar.stopBindingAria(binding.name)}
                      title={m.sidebar.stopBindingTitle}
                      className={`cursor-pointer rounded p-1 text-[var(--dp-danger-text)] hover:bg-[var(--dp-danger-soft)] ${FOCUS_RING}`}
                    >
                      <Square
                        className="h-3 w-3 fill-current"
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : visibleItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-3 py-6 text-center">
            <div className="text-xs font-medium text-[var(--dp-fg-secondary)]">
              {effectiveTab === "running"
                ? m.miniMode.emptyRunningTitle
                : m.miniMode.emptyAllTitle}
            </div>
            {effectiveTab === "running" && allItems.length > 0 && (
              <p className="mt-1 text-[11px] text-[var(--dp-fg-muted)]">
                {m.miniMode.emptyRunningHint}
              </p>
            )}
          </div>
        ) : (
          visibleItems.map((item) => {
            const isRunning = item.status === "running";
            const isTransitioning =
              item.status === "starting" || item.status === "stopping";

            return (
              <div
                key={item.sessionKey}
                onDoubleClick={() =>
                  onOpenSessionTerminal(item.projectId, item.commandId)
                }
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--dp-border-subtle)] bg-[var(--dp-sidebar)] px-2.5 py-1.5 transition-colors hover:border-[var(--dp-border)] hover:bg-[var(--dp-surface)]/70"
              >
                <button
                  type="button"
                  onClick={() =>
                    onOpenSessionTerminal(item.projectId, item.commandId)
                  }
                  title={m.miniMode.openTerminalTitle}
                  className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded text-left ${FOCUS_RING}`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isRunning
                        ? "bg-[var(--dp-accent)]"
                        : isTransitioning
                          ? "bg-[var(--dp-warning)] motion-safe:animate-pulse"
                          : "bg-[var(--dp-fg-muted)]"
                    }`}
                  />
                  <span className="truncate text-xs font-medium text-[var(--dp-fg)]">
                    {item.title}
                  </span>
                  {item.subtitle && (
                    <span className="shrink-0 truncate rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-1 py-px text-[10px] text-[var(--dp-fg-muted)]">
                      {item.subtitle}
                    </span>
                  )}
                </button>

                <div className="flex shrink-0 items-center gap-1 select-none">
                  {item.status !== "stopped" && item.rssBytes > 0 && (
                    <span className="font-mono-dev text-[10px] tabular-nums text-[var(--dp-fg-muted)]">
                      {formatBytesCompact(item.rssBytes)}
                    </span>
                  )}

                  {item.status === "stopped" ? (
                    <button
                      type="button"
                      onClick={() => onStart(item.projectId, item.commandId)}
                      aria-label={m.sidebar.startItemAria(
                        item.subtitle
                          ? `${item.title} ${item.subtitle}`
                          : item.title
                      )}
                      title={m.common.start}
                      className={`cursor-pointer rounded p-1 text-[var(--dp-accent-text)] hover:bg-[var(--dp-accent-soft)] ${FOCUS_RING}`}
                    >
                      <Play
                        className="h-3 w-3 fill-current"
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={item.status === "stopping"}
                        onClick={() => onStop(item.projectId, item.commandId)}
                        aria-label={m.sidebar.stopItemAria(
                          item.subtitle
                            ? `${item.title} ${item.subtitle}`
                            : item.title
                        )}
                        title={m.common.stop}
                        className={`cursor-pointer rounded p-1 text-[var(--dp-danger-text)] hover:bg-[var(--dp-danger-soft)] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                      >
                        <Square
                          className="h-3 w-3 fill-current"
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        type="button"
                        disabled={isTransitioning}
                        onClick={() =>
                          onRestart(item.projectId, item.commandId)
                        }
                        aria-label={m.sidebar.restartItemAria(
                          item.subtitle
                            ? `${item.title} ${item.subtitle}`
                            : item.title
                        )}
                        title={m.common.restart}
                        className={`cursor-pointer rounded p-1 text-[var(--dp-warning-text)] hover:bg-[var(--dp-warning-soft)] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                      >
                        <RotateCw
                          className={`h-3 w-3 ${
                            isTransitioning ? "motion-safe:animate-spin" : ""
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    </>
                  )}

                  {item.url && (
                    <button
                      type="button"
                      onClick={() => item.url && onOpenUrl(item.url)}
                      aria-label={m.sidebar.openBrowserAria(item.title)}
                      title={m.sidebar.openBrowserTitle(item.url)}
                      className={`cursor-pointer rounded p-1 text-[var(--dp-info-text)] hover:bg-[var(--dp-info-soft)] ${FOCUS_RING}`}
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      onOpenSessionTerminal(item.projectId, item.commandId)
                    }
                    aria-label={m.miniMode.openTerminalAria(
                      item.subtitle
                        ? `${item.title} ${item.subtitle}`
                        : item.title
                    )}
                    title={m.miniMode.openTerminalTitle}
                    className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                  >
                    <Terminal className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Memory Summary Footer */}
      <button
        type="button"
        onClick={onOpenMemoryMonitor}
        title={m.miniMode.openMemoryMonitorTitle}
        className={`flex h-6 w-full shrink-0 cursor-pointer items-center justify-between border-t border-[var(--dp-border)] bg-[var(--dp-titlebar)] px-2.5 font-mono-dev text-[10px] tabular-nums text-[var(--dp-fg-secondary)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] select-none ${FOCUS_RING}`}
      >
        <span>{m.miniMode.footerManaged(formatBytesCompact(managedRss))}</span>
        <span>
          {m.miniMode.footerSystem(
            sysPercent !== null ? `${sysPercent.toFixed(1)}%` : "--"
          )}
        </span>
      </button>
    </div>
  );
}
