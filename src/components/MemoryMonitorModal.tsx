import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Cpu,
  Layers,
  MemoryStick,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Search,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type { MemoryRefreshInterval } from "../hooks/useMemoryMonitor";
import { useI18n } from "../i18n";
import type {
  MemoryHistoryPoint,
  MemorySnapshot,
  ProcessMemoryEntry,
  ProjectConfig,
  SessionMemoryInfo,
} from "../types/project";
import {
  computeHistoryStats,
  formatBytes,
  getMemoryLevel,
} from "../utils/memoryFormat";

export type MemoryMonitorTab = "managed" | "processes";

interface MemoryMonitorModalProps {
  isOpen: boolean;
  activeTab: MemoryMonitorTab;
  onTabChange: (tab: MemoryMonitorTab) => void;
  onClose: () => void;
  snapshot: MemorySnapshot | null;
  history: MemoryHistoryPoint[];
  projects: ProjectConfig[];
  paused: boolean;
  onTogglePaused: () => void;
  intervalMs: MemoryRefreshInterval;
  onChangeInterval: (ms: MemoryRefreshInterval) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onClearHistory: () => void;
  onSelectSession: (projectId: string, commandId?: string | null) => void;
  onRestartSession: (projectId: string, commandId?: string | null) => void;
  onStopSession: (projectId: string, commandId?: string | null) => void;
}

type ManagedSortKey = "service" | "procs" | "rss" | "private" | "share";
type ProcessSortKey = "pid" | "name" | "rss" | "private" | "share";
type SortDirection = "ascending" | "descending";
type TrendMode = "system" | "managed";

interface ResolvedSessionMeta {
  projectId: string;
  commandId: string | null;
  label: string;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-modal)]";

const COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function resolveSessionMeta(
  sessionKey: string,
  projects: ProjectConfig[]
): ResolvedSessionMeta {
  const sep = sessionKey.indexOf("::");
  if (sep > 0) {
    const projectId = sessionKey.slice(0, sep);
    const commandId = sessionKey.slice(sep + 2);
    const project = projects.find((p) => p.id === projectId);
    const cmd = project?.commands?.find((c) => c.id === commandId);
    const label =
      project && cmd
        ? `${project.name} · ${cmd.name}`
        : project
          ? `${project.name} · ${commandId}`
          : sessionKey;
    return { projectId, commandId, label };
  }
  const project = projects.find((p) => p.id === sessionKey);
  return {
    projectId: sessionKey,
    commandId: null,
    label: project?.name ?? sessionKey,
  };
}

function levelColorClass(level: "normal" | "warning" | "danger"): string {
  if (level === "danger") return "text-[var(--dp-danger-text)]";
  if (level === "warning") return "text-[var(--dp-warning-text)]";
  return "text-[var(--dp-accent-text)]";
}

function levelBarClass(level: "normal" | "warning" | "danger"): string {
  if (level === "danger") return "bg-[var(--dp-danger)]";
  if (level === "warning") return "bg-[var(--dp-warning)]";
  return "bg-[var(--dp-accent)]";
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return (
      <ArrowUpDown
        className="h-3 w-3 shrink-0 opacity-45"
        aria-hidden="true"
      />
    );
  }
  return direction === "ascending" ? (
    <ArrowUp
      className="h-3 w-3 shrink-0 text-[var(--dp-info)]"
      aria-hidden="true"
    />
  ) : (
    <ArrowDown
      className="h-3 w-3 shrink-0 text-[var(--dp-info)]"
      aria-hidden="true"
    />
  );
}

export function MemoryMonitorModal({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  snapshot,
  history,
  projects,
  paused,
  onTogglePaused,
  intervalMs,
  onChangeInterval,
  loading,
  error,
  onRefresh,
  onClearHistory,
  onSelectSession,
  onRestartSession,
  onStopSession,
}: MemoryMonitorModalProps) {
  const { m } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const managedCaptionId = useId();
  const processesCaptionId = useId();
  const sparkGradientId = useId();
  const tabManagedId = useId();
  const tabProcessesId = useId();
  const panelManagedId = useId();
  const panelProcessesId = useId();
  const managedTabRef = useRef<HTMLButtonElement | null>(null);
  const processesTabRef = useRef<HTMLButtonElement | null>(null);

  const [trendMode, setTrendMode] = useState<TrendMode>("system");
  const [expandedSessions, setExpandedSessions] = useState<
    Record<string, boolean>
  >({});
  const [processFilter, setProcessFilter] = useState("");
  const [managedSort, setManagedSort] = useState<{
    key: ManagedSortKey;
    dir: SortDirection;
  }>({ key: "rss", dir: "descending" });
  const [processSort, setProcessSort] = useState<{
    key: ProcessSortKey;
    dir: SortDirection;
  }>({ key: "rss", dir: "descending" });
  const [sortAnnouncement, setSortAnnouncement] = useState("");

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

    const outside = (e: PointerEvent) => {
      const rect = dialog.getBoundingClientRect();
      return (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      );
    };

    let pressedOutside = false;
    const handlePointerDown = (e: PointerEvent) => {
      pressedOutside = outside(e);
    };
    const handlePointerUp = (e: PointerEvent) => {
      if (pressedOutside && outside(e)) {
        dialog.close();
      }
      pressedOutside = false;
    };

    dialog.addEventListener("pointerdown", handlePointerDown);
    dialog.addEventListener("pointerup", handlePointerUp);
    return () => {
      dialog.removeEventListener("pointerdown", handlePointerDown);
      dialog.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setSortAnnouncement("");
    }
  }, [isOpen]);

  const systemTotal = snapshot?.system.totalBytes ?? 0;
  const systemUsed = snapshot?.system.usedBytes ?? 0;
  const systemAvail = snapshot?.system.availableBytes ?? 0;
  const systemPercent = snapshot?.system.usagePercent ?? 0;
  const systemLevel = getMemoryLevel(systemPercent);
  const swapTotal = snapshot?.system.swapTotalBytes ?? 0;
  const swapUsed = snapshot?.system.swapUsedBytes ?? 0;

  const managedTotalRss = snapshot?.managedTotalRssBytes ?? 0;
  const managedTotalPrivate = snapshot?.managedTotalPrivateBytes ?? 0;
  const managedProcessCount = snapshot?.managedProcessCount ?? 0;
  const managedSharePct =
    systemTotal > 0 ? (managedTotalRss / systemTotal) * 100 : 0;

  const appRss = snapshot?.appRssBytes ?? 0;
  const appProcessCount = snapshot?.appProcessCount ?? 0;

  const historyStats = useMemo(() => computeHistoryStats(history), [history]);

  const sessionMetaMap = useMemo(() => {
    const map: Record<string, ResolvedSessionMeta> = {};
    for (const s of snapshot?.sessions ?? []) {
      map[s.sessionKey] = resolveSessionMeta(s.sessionKey, projects);
    }
    return map;
  }, [snapshot?.sessions, projects]);

  const sortedSessions = useMemo(() => {
    const items: Array<{
      session: SessionMemoryInfo;
      meta: ResolvedSessionMeta;
      share: number;
    }> = (snapshot?.sessions ?? []).map((session) => ({
      session,
      meta:
        sessionMetaMap[session.sessionKey] ??
        resolveSessionMeta(session.sessionKey, projects),
      share: systemTotal > 0 ? (session.rssBytes / systemTotal) * 100 : 0,
    }));

    const factor = managedSort.dir === "ascending" ? 1 : -1;
    items.sort((a, b) => {
      switch (managedSort.key) {
        case "service":
          return factor * COLLATOR.compare(a.meta.label, b.meta.label);
        case "procs":
          return factor * (a.session.processCount - b.session.processCount);
        case "private":
          return factor * (a.session.privateBytes - b.session.privateBytes);
        case "share":
          return factor * (a.share - b.share);
        case "rss":
        default:
          return factor * (a.session.rssBytes - b.session.rssBytes);
      }
    });
    return items;
  }, [snapshot?.sessions, sessionMetaMap, projects, systemTotal, managedSort]);

  const sortedProcesses = useMemo(() => {
    const query = processFilter.trim().toLowerCase();
    const rawList: ProcessMemoryEntry[] = snapshot?.topProcesses ?? [];
    const filtered = query
      ? rawList.filter(
          (proc) =>
            proc.name.toLowerCase().includes(query) ||
            String(proc.pid).includes(query)
        )
      : rawList;

    const items = filtered.map((proc) => ({
      proc,
      share: systemTotal > 0 ? (proc.rssBytes / systemTotal) * 100 : 0,
    }));

    const factor = processSort.dir === "ascending" ? 1 : -1;
    items.sort((a, b) => {
      switch (processSort.key) {
        case "pid":
          return factor * (a.proc.pid - b.proc.pid);
        case "name":
          return factor * COLLATOR.compare(a.proc.name, b.proc.name);
        case "private":
          return factor * (a.proc.privateBytes - b.proc.privateBytes);
        case "share":
          return factor * (a.share - b.share);
        case "rss":
        default:
          return factor * (a.proc.rssBytes - b.proc.rssBytes);
      }
    });
    return items;
  }, [snapshot?.topProcesses, processFilter, systemTotal, processSort]);

  const handleSortManaged = (key: ManagedSortKey, label: string) => {
    const nextDir: SortDirection =
      managedSort.key === key && managedSort.dir === "descending"
        ? "ascending"
        : managedSort.key === key
          ? "descending"
          : key === "service"
            ? "ascending"
            : "descending";
    setManagedSort({ key, dir: nextDir });
    setSortAnnouncement(
      m.memoryMonitor.sortAnnouncement(label, nextDir, sortedSessions.length)
    );
  };

  const handleSortProcesses = (key: ProcessSortKey, label: string) => {
    const nextDir: SortDirection =
      processSort.key === key && processSort.dir === "descending"
        ? "ascending"
        : processSort.key === key
          ? "descending"
          : key === "name" || key === "pid"
            ? "ascending"
            : "descending";
    setProcessSort({ key, dir: nextDir });
    setSortAnnouncement(
      m.memoryMonitor.sortAnnouncement(label, nextDir, sortedProcesses.length)
    );
  };

  const toggleExpandSession = (sessionKey: string) => {
    setExpandedSessions((prev) => ({
      ...prev,
      [sessionKey]: !prev[sessionKey],
    }));
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next: MemoryMonitorTab =
        activeTab === "managed" ? "processes" : "managed";
      onTabChange(next);
      if (next === "managed") {
        managedTabRef.current?.focus();
      } else {
        processesTabRef.current?.focus();
      }
    }
  };

  // Sparkline geometry
  const sparkData = useMemo(() => {
    const width = 560;
    const height = 84;
    const padY = 8;
    const innerH = height - padY * 2;
    const values = history.map((pt) =>
      trendMode === "system" ? pt.systemPercent : pt.managedRssBytes
    );
    const maxVal =
      trendMode === "system"
        ? 100
        : Math.max(64 * 1024 * 1024, ...values, 1) * 1.15;

    if (values.length < 2) {
      return { width, height, linePath: "", areaPath: "", maxVal };
    }

    const stepX = width / (values.length - 1);
    const coords = values.map((val, idx) => {
      const clamped = Math.max(0, Math.min(maxVal, val));
      const x = Number((idx * stepX).toFixed(2));
      const y = Number(
        (padY + innerH - (clamped / maxVal) * innerH).toFixed(2)
      );
      return { x, y };
    });

    const linePath = coords
      .map((pt, idx) => `${idx === 0 ? "M" : "L"}${pt.x},${pt.y}`)
      .join(" ");
    const last = coords[coords.length - 1];
    const areaPath = `${linePath} L${last.x},${height} L0,${height} Z`;

    return { width, height, linePath, areaPath, maxVal };
  }, [history, trendMode]);

  const latestTrendDisplay =
    trendMode === "system"
      ? `${historyStats.systemCurrent.toFixed(1)}%`
      : formatBytes(historyStats.managedCurrent);

  const managedCount = snapshot?.sessions.length ?? 0;
  const topCount = snapshot?.topProcesses.length ?? 0;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      {...({ closedby: "any" } as Record<string, string>)}
      style={{ boxShadow: "var(--dp-shadow)" }}
      className="devpanel-dialog m-auto max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-3xl overflow-hidden rounded-xl border border-[var(--dp-border)] bg-[var(--dp-modal)] p-0 text-[var(--dp-fg)]"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--dp-border)] px-5 py-3 select-none">
        <div className="flex items-center gap-2.5">
          <MemoryStick
            className="h-4 w-4 text-[var(--dp-info)]"
            aria-hidden="true"
          />
          <h1
            id={titleId}
            className="text-sm font-semibold text-[var(--dp-fg)]"
          >
            {m.memoryMonitor.title}
          </h1>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
              paused
                ? "border-[var(--dp-warning-border)] bg-[var(--dp-warning-soft)] text-[var(--dp-warning-text)]"
                : "border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] text-[var(--dp-accent-text)]"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                paused
                  ? "bg-[var(--dp-warning)]"
                  : "bg-[var(--dp-accent)] motion-safe:animate-pulse"
              }`}
            />
            {paused ? m.memoryMonitor.pausedBadge : m.memoryMonitor.liveBadge}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div
            role="group"
            aria-label={m.memoryMonitor.intervalAria}
            className="inline-flex rounded-md border border-[var(--dp-border)] bg-[var(--dp-bg)] p-0.5"
          >
            {([1000, 2000, 5000] as MemoryRefreshInterval[]).map((ms) => (
              <button
                key={ms}
                type="button"
                aria-pressed={intervalMs === ms}
                onClick={() => onChangeInterval(ms)}
                className={`cursor-pointer rounded px-1.5 py-0.5 font-mono-dev text-[10px] font-medium transition-colors ${
                  intervalMs === ms
                    ? "bg-[var(--dp-surface)] text-[var(--dp-info-text)]"
                    : "text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
                } ${FOCUS_RING}`}
              >
                {m.memoryMonitor.intervalOption(ms / 1000)}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onTogglePaused}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] px-2 py-1 text-[11px] font-medium text-[var(--dp-fg-secondary)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
          >
            {paused ? (
              <Play className="h-3 w-3 fill-current" aria-hidden="true" />
            ) : (
              <Pause className="h-3 w-3" aria-hidden="true" />
            )}
            <span>
              {paused ? m.memoryMonitor.resumeBtn : m.memoryMonitor.pauseBtn}
            </span>
          </button>

          <button
            type="button"
            onClick={onRefresh}
            aria-label={m.memoryMonitor.refreshBtn}
            title={m.memoryMonitor.refreshBtn}
            className={`cursor-pointer rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] p-1.5 text-[var(--dp-fg-secondary)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "motion-safe:animate-spin" : ""}`}
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label={m.common.closeDialog}
            className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="max-h-[calc(100vh-7rem)] space-y-4 overflow-y-auto px-5 py-4">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-[var(--dp-danger-border)] bg-[var(--dp-danger-soft)] px-3 py-2 text-xs text-[var(--dp-danger-text)]"
          >
            {m.memoryMonitor.errorBanner(error)}
          </div>
        )}

        {!snapshot && loading ? (
          <div className="rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] px-4 py-8 text-center text-xs text-[var(--dp-fg-muted)]">
            {m.memoryMonitor.loading}
          </div>
        ) : (
          <>
            {/* Overview Summary Cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* System RAM Card */}
              <div className="rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                <div className="flex items-center justify-between text-[11px] text-[var(--dp-fg-muted)]">
                  <span className="inline-flex items-center gap-1.5 font-medium text-[var(--dp-fg-secondary)]">
                    <Cpu
                      className="h-3.5 w-3.5 text-[var(--dp-info)]"
                      aria-hidden="true"
                    />
                    {m.memoryMonitor.cardSystemTitle}
                  </span>
                  <span
                    className={`font-mono-dev text-xs font-semibold tabular-nums ${levelColorClass(systemLevel)}`}
                  >
                    {systemPercent.toFixed(1)}%
                  </span>
                </div>

                <div className="mt-2 font-mono-dev text-sm font-semibold tabular-nums text-[var(--dp-fg)]">
                  {m.memoryMonitor.cardSystemUsedTotal(
                    formatBytes(systemUsed),
                    formatBytes(systemTotal)
                  )}
                </div>

                <div
                  aria-hidden="true"
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--dp-bg)]"
                >
                  <div
                    style={{
                      width: `${Math.max(0, Math.min(100, systemPercent))}%`,
                    }}
                    className={`h-full rounded-full transition-[width] duration-300 ${levelBarClass(systemLevel)}`}
                  />
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[10px] text-[var(--dp-fg-muted)] tabular-nums">
                  <span>
                    {m.memoryMonitor.cardSystemAvailable(
                      formatBytes(systemAvail)
                    )}
                  </span>
                  {swapTotal > 0 && (
                    <span>
                      {m.memoryMonitor.cardSystemSwap(
                        formatBytes(swapUsed),
                        formatBytes(swapTotal)
                      )}
                    </span>
                  )}
                </div>
              </div>

              {/* Managed Services Card */}
              <div className="rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                <div className="flex items-center justify-between text-[11px] text-[var(--dp-fg-muted)]">
                  <span className="inline-flex items-center gap-1.5 font-medium text-[var(--dp-fg-secondary)]">
                    <Layers
                      className="h-3.5 w-3.5 text-[var(--dp-accent)]"
                      aria-hidden="true"
                    />
                    {m.memoryMonitor.cardManagedTitle}
                  </span>
                  <span className="font-mono-dev text-[10px] font-medium tabular-nums text-[var(--dp-fg-secondary)]">
                    {m.memoryMonitor.cardManagedShare(
                      managedSharePct.toFixed(1)
                    )}
                  </span>
                </div>

                <div className="mt-2 font-mono-dev text-sm font-semibold tabular-nums text-[var(--dp-fg)]">
                  {formatBytes(managedTotalRss)}
                </div>

                <div className="mt-2 text-[11px] text-[var(--dp-fg-secondary)] tabular-nums">
                  {m.memoryMonitor.cardManagedSubtitle(
                    managedCount,
                    managedProcessCount
                  )}
                </div>

                <div className="mt-1 text-[10px] text-[var(--dp-fg-muted)] tabular-nums">
                  {m.memoryMonitor.cardManagedPrivate(
                    formatBytes(managedTotalPrivate)
                  )}
                </div>
              </div>

              {/* DevPanel Self Card */}
              <div className="rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
                <div className="flex items-center justify-between text-[11px] text-[var(--dp-fg-muted)]">
                  <span className="inline-flex items-center gap-1.5 font-medium text-[var(--dp-fg-secondary)]">
                    <Activity
                      className="h-3.5 w-3.5 text-[var(--dp-info)]"
                      aria-hidden="true"
                    />
                    {m.memoryMonitor.cardAppTitle}
                  </span>
                  <span className="font-mono-dev text-[10px] tabular-nums text-[var(--dp-fg-muted)]">
                    {systemTotal > 0
                      ? `${((appRss / systemTotal) * 100).toFixed(1)}%`
                      : "0.0%"}
                  </span>
                </div>

                <div className="mt-2 font-mono-dev text-sm font-semibold tabular-nums text-[var(--dp-fg)]">
                  {formatBytes(appRss)}
                </div>

                <div className="mt-2 text-[11px] text-[var(--dp-fg-secondary)] tabular-nums">
                  {m.memoryMonitor.cardAppProcs(appProcessCount)}
                </div>

                <div className="mt-1 text-[10px] text-[var(--dp-fg-muted)] tabular-nums">
                  {m.memoryMonitor.cardAppPeak(
                    formatBytes(historyStats.managedPeak)
                  )}
                </div>
              </div>
            </div>

            {/* Live Trend Sparkline Card */}
            <div className="rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--dp-fg)]">
                    {m.memoryMonitor.trendTitle}
                  </span>
                  <div className="inline-flex rounded-md border border-[var(--dp-border)] bg-[var(--dp-bg)] p-0.5 select-none">
                    <button
                      type="button"
                      aria-pressed={trendMode === "system"}
                      onClick={() => setTrendMode("system")}
                      className={`cursor-pointer rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                        trendMode === "system"
                          ? "bg-[var(--dp-surface)] text-[var(--dp-info-text)]"
                          : "text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
                      } ${FOCUS_RING}`}
                    >
                      {m.memoryMonitor.trendModeSystem}
                    </button>
                    <button
                      type="button"
                      aria-pressed={trendMode === "managed"}
                      onClick={() => setTrendMode("managed")}
                      className={`cursor-pointer rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                        trendMode === "managed"
                          ? "bg-[var(--dp-surface)] text-[var(--dp-accent-text)]"
                          : "text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
                      } ${FOCUS_RING}`}
                    >
                      {m.memoryMonitor.trendModeManaged}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 font-mono-dev text-[10px] tabular-nums text-[var(--dp-fg-secondary)]">
                  <span>
                    {m.memoryMonitor.trendCurrent}:{" "}
                    <strong className="text-[var(--dp-fg)]">
                      {latestTrendDisplay}
                    </strong>
                  </span>
                  <span>
                    {m.memoryMonitor.trendPeak}:{" "}
                    <strong className="text-[var(--dp-fg)]">
                      {trendMode === "system"
                        ? `${historyStats.systemPeak.toFixed(1)}%`
                        : formatBytes(historyStats.managedPeak)}
                    </strong>
                  </span>
                  <span>
                    {m.memoryMonitor.trendAvg}:{" "}
                    <strong className="text-[var(--dp-fg)]">
                      {trendMode === "system"
                        ? `${historyStats.systemAvg.toFixed(1)}%`
                        : formatBytes(historyStats.managedAvg)}
                    </strong>
                  </span>
                  <button
                    type="button"
                    disabled={history.length === 0}
                    onClick={onClearHistory}
                    className={`inline-flex cursor-pointer items-center gap-1 rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-1.5 py-0.5 text-[10px] text-[var(--dp-fg-muted)] transition-colors hover:text-[var(--dp-fg)] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                  >
                    <Trash2 className="h-2.5 w-2.5" aria-hidden="true" />
                    {m.memoryMonitor.clearHistoryBtn}
                  </button>
                </div>
              </div>

              <div className="mt-2.5 rounded-lg border border-[var(--dp-border-subtle)] bg-[var(--dp-bg)]/80 px-2.5 py-2">
                {history.length < 2 ? (
                  <div className="flex h-[84px] items-center justify-center text-[11px] text-[var(--dp-fg-muted)]">
                    {m.memoryMonitor.trendWaiting}
                  </div>
                ) : (
                  <svg
                    viewBox={`0 0 ${sparkData.width} ${sparkData.height}`}
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={m.memoryMonitor.trendSvgAria(
                      trendMode === "system"
                        ? m.memoryMonitor.trendModeSystem
                        : m.memoryMonitor.trendModeManaged,
                      latestTrendDisplay
                    )}
                    className="h-[84px] w-full overflow-visible"
                  >
                    <defs>
                      <linearGradient
                        id={sparkGradientId}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={
                            trendMode === "system"
                              ? "var(--dp-info)"
                              : "var(--dp-accent)"
                          }
                          stopOpacity="0.32"
                        />
                        <stop
                          offset="100%"
                          stopColor={
                            trendMode === "system"
                              ? "var(--dp-info)"
                              : "var(--dp-accent)"
                          }
                          stopOpacity="0.02"
                        />
                      </linearGradient>
                    </defs>
                    <line
                      x1="0"
                      y1={sparkData.height * 0.5}
                      x2={sparkData.width}
                      y2={sparkData.height * 0.5}
                      stroke="var(--dp-border-subtle)"
                      strokeDasharray="4 4"
                      strokeWidth="1"
                    />
                    <path
                      d={sparkData.areaPath}
                      fill={`url(#${sparkGradientId})`}
                    />
                    <path
                      d={sparkData.linePath}
                      fill="none"
                      stroke={
                        trendMode === "system"
                          ? "var(--dp-info)"
                          : "var(--dp-accent)"
                      }
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
                <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--dp-fg-muted)] tabular-nums">
                  <span>{m.memoryMonitor.trendSamples(history.length)}</span>
                  <span>
                    {trendMode === "system"
                      ? "0% – 100%"
                      : `0 – ${formatBytes(sparkData.maxVal)}`}
                  </span>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div>
              <div
                role="tablist"
                aria-label={m.memoryMonitor.tablistAria}
                className="dp-tablist border-b border-[var(--dp-border)]"
              >
                <button
                  ref={managedTabRef}
                  id={tabManagedId}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "managed"}
                  aria-controls={panelManagedId}
                  tabIndex={activeTab === "managed" ? 0 : -1}
                  onClick={() => onTabChange("managed")}
                  onKeyDown={handleTabKeyDown}
                  className={`dp-tab cursor-pointer px-3 py-2 text-xs font-medium transition-colors ${
                    activeTab === "managed"
                      ? "text-[var(--dp-info-text)]"
                      : "text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
                  } ${FOCUS_RING}`}
                >
                  {m.memoryMonitor.tabManaged(managedCount)}
                </button>
                <button
                  ref={processesTabRef}
                  id={tabProcessesId}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "processes"}
                  aria-controls={panelProcessesId}
                  tabIndex={activeTab === "processes" ? 0 : -1}
                  onClick={() => onTabChange("processes")}
                  onKeyDown={handleTabKeyDown}
                  className={`dp-tab cursor-pointer px-3 py-2 text-xs font-medium transition-colors ${
                    activeTab === "processes"
                      ? "text-[var(--dp-info-text)]"
                      : "text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
                  } ${FOCUS_RING}`}
                >
                  {m.memoryMonitor.tabProcesses(topCount)}
                </button>
              </div>

              {/* Accessible Live Sort Status */}
              <div role="status" className="sr-only">
                {sortAnnouncement}
              </div>

              {/* Managed Services Panel */}
              {activeTab === "managed" && (
                <div
                  id={panelManagedId}
                  role="tabpanel"
                  aria-labelledby={tabManagedId}
                  className="pt-3"
                >
                  {sortedSessions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--dp-border)] bg-[var(--dp-surface)]/50 px-4 py-8 text-center">
                      <div className="text-xs font-medium text-[var(--dp-fg-secondary)]">
                        {m.memoryMonitor.noManagedTitle}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--dp-fg-muted)]">
                        {m.memoryMonitor.noManagedDesc}
                      </p>
                    </div>
                  ) : (
                    <div
                      role="region"
                      aria-labelledby={managedCaptionId}
                      tabIndex={0}
                      className={`overflow-x-auto rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] ${FOCUS_RING}`}
                    >
                      <table className="w-full min-w-[580px] border-collapse text-left text-xs">
                        <caption id={managedCaptionId} className="sr-only">
                          {m.memoryMonitor.tableCaptionManaged}
                        </caption>
                        <thead className="border-b border-[var(--dp-border)] bg-[var(--dp-bg)]/60 text-[11px] font-medium text-[var(--dp-fg-muted)]">
                          <tr>
                            <th
                              scope="col"
                              aria-sort={
                                managedSort.key === "service"
                                  ? managedSort.dir
                                  : undefined
                              }
                              className="p-0"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleSortManaged(
                                    "service",
                                    m.memoryMonitor.colService
                                  )
                                }
                                className={`flex min-h-7 w-full cursor-pointer items-center gap-1 px-3 py-1.5 text-left font-medium hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                              >
                                <span>{m.memoryMonitor.colService}</span>
                                <SortIcon
                                  active={managedSort.key === "service"}
                                  direction={managedSort.dir}
                                />
                              </button>
                            </th>
                            <th
                              scope="col"
                              aria-sort={
                                managedSort.key === "procs"
                                  ? managedSort.dir
                                  : undefined
                              }
                              className="p-0 text-right"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleSortManaged(
                                    "procs",
                                    m.memoryMonitor.colProcs
                                  )
                                }
                                className={`flex min-h-7 w-full cursor-pointer items-center justify-end gap-1 px-2.5 py-1.5 font-medium hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                              >
                                <span>{m.memoryMonitor.colProcs}</span>
                                <SortIcon
                                  active={managedSort.key === "procs"}
                                  direction={managedSort.dir}
                                />
                              </button>
                            </th>
                            <th
                              scope="col"
                              aria-sort={
                                managedSort.key === "rss"
                                  ? managedSort.dir
                                  : undefined
                              }
                              className="p-0 text-right"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleSortManaged(
                                    "rss",
                                    m.memoryMonitor.colRss
                                  )
                                }
                                className={`flex min-h-7 w-full cursor-pointer items-center justify-end gap-1 px-2.5 py-1.5 font-medium hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                              >
                                <span>{m.memoryMonitor.colRss}</span>
                                <SortIcon
                                  active={managedSort.key === "rss"}
                                  direction={managedSort.dir}
                                />
                              </button>
                            </th>
                            <th
                              scope="col"
                              aria-sort={
                                managedSort.key === "private"
                                  ? managedSort.dir
                                  : undefined
                              }
                              className="p-0 text-right"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleSortManaged(
                                    "private",
                                    m.memoryMonitor.colPrivate
                                  )
                                }
                                className={`flex min-h-7 w-full cursor-pointer items-center justify-end gap-1 px-2.5 py-1.5 font-medium hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                              >
                                <span>{m.memoryMonitor.colPrivate}</span>
                                <SortIcon
                                  active={managedSort.key === "private"}
                                  direction={managedSort.dir}
                                />
                              </button>
                            </th>
                            <th
                              scope="col"
                              aria-sort={
                                managedSort.key === "share"
                                  ? managedSort.dir
                                  : undefined
                              }
                              className="p-0 text-right"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleSortManaged(
                                    "share",
                                    m.memoryMonitor.colShare
                                  )
                                }
                                className={`flex min-h-7 w-full cursor-pointer items-center justify-end gap-1 px-2.5 py-1.5 font-medium hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                              >
                                <span>{m.memoryMonitor.colShare}</span>
                                <SortIcon
                                  active={managedSort.key === "share"}
                                  direction={managedSort.dir}
                                />
                              </button>
                            </th>
                            <th
                              scope="col"
                              className="px-3 py-1.5 text-right font-medium"
                            >
                              {m.memoryMonitor.colActions}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--dp-border-subtle)]">
                          {sortedSessions.map(({ session, meta, share }) => {
                            const isExpanded = Boolean(
                              expandedSessions[session.sessionKey]
                            );
                            const hasChildren = session.processes.length > 0;
                            return (
                              <Fragment key={session.sessionKey}>
                                <tr className="transition-colors hover:bg-[var(--dp-surface-hover)]/60">
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        disabled={!hasChildren}
                                        aria-expanded={
                                          hasChildren ? isExpanded : undefined
                                        }
                                        aria-label={
                                          isExpanded
                                            ? m.memoryMonitor.collapseTreeAria(
                                                meta.label
                                              )
                                            : m.memoryMonitor.expandTreeAria(
                                                meta.label
                                              )
                                        }
                                        onClick={() =>
                                          toggleExpandSession(
                                            session.sessionKey
                                          )
                                        }
                                        className={`cursor-pointer rounded p-0.5 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-bg)] hover:text-[var(--dp-fg)] disabled:cursor-default disabled:opacity-30 ${FOCUS_RING}`}
                                      >
                                        {isExpanded ? (
                                          <ChevronDown
                                            className="h-3.5 w-3.5"
                                            aria-hidden="true"
                                          />
                                        ) : (
                                          <ChevronRight
                                            className="h-3.5 w-3.5"
                                            aria-hidden="true"
                                          />
                                        )}
                                      </button>
                                      <span className="font-medium text-[var(--dp-fg)]">
                                        {meta.label}
                                      </span>
                                      {session.rootPid && (
                                        <span className="rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-1 py-px font-mono-dev text-[10px] text-[var(--dp-fg-muted)]">
                                          PID {session.rootPid}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-2.5 py-2 text-right font-mono-dev tabular-nums text-[var(--dp-fg-secondary)]">
                                    {session.processCount}
                                  </td>
                                  <td className="px-2.5 py-2 text-right font-mono-dev font-semibold tabular-nums text-[var(--dp-fg)]">
                                    {formatBytes(session.rssBytes)}
                                  </td>
                                  <td className="px-2.5 py-2 text-right font-mono-dev tabular-nums text-[var(--dp-fg-secondary)]">
                                    {formatBytes(session.privateBytes)}
                                  </td>
                                  <td className="px-2.5 py-2 text-right font-mono-dev tabular-nums text-[var(--dp-fg-muted)]">
                                    {share.toFixed(1)}%
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onSelectSession(
                                            meta.projectId,
                                            meta.commandId
                                          );
                                          onClose();
                                        }}
                                        title={
                                          m.memoryMonitor.jumpToTerminalTitle
                                        }
                                        aria-label={m.memoryMonitor.jumpToTerminalAria(
                                          meta.label
                                        )}
                                        className={`cursor-pointer rounded p-1 text-[var(--dp-info-text)] hover:bg-[var(--dp-info-soft)] ${FOCUS_RING}`}
                                      >
                                        <Terminal
                                          className="h-3.5 w-3.5"
                                          aria-hidden="true"
                                        />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onRestartSession(
                                            meta.projectId,
                                            meta.commandId
                                          )
                                        }
                                        title={
                                          m.memoryMonitor.restartSessionTitle
                                        }
                                        aria-label={m.memoryMonitor.restartSessionAria(
                                          meta.label
                                        )}
                                        className={`cursor-pointer rounded p-1 text-[var(--dp-warning-text)] hover:bg-[var(--dp-warning-soft)] ${FOCUS_RING}`}
                                      >
                                        <RotateCw
                                          className="h-3.5 w-3.5"
                                          aria-hidden="true"
                                        />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onStopSession(
                                            meta.projectId,
                                            meta.commandId
                                          )
                                        }
                                        title={m.memoryMonitor.stopSessionTitle}
                                        aria-label={m.memoryMonitor.stopSessionAria(
                                          meta.label
                                        )}
                                        className={`cursor-pointer rounded p-1 text-[var(--dp-danger-text)] hover:bg-[var(--dp-danger-soft)] ${FOCUS_RING}`}
                                      >
                                        <Square
                                          className="h-3 w-3 fill-current"
                                          aria-hidden="true"
                                        />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {isExpanded &&
                                  session.processes.map((proc) => (
                                    <tr
                                      key={`${session.sessionKey}::${proc.pid}`}
                                      className="bg-[var(--dp-bg)]/50 text-[11px] text-[var(--dp-fg-secondary)]"
                                    >
                                      <td className="py-1.5 pr-3 pl-9">
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono-dev text-[10px] text-[var(--dp-fg-muted)]">
                                            #{proc.pid}
                                          </span>
                                          <span className="truncate font-mono-dev">
                                            {proc.name}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="px-2.5 py-1.5 text-right font-mono-dev text-[10px] text-[var(--dp-fg-muted)]">
                                        PPID {proc.parentPid}
                                      </td>
                                      <td className="px-2.5 py-1.5 text-right font-mono-dev tabular-nums">
                                        {formatBytes(proc.rssBytes)}
                                      </td>
                                      <td className="px-2.5 py-1.5 text-right font-mono-dev tabular-nums text-[var(--dp-fg-muted)]">
                                        {formatBytes(proc.privateBytes)}
                                      </td>
                                      <td className="px-2.5 py-1.5 text-right font-mono-dev tabular-nums text-[var(--dp-fg-muted)]">
                                        {systemTotal > 0
                                          ? `${((proc.rssBytes / systemTotal) * 100).toFixed(1)}%`
                                          : "0.0%"}
                                      </td>
                                      <td />
                                    </tr>
                                  ))}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* System Top Processes Panel */}
              {activeTab === "processes" && (
                <div
                  id={panelProcessesId}
                  role="tabpanel"
                  aria-labelledby={tabProcessesId}
                  className="space-y-2.5 pt-3"
                >
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--dp-fg-muted)]"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      value={processFilter}
                      onChange={(e) => setProcessFilter(e.target.value)}
                      aria-label={m.memoryMonitor.searchAria}
                      placeholder={m.memoryMonitor.searchPlaceholder}
                      className={`w-full rounded-md border border-[var(--dp-border)] bg-[var(--dp-input-bg)] py-1.5 pr-7 pl-8 text-xs text-[var(--dp-fg)] placeholder-[var(--dp-fg-muted)] transition-colors focus:border-[var(--dp-info)] ${FOCUS_RING}`}
                    />
                    {processFilter && (
                      <button
                        type="button"
                        onClick={() => setProcessFilter("")}
                        aria-label={m.memoryMonitor.clearSearchAria}
                        className={`absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-0.5 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  {sortedProcesses.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--dp-border)] bg-[var(--dp-surface)]/50 px-4 py-8 text-center">
                      <div className="text-xs font-medium text-[var(--dp-fg-secondary)]">
                        {m.memoryMonitor.noProcessesTitle}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--dp-fg-muted)]">
                        {m.memoryMonitor.noProcessesDesc}
                      </p>
                    </div>
                  ) : (
                    <div
                      role="region"
                      aria-labelledby={processesCaptionId}
                      tabIndex={0}
                      className={`overflow-x-auto rounded-xl border border-[var(--dp-border)] bg-[var(--dp-surface)] ${FOCUS_RING}`}
                    >
                      <table className="w-full min-w-[540px] border-collapse text-left text-xs">
                        <caption id={processesCaptionId} className="sr-only">
                          {m.memoryMonitor.tableCaptionProcesses}
                        </caption>
                        <thead className="border-b border-[var(--dp-border)] bg-[var(--dp-bg)]/60 text-[11px] font-medium text-[var(--dp-fg-muted)]">
                          <tr>
                            <th
                              scope="col"
                              aria-sort={
                                processSort.key === "pid"
                                  ? processSort.dir
                                  : undefined
                              }
                              className="p-0"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleSortProcesses(
                                    "pid",
                                    m.memoryMonitor.colPid
                                  )
                                }
                                className={`flex min-h-7 w-full cursor-pointer items-center gap-1 px-3 py-1.5 text-left font-medium hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                              >
                                <span>{m.memoryMonitor.colPid}</span>
                                <SortIcon
                                  active={processSort.key === "pid"}
                                  direction={processSort.dir}
                                />
                              </button>
                            </th>
                            <th
                              scope="col"
                              aria-sort={
                                processSort.key === "name"
                                  ? processSort.dir
                                  : undefined
                              }
                              className="p-0"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleSortProcesses(
                                    "name",
                                    m.memoryMonitor.colProcess
                                  )
                                }
                                className={`flex min-h-7 w-full cursor-pointer items-center gap-1 px-2.5 py-1.5 text-left font-medium hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                              >
                                <span>{m.memoryMonitor.colProcess}</span>
                                <SortIcon
                                  active={processSort.key === "name"}
                                  direction={processSort.dir}
                                />
                              </button>
                            </th>
                            <th
                              scope="col"
                              aria-sort={
                                processSort.key === "rss"
                                  ? processSort.dir
                                  : undefined
                              }
                              className="p-0 text-right"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleSortProcesses(
                                    "rss",
                                    m.memoryMonitor.colRss
                                  )
                                }
                                className={`flex min-h-7 w-full cursor-pointer items-center justify-end gap-1 px-2.5 py-1.5 font-medium hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                              >
                                <span>{m.memoryMonitor.colRss}</span>
                                <SortIcon
                                  active={processSort.key === "rss"}
                                  direction={processSort.dir}
                                />
                              </button>
                            </th>
                            <th
                              scope="col"
                              aria-sort={
                                processSort.key === "private"
                                  ? processSort.dir
                                  : undefined
                              }
                              className="p-0 text-right"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleSortProcesses(
                                    "private",
                                    m.memoryMonitor.colPrivate
                                  )
                                }
                                className={`flex min-h-7 w-full cursor-pointer items-center justify-end gap-1 px-2.5 py-1.5 font-medium hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                              >
                                <span>{m.memoryMonitor.colPrivate}</span>
                                <SortIcon
                                  active={processSort.key === "private"}
                                  direction={processSort.dir}
                                />
                              </button>
                            </th>
                            <th
                              scope="col"
                              aria-sort={
                                processSort.key === "share"
                                  ? processSort.dir
                                  : undefined
                              }
                              className="p-0 text-right"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleSortProcesses(
                                    "share",
                                    m.memoryMonitor.colShare
                                  )
                                }
                                className={`flex min-h-7 w-full cursor-pointer items-center justify-end gap-1 px-3 py-1.5 font-medium hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                              >
                                <span>{m.memoryMonitor.colShare}</span>
                                <SortIcon
                                  active={processSort.key === "share"}
                                  direction={processSort.dir}
                                />
                              </button>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--dp-border-subtle)]">
                          {sortedProcesses.map(({ proc, share }) => {
                            const sessionMeta = proc.sessionKey
                              ? resolveSessionMeta(proc.sessionKey, projects)
                              : null;

                            return (
                              <tr
                                key={proc.pid}
                                className="transition-colors hover:bg-[var(--dp-surface-hover)]/60"
                              >
                                <td className="px-3 py-2 font-mono-dev text-[11px] tabular-nums text-[var(--dp-fg-muted)]">
                                  {proc.pid}
                                </td>
                                <td className="px-2.5 py-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-mono-dev font-medium text-[var(--dp-fg)]">
                                      {proc.name}
                                    </span>
                                    {sessionMeta && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onSelectSession(
                                            sessionMeta.projectId,
                                            sessionMeta.commandId
                                          );
                                          onClose();
                                        }}
                                        title={
                                          m.memoryMonitor.jumpToTerminalTitle
                                        }
                                        className={`inline-flex cursor-pointer items-center gap-1 rounded border border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] px-1.5 py-px text-[10px] font-medium text-[var(--dp-accent-text)] transition-opacity hover:opacity-85 ${FOCUS_RING}`}
                                      >
                                        <span>
                                          {m.memoryMonitor.managedSessionTag}:{" "}
                                          {sessionMeta.label}
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="px-2.5 py-2 text-right font-mono-dev font-semibold tabular-nums text-[var(--dp-fg)]">
                                  {formatBytes(proc.rssBytes)}
                                </td>
                                <td className="px-2.5 py-2 text-right font-mono-dev tabular-nums text-[var(--dp-fg-secondary)]">
                                  {formatBytes(proc.privateBytes)}
                                </td>
                                <td className="px-3 py-2 text-right font-mono-dev tabular-nums text-[var(--dp-fg-muted)]">
                                  {share.toFixed(1)}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
