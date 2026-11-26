import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  CaseSensitive,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Code2,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  FolderOpen,
  MemoryStick,
  PanelRightClose,
  Play,
  Regex,
  RotateCw,
  Search,
  Square,
  Terminal as TerminalIcon,
  TerminalSquare,
  TextSelect,
  X,
} from "lucide-react";
import type { OutputChunk } from "../hooks/useDevPanel";
import type { AppSettings, CursorStyle } from "../hooks/useSettings";
import { useI18n } from "../i18n";
import type {
  ProjectConfig,
  ProjectStatus,
  SessionMemoryInfo,
  TerminalSize,
} from "../types/project";
import {
  buildMiniSparklinePoints,
  formatBytes,
  formatBytesCompact,
  formatMemoryShare,
  getProjectTotalMemoryBytes,
} from "../utils/memoryFormat";
import {
  formatClickShortcut,
  formatShortcut,
  type PlatformId,
} from "../utils/platform";
import {
  countRunningCommands,
  getProjectSessionKeys,
  isMultiCommandProject,
  makeSessionKey,
  resolveCommandCwd,
  resolveSessionOpenUrl,
} from "../utils/projectCommands";

interface TerminalViewProps {
  projects: ProjectConfig[];
  selectedProject: ProjectConfig | null;
  selectedCommandId: string | null;
  statuses: Record<string, ProjectStatus>;
  exitCodes: Record<string, number | null>;
  detectedUrls: Record<string, string>;
  sessionMemoryMap?: Record<string, SessionMemoryInfo>;
  sessionHistoryMap?: Record<string, number[]>;
  sessionPeakMap?: Record<string, number>;
  systemTotalMemoryBytes?: number;
  terminalTheme: ITheme;
  settings: AppSettings;
  platform: PlatformId;
  isVisible: boolean;
  searchTrigger?: number;
  onCollapseLog: () => void;
  onOpenMemoryMonitor?: () => void;
  subscribeOutput: (id: string, cb: (chunk: OutputChunk) => void) => () => void;
  fetchHistory: (id: string) => Promise<OutputChunk>;
  reportTerminalSize: (id: string, size: TerminalSize) => void;
  onSelectCommand: (id: string, commandId: string) => void;
  onStart: (id: string, commandId?: string | null) => void;
  onStop: (id: string, commandId?: string | null) => void;
  onRestart: (id: string, commandId?: string | null) => void;
  onStartAll: (project: ProjectConfig) => void;
  onStopAll: (projectId: string) => void;
  onOpenDir: (cwd: string) => void;
  onOpenInEditor: (cwd: string) => void;
  onOpenInExternalTerminal: (cwd: string, shell?: string) => void;
  onOpenUrl: (url: string) => void;
  onExportLog: (defaultName: string, content: string) => void;
  onClearHistory: (id: string) => void;
  onNotify?: (message: string, type?: "info" | "success" | "error") => void;
}

interface ProjectTerminalPaneProps {
  sessionKey: string;
  isActive: boolean;
  terminalTheme: ITheme;
  fontSize: number;
  lineHeight: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  scrollback: number;
  subscribeOutput: (id: string, cb: (chunk: OutputChunk) => void) => () => void;
  fetchHistory: (id: string) => Promise<OutputChunk>;
  reportTerminalSize: (id: string, size: TerminalSize) => void;
  onSizeMeasured: (id: string, size: TerminalSize) => void;
  registerClearHandler: (id: string, fn: (() => void) | null) => void;
  registerSearchAddon: (id: string, addon: SearchAddon | null) => void;
  registerExportHandler: (id: string, fn: (() => string) | null) => void;
  registerFocusHandler: (id: string, fn: (() => void) | null) => void;
  onOpenSearch: () => void;
  onOpenUrl: (url: string) => void;
  onClearSession: (id: string) => void;
  onExportCurrent: () => void;
  onNotify?: (message: string, type?: "info" | "success" | "error") => void;
}

interface TerminalContextMenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

const MAX_STOPPED_MOUNTED = 6;

const SEARCH_DECORATIONS = {
  matchBackground: "#475569",
  matchOverviewRuler: "#64748b",
  activeMatchBackground: "#0284c7",
  activeMatchColorOverviewRuler: "#38bdf8",
};

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to execCommand fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-sidebar)]";

function ProjectTerminalPane({
  sessionKey,
  isActive,
  terminalTheme,
  fontSize,
  lineHeight,
  cursorStyle,
  cursorBlink,
  scrollback,
  subscribeOutput,
  fetchHistory,
  reportTerminalSize,
  onSizeMeasured,
  registerClearHandler,
  registerSearchAddon,
  registerExportHandler,
  registerFocusHandler,
  onOpenSearch,
  onOpenUrl,
  onClearSession,
  onExportCurrent,
  onNotify,
}: ProjectTerminalPaneProps) {
  const { m } = useI18n();
  const mRef = useRef(m);
  mRef.current = m;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const needsRefreshRef = useRef(false);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const onClearSessionRef = useRef(onClearSession);
  onClearSessionRef.current = onClearSession;
  const onOpenSearchRef = useRef(onOpenSearch);
  onOpenSearchRef.current = onOpenSearch;
  const onOpenUrlRef = useRef(onOpenUrl);
  onOpenUrlRef.current = onOpenUrl;
  const onExportCurrentRef = useRef(onExportCurrent);
  onExportCurrentRef.current = onExportCurrent;
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;
  const [contextMenu, setContextMenu] =
    useState<TerminalContextMenuState | null>(null);

  const initialOptionsRef = useRef({
    theme: terminalTheme,
    fontSize,
    lineHeight,
    cursorStyle,
    cursorBlink,
    scrollback,
  });
  initialOptionsRef.current = {
    theme: terminalTheme,
    fontSize,
    lineHeight,
    cursorStyle,
    cursorBlink,
    scrollback,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const init = initialOptionsRef.current;
    const term = new Terminal({
      cursorBlink: init.cursorBlink,
      cursorStyle: init.cursorStyle,
      fontSize: init.fontSize,
      lineHeight: init.lineHeight,
      fontFamily:
        "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
      scrollback: init.scrollback,
      theme: init.theme,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (event.ctrlKey || event.metaKey) {
        onOpenUrlRef.current(uri);
      }
    });
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);
    term.open(container);

    const viewport = container.querySelector(
      ".xterm-viewport"
    ) as HTMLElement | null;
    if (viewport && init.theme.background) {
      viewport.style.backgroundColor = init.theme.background;
    }

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    registerSearchAddon(sessionKey, searchAddon);
    registerFocusHandler(sessionKey, () => term.focus());
    registerExportHandler(sessionKey, () => {
      const buf = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buf.length; i += 1) {
        lines.push(buf.getLine(i)?.translateToString(true) ?? "");
      }
      while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      return lines.join("\n");
    });

    const copySelection = (): boolean => {
      if (!term.hasSelection()) return false;
      const selected = term.getSelection();
      if (!selected) return false;
      term.clearSelection();
      void copyTextToClipboard(selected).then((ok) => {
        onNotifyRef.current?.(
          ok ? mRef.current.terminal.copiedSelection : mRef.current.terminal.copyFailed,
          ok ? "success" : "error"
        );
        term.focus();
      });
      return true;
    };

    const pasteFromClipboard = async () => {
      try {
        if (!navigator.clipboard?.readText) {
          onNotifyRef.current?.(
            mRef.current.terminal.clipboardReadUnsupported,
            "error"
          );
          return;
        }
        const text = await navigator.clipboard.readText();
        if (text) {
          term.paste(text);
        }
        term.focus();
      } catch {
        onNotifyRef.current?.(mRef.current.terminal.pasteFailed, "error");
      }
    };

    // Intercept Ctrl+C (when text selected) and Ctrl+F (search)
    let suppressCtrlCKeyup = false;
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isPrimary = (event.ctrlKey || event.metaKey) && !event.altKey;

      if (isPrimary && !event.shiftKey && key === "f") {
        if (event.type === "keydown") {
          event.preventDefault();
          onOpenSearchRef.current();
        }
        return false;
      }

      if (isPrimary && !event.shiftKey && key === "c") {
        if (event.type === "keydown") {
          if (term.hasSelection()) {
            event.preventDefault();
            suppressCtrlCKeyup = true;
            copySelection();
            return false;
          }
          suppressCtrlCKeyup = false;
          return true;
        }
        if (suppressCtrlCKeyup) {
          if (event.type === "keyup") {
            suppressCtrlCKeyup = false;
          }
          return false;
        }
        return true;
      }

      if (isPrimary && event.shiftKey && key === "c") {
        if (event.type === "keydown") {
          event.preventDefault();
          copySelection();
        }
        return false;
      }

      if (
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        event.key === "Insert"
      ) {
        if (event.type === "keydown" && term.hasSelection()) {
          event.preventDefault();
          copySelection();
        }
        return false;
      }

      if (isPrimary && !event.shiftKey && key === "v") {
        return false;
      }

      if (isPrimary && event.shiftKey && key === "v") {
        if (event.type === "keydown") {
          event.preventDefault();
          void pasteFromClipboard();
        }
        return false;
      }

      return true;
    });

    const syncSize = () => {
      if (!isActiveRef.current) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        fitAddon.fit();
        const size = { cols: term.cols, rows: term.rows };
        reportTerminalSize(sessionKey, size);
        onSizeMeasured(sessionKey, size);
        invoke("resize_pty", { id: sessionKey, ...size }).catch(() => {});
      } catch {
        // Ignore transient resize errors while hidden
      }
    };

    registerClearHandler(sessionKey, () => {
      term.clear();
    });

    // Hydrate backend ring buffer and attach live output stream with seq deduplication
    let hydrated = false;
    let lastSeq = 0;
    const pendingChunks: OutputChunk[] = [];

    const unsubscribe = subscribeOutput(sessionKey, (chunk) => {
      if (!hydrated) {
        pendingChunks.push(chunk);
        return;
      }
      if (chunk.seq > lastSeq || chunk.seq === 0) {
        term.write(chunk.bytes);
        if (chunk.seq > lastSeq) lastSeq = chunk.seq;
      }
    });

    fetchHistory(sessionKey)
      .then((history) => {
        if (history.bytes.length > 0) {
          term.write(history.bytes);
        }
        lastSeq = history.seq;
        hydrated = true;
        for (const chunk of pendingChunks) {
          if (chunk.seq > lastSeq || chunk.seq === 0) {
            term.write(chunk.bytes);
            if (chunk.seq > lastSeq) lastSeq = chunk.seq;
          }
        }
        pendingChunks.length = 0;
      })
      .catch(() => {
        hydrated = true;
      });

    const dataDisposable = term.onData((data) => {
      invoke("write_pty", { id: sessionKey, data }).catch(() => {});
    });

    const observer = new ResizeObserver(() => {
      syncSize();
    });
    observer.observe(container);

    requestAnimationFrame(syncSize);

    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      unsubscribe();
      registerClearHandler(sessionKey, null);
      registerSearchAddon(sessionKey, null);
      registerExportHandler(sessionKey, null);
      registerFocusHandler(sessionKey, null);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [
    sessionKey,
    subscribeOutput,
    fetchHistory,
    reportTerminalSize,
    onSizeMeasured,
    registerClearHandler,
    registerSearchAddon,
    registerExportHandler,
    registerFocusHandler,
  ]);

  // Apply theme & terminal preferences live without recreating the PTY view
  useEffect(() => {
    const term = termRef.current;
    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term) return;

    term.options.theme = terminalTheme;
    term.options.fontSize = fontSize;
    term.options.lineHeight = lineHeight;
    term.options.cursorStyle = cursorStyle;
    term.options.cursorBlink = cursorBlink;
    term.options.scrollback = scrollback;

    const viewport = container?.querySelector(
      ".xterm-viewport"
    ) as HTMLElement | null;
    if (viewport && terminalTheme.background) {
      viewport.style.backgroundColor = terminalTheme.background;
    }

    if (
      isActiveRef.current &&
      fitAddon &&
      container &&
      container.clientWidth > 0 &&
      container.clientHeight > 0
    ) {
      term.refresh(0, Math.max(0, term.rows - 1));
      needsRefreshRef.current = false;
      try {
        fitAddon.fit();
        const size = { cols: term.cols, rows: term.rows };
        reportTerminalSize(sessionKey, size);
        onSizeMeasured(sessionKey, size);
        invoke("resize_pty", { id: sessionKey, ...size }).catch(() => {});
      } catch {
        // Ignore transient fit failure
      }
    } else {
      needsRefreshRef.current = true;
    }
  }, [
    terminalTheme,
    fontSize,
    lineHeight,
    cursorStyle,
    cursorBlink,
    scrollback,
    sessionKey,
    reportTerminalSize,
    onSizeMeasured,
  ]);

  useEffect(() => {
    if (!isActive) return;
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      const term = termRef.current;
      const fitAddon = fitAddonRef.current;
      if (!container || !term || !fitAddon) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        if (needsRefreshRef.current) {
          term.refresh(0, Math.max(0, term.rows - 1));
          needsRefreshRef.current = false;
        }
        fitAddon.fit();
        const size = { cols: term.cols, rows: term.rows };
        reportTerminalSize(sessionKey, size);
        onSizeMeasured(sessionKey, size);
        invoke("resize_pty", { id: sessionKey, ...size }).catch(() => {});
        term.focus();
      } catch {
        // Ignore
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [isActive, sessionKey, reportTerminalSize, onSizeMeasured]);

  useEffect(() => {
    if (!isActive && contextMenu) {
      setContextMenu(null);
    }
  }, [isActive, contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
        termRef.current?.focus();
      }
    };
    const handleBlur = () => setContextMenu(null);

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
    };
  }, [contextMenu]);

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - 188));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - 216));
    setContextMenu({
      x,
      y,
      hasSelection: termRef.current?.hasSelection() ?? false,
    });
  };

  const handleMenuCopy = async () => {
    const term = termRef.current;
    setContextMenu(null);
    if (!term || !term.hasSelection()) return;
    const selected = term.getSelection();
    if (!selected) return;
    term.clearSelection();
    const ok = await copyTextToClipboard(selected);
    onNotifyRef.current?.(
      ok ? mRef.current.terminal.copiedSelection : mRef.current.terminal.copyFailed,
      ok ? "success" : "error"
    );
    term.focus();
  };

  const handleMenuPaste = async () => {
    const term = termRef.current;
    setContextMenu(null);
    if (!term) return;
    try {
      if (!navigator.clipboard?.readText) {
        onNotifyRef.current?.(
          mRef.current.terminal.clipboardReadUnsupported,
          "error"
        );
        return;
      }
      const text = await navigator.clipboard.readText();
      if (text) {
        term.paste(text);
      }
      term.focus();
    } catch {
      onNotifyRef.current?.(mRef.current.terminal.pasteFailed, "error");
    }
  };

  const handleMenuSelectAll = () => {
    const term = termRef.current;
    setContextMenu(null);
    if (!term) return;
    term.selectAll();
    term.focus();
  };

  const handleMenuClear = () => {
    const term = termRef.current;
    setContextMenu(null);
    if (!term) return;
    term.clear();
    onClearSessionRef.current(sessionKey);
    term.focus();
  };

  return (
    <div
      onContextMenu={handleContextMenu}
      className={isActive ? "relative h-full w-full" : "hidden h-full w-full"}
    >
      <div ref={containerRef} className="h-full w-full" />

      {contextMenu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={m.terminal.contextMenuAria}
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            boxShadow: "var(--dp-shadow)",
          }}
          className="fixed z-50 w-44 rounded-lg border border-[var(--dp-border)] bg-[var(--dp-modal)] py-1 text-xs text-[var(--dp-fg)] select-none"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!contextMenu.hasSelection}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleMenuCopy()}
            className="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-[var(--dp-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="inline-flex items-center gap-2">
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              {m.common.copy}
            </span>
            <kbd className="font-mono-dev text-[10px] text-[var(--dp-fg-muted)]">
              Ctrl+C
            </kbd>
          </button>

          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleMenuPaste()}
            className="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-[var(--dp-surface-hover)]"
          >
            <span className="inline-flex items-center gap-2">
              <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
              {m.terminal.paste}
            </span>
            <kbd className="font-mono-dev text-[10px] text-[var(--dp-fg-muted)]">
              Ctrl+V
            </kbd>
          </button>

          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleMenuSelectAll}
            className="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-[var(--dp-surface-hover)]"
          >
            <span className="inline-flex items-center gap-2">
              <TextSelect className="h-3.5 w-3.5" aria-hidden="true" />
              {m.terminal.selectAll}
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setContextMenu(null);
              onOpenSearchRef.current();
            }}
            className="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-[var(--dp-surface-hover)]"
          >
            <span className="inline-flex items-center gap-2">
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              {m.terminal.find}
            </span>
            <kbd className="font-mono-dev text-[10px] text-[var(--dp-fg-muted)]">
              Ctrl+F
            </kbd>
          </button>

          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setContextMenu(null);
              onExportCurrentRef.current();
            }}
            className="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-[var(--dp-surface-hover)]"
          >
            <span className="inline-flex items-center gap-2">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {m.terminal.exportLog}
            </span>
          </button>

          <div
            role="separator"
            className="my-1 border-t border-[var(--dp-border)]"
          />

          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleMenuClear}
            className="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-[var(--dp-surface-hover)]"
          >
            <span className="inline-flex items-center gap-2">
              <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
              {m.terminal.clear}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  exitCode,
}: {
  status: ProjectStatus;
  exitCode: number | null;
}) {
  const { m } = useI18n();
  const styles: Record<ProjectStatus, string> = {
    running:
      "border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] text-[var(--dp-accent-text)]",
    starting:
      "border-[var(--dp-warning-border)] bg-[var(--dp-warning-soft)] text-[var(--dp-warning-text)]",
    stopping:
      "border-[var(--dp-warning-border)] bg-[var(--dp-warning-soft)] text-[var(--dp-warning-text)]",
    stopped:
      "border-[var(--dp-border)] bg-[var(--dp-surface)] text-[var(--dp-fg-secondary)]",
  };
  const dotStyles: Record<ProjectStatus, string> = {
    running: "bg-[var(--dp-accent)]",
    starting: "bg-[var(--dp-warning)] motion-safe:animate-pulse",
    stopping: "bg-[var(--dp-warning)] motion-safe:animate-pulse",
    stopped: "bg-[var(--dp-fg-muted)]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${dotStyles[status]}`}
      />
      <span>{m.status.ofStatus(status)}</span>
      {status === "stopped" && exitCode !== null && (
        <span className="font-mono-dev text-[10px] tabular-nums text-[var(--dp-fg-muted)]">
          (exit {exitCode})
        </span>
      )}
    </span>
  );
}

export function TerminalView({
  projects,
  selectedProject,
  selectedCommandId,
  statuses,
  exitCodes,
  detectedUrls,
  sessionMemoryMap,
  sessionHistoryMap,
  sessionPeakMap,
  systemTotalMemoryBytes = 0,
  terminalTheme,
  settings,
  platform,
  isVisible,
  searchTrigger = 0,
  onCollapseLog,
  onOpenMemoryMonitor,
  subscribeOutput,
  fetchHistory,
  reportTerminalSize,
  onSelectCommand,
  onStart,
  onStop,
  onRestart,
  onStartAll,
  onStopAll,
  onOpenDir,
  onOpenInEditor,
  onOpenInExternalTerminal,
  onOpenUrl,
  onExportLog,
  onClearHistory,
  onNotify,
}: TerminalViewProps) {
  const { m, locale } = useI18n();
  const [mountedIds, setMountedIds] = useState<string[]>([]);
  const [sizesById, setSizesById] = useState<Record<string, TerminalSize>>({});
  const [copiedCwd, setCopiedCwd] = useState(false);
  const [memDetailsOpen, setMemDetailsOpen] = useState(false);
  const memDetailsId = useId();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchMatchInfo, setSearchMatchInfo] = useState<{
    index: number;
    count: number;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const clearHandlersRef = useRef<Map<string, () => void>>(new Map());
  const searchAddonsRef = useRef<Map<string, SearchAddon>>(new Map());
  const exportHandlersRef = useRef<Map<string, () => string>>(new Map());
  const focusHandlersRef = useRef<Map<string, () => void>>(new Map());
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const handleSizeMeasured = useCallback((id: string, size: TerminalSize) => {
    setSizesById((prev) => {
      const curr = prev[id];
      if (curr && curr.cols === size.cols && curr.rows === size.rows) {
        return prev;
      }
      return { ...prev, [id]: size };
    });
  }, []);

  const registerClearHandler = useMemo(
    () => (id: string, fn: (() => void) | null) => {
      if (fn) {
        clearHandlersRef.current.set(id, fn);
      } else {
        clearHandlersRef.current.delete(id);
      }
    },
    []
  );

  const registerSearchAddon = useMemo(
    () => (id: string, addon: SearchAddon | null) => {
      if (addon) {
        searchAddonsRef.current.set(id, addon);
      } else {
        searchAddonsRef.current.delete(id);
      }
    },
    []
  );

  const registerExportHandler = useMemo(
    () => (id: string, fn: (() => string) | null) => {
      if (fn) {
        exportHandlersRef.current.set(id, fn);
      } else {
        exportHandlersRef.current.delete(id);
      }
    },
    []
  );

  const registerFocusHandler = useMemo(
    () => (id: string, fn: (() => void) | null) => {
      if (fn) {
        focusHandlersRef.current.set(id, fn);
      } else {
        focusHandlersRef.current.delete(id);
      }
    },
    []
  );

  const isMulti = selectedProject ? isMultiCommandProject(selectedProject) : false;
  const projectCommands = selectedProject?.commands ?? [];
  const activeCommand = useMemo(() => {
    if (!selectedProject || !isMulti) return null;
    return (
      projectCommands.find((c) => c.id === selectedCommandId) ??
      projectCommands[0] ??
      null
    );
  }, [selectedProject, isMulti, projectCommands, selectedCommandId]);

  const activeSessionKey = useMemo(() => {
    if (!selectedProject) return null;
    return activeCommand
      ? makeSessionKey(selectedProject.id, activeCommand.id)
      : selectedProject.id;
  }, [selectedProject, activeCommand]);

  // Mount terminal instances lazily with LRU eviction for stopped inactive panes
  useEffect(() => {
    const validKeys = new Set(projects.flatMap(getProjectSessionKeys));
    setMountedIds((prev) => {
      let next = prev.filter((id) => validKeys.has(id));

      if (activeSessionKey && validKeys.has(activeSessionKey)) {
        next = [...next.filter((id) => id !== activeSessionKey), activeSessionKey];
      }

      for (const key of validKeys) {
        const s = statuses[key];
        if (
          (s === "running" || s === "starting" || s === "stopping") &&
          !next.includes(key)
        ) {
          next.push(key);
        }
      }

      const stoppedInactive = next.filter((id) => {
        if (id === activeSessionKey) return false;
        const s = statuses[id] ?? "stopped";
        return s === "stopped";
      });

      if (stoppedInactive.length > MAX_STOPPED_MOUNTED) {
        const toEvict = new Set(
          stoppedInactive.slice(0, stoppedInactive.length - MAX_STOPPED_MOUNTED)
        );
        next = next.filter((id) => !toEvict.has(id));
      }

      if (
        next.length === prev.length &&
        next.every((id, idx) => id === prev[idx])
      ) {
        return prev;
      }
      return next;
    });
  }, [projects, activeSessionKey, statuses]);

  useEffect(() => {
    setCopiedCwd(false);
    setSearchMatchInfo(null);
  }, [activeSessionKey]);

  const openSearchBar = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    if (searchTrigger > 0 && isVisible && activeSessionKey) {
      openSearchBar();
    }
  }, [searchTrigger, isVisible, activeSessionKey, openSearchBar]);

  const closeSearchBar = useCallback(() => {
    setSearchOpen(false);
    setSearchMatchInfo(null);
    if (activeSessionKey) {
      searchAddonsRef.current.get(activeSessionKey)?.clearDecorations();
      focusHandlersRef.current.get(activeSessionKey)?.();
    }
  }, [activeSessionKey]);

  useEffect(() => {
    if (!searchOpen || !activeSessionKey) return;
    const addon = searchAddonsRef.current.get(activeSessionKey);
    if (!addon) return;

    const disposable = addon.onDidChangeResults((ev) => {
      setSearchMatchInfo({ index: ev.resultIndex, count: ev.resultCount });
    });

    if (searchQuery) {
      addon.findNext(searchQuery, {
        caseSensitive: searchCaseSensitive,
        regex: searchRegex,
        incremental: true,
        decorations: SEARCH_DECORATIONS,
      });
    } else {
      addon.clearDecorations();
      setSearchMatchInfo(null);
    }

    return () => {
      disposable.dispose();
    };
  }, [
    searchOpen,
    activeSessionKey,
    searchQuery,
    searchCaseSensitive,
    searchRegex,
  ]);

  const runSearchStep = useCallback(
    (direction: "next" | "prev") => {
      if (!activeSessionKey || !searchQuery) return;
      const addon = searchAddonsRef.current.get(activeSessionKey);
      if (!addon) return;
      const opts = {
        caseSensitive: searchCaseSensitive,
        regex: searchRegex,
        decorations: SEARCH_DECORATIONS,
      };
      if (direction === "next") {
        addon.findNext(searchQuery, opts);
      } else {
        addon.findPrevious(searchQuery, opts);
      }
    },
    [activeSessionKey, searchQuery, searchCaseSensitive, searchRegex]
  );

  useEffect(() => {
    if (!activeCommand) return;
    const el = tabRefs.current.get(activeCommand.id);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeCommand?.id, selectedProject?.id]);

  const handleExportCurrent = useCallback(() => {
    if (!selectedProject || !activeSessionKey) return;
    const getter = exportHandlersRef.current.get(activeSessionKey);
    const content = getter ? getter() : "";
    const fileStem = activeCommand
      ? `${selectedProject.id}-${activeCommand.id}`
      : selectedProject.id;
    onExportLog(`${fileStem}.log`, content);
  }, [selectedProject, activeCommand, activeSessionKey, onExportLog]);

  const activeSessionStatus: ProjectStatus = activeSessionKey
    ? (statuses[activeSessionKey] ?? "stopped")
    : "stopped";

  useEffect(() => {
    setMemDetailsOpen(false);
  }, [activeSessionKey]);

  useEffect(() => {
    if (activeSessionStatus === "stopped") {
      setMemDetailsOpen(false);
    }
  }, [activeSessionStatus]);

  if (!selectedProject || !activeSessionKey) {
    return (
      <main
        style={{
          backgroundColor:
            terminalTheme.background ?? "var(--dp-terminal-bg)",
        }}
        className="flex flex-1 flex-col items-center justify-center px-6 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--dp-border)] bg-[var(--dp-sidebar)] text-[var(--dp-fg-muted)]">
          <TerminalSquare className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="mt-3 text-sm font-medium text-[var(--dp-fg)]">
          {m.terminal.noProjectTitle}
        </h2>
        <p className="mt-1 text-xs text-[var(--dp-fg-muted)]">
          {m.terminal.noProjectHint}
        </p>
      </main>
    );
  }

  const activeCommandId = activeCommand?.id ?? null;
  const activeCwd = activeCommand
    ? resolveCommandCwd(selectedProject.cwd, activeCommand.cwd)
    : selectedProject.cwd;
  const activeShell =
    activeCommand?.shell?.trim() ||
    selectedProject.shell?.trim() ||
    settings.defaultShell;
  const configuredUrl =
    activeCommand?.url?.trim() || selectedProject.url?.trim() || undefined;
  const liveDetectedUrl = detectedUrls[activeSessionKey];
  const activeUrl = resolveSessionOpenUrl(configuredUrl, liveDetectedUrl);
  const activeCmdText = activeCommand
    ? activeCommand.command
    : selectedProject.command;

  const status: ProjectStatus = activeSessionStatus;
  const exitCode = exitCodes[activeSessionKey] ?? null;
  const isTransitioning = status === "starting" || status === "stopping";
  const activeSize = sizesById[activeSessionKey];
  const runningCmdCount = isMulti
    ? countRunningCommands(selectedProject, statuses)
    : 0;

  const activeSessionMemory = sessionMemoryMap?.[activeSessionKey] ?? null;
  const activeSessionHistory = sessionHistoryMap?.[activeSessionKey] ?? [];
  const activeSessionPeak =
    sessionPeakMap?.[activeSessionKey] ?? activeSessionMemory?.rssBytes ?? 0;
  const projectTotalMemoryBytes = sessionMemoryMap
    ? getProjectTotalMemoryBytes(selectedProject, sessionMemoryMap)
    : 0;
  const activeSharePct =
    systemTotalMemoryBytes > 0 && activeSessionMemory
      ? (activeSessionMemory.rssBytes / systemTotalMemoryBytes) * 100
      : 0;
  const miniSparklinePoints = buildMiniSparklinePoints(
    activeSessionHistory,
    36,
    12,
    1.5
  );
  const sessionLoadTone =
    activeSharePct >= 45
      ? "border-[var(--dp-danger-border)] bg-[var(--dp-danger-soft)] text-[var(--dp-danger-text)]"
      : activeSharePct >= 25
        ? "border-[var(--dp-warning-border)] bg-[var(--dp-warning-soft)] text-[var(--dp-warning-text)]"
        : "border-[var(--dp-border)] bg-[var(--dp-surface)] text-[var(--dp-fg-secondary)] hover:border-[var(--dp-border-strong)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)]";

  const handleCopyCwd = async () => {
    const ok = await copyTextToClipboard(activeCwd);
    if (ok) {
      setCopiedCwd(true);
      window.setTimeout(() => setCopiedCwd(false), 1600);
    }
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (projectCommands.length === 0) return;
    let nextIdx: number | null = null;
    if (event.key === "ArrowRight") {
      nextIdx = (index + 1) % projectCommands.length;
    } else if (event.key === "ArrowLeft") {
      nextIdx = (index - 1 + projectCommands.length) % projectCommands.length;
    } else if (event.key === "Home") {
      nextIdx = 0;
    } else if (event.key === "End") {
      nextIdx = projectCommands.length - 1;
    }
    if (nextIdx === null) return;
    event.preventDefault();
    const targetCmd = projectCommands[nextIdx];
    onSelectCommand(selectedProject.id, targetCmd.id);
    tabRefs.current.get(targetCmd.id)?.focus();
  };

  const ptyBg = terminalTheme.background ?? "var(--dp-terminal-bg)";
  const ptyFg = terminalTheme.foreground ?? "var(--dp-fg)";

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-[var(--dp-terminal-bg)]">
      {/* Top Toolbar */}
      <header className="border-b border-[var(--dp-border)] bg-[var(--dp-sidebar)] px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="truncate text-sm font-semibold text-[var(--dp-fg)]">
              {selectedProject.name}
            </h2>
            {activeCommand && (
              <span className="truncate rounded border border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--dp-info-text)]">
                {activeCommand.name}
              </span>
            )}
            <StatusBadge status={status} exitCode={exitCode} />
            {status !== "stopped" && (
              <button
                type="button"
                aria-expanded={memDetailsOpen}
                aria-controls={memDetailsId}
                aria-label={m.terminal.memDetailsToggleAria}
                onClick={() => setMemDetailsOpen((prev) => !prev)}
                title={
                  activeSessionMemory
                    ? m.terminal.memoryBadgeTitle(
                        formatBytes(activeSessionMemory.rssBytes),
                        formatBytes(activeSessionMemory.privateBytes),
                        activeSessionMemory.processCount
                      )
                    : m.terminal.memMeasuring
                }
                className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono-dev text-[11px] font-medium tabular-nums transition-colors ${sessionLoadTone} ${FOCUS_RING}`}
              >
                <MemoryStick
                  className={`h-3 w-3 shrink-0 ${
                    activeSharePct < 25 ? "text-[var(--dp-accent)]" : ""
                  }`}
                  aria-hidden="true"
                />
                <span>
                  {activeSessionMemory && activeSessionMemory.rssBytes > 0
                    ? formatBytesCompact(activeSessionMemory.rssBytes)
                    : m.terminal.memMeasuring}
                </span>
                {miniSparklinePoints && activeSessionMemory && (
                  <svg
                    width="36"
                    height="12"
                    viewBox="0 0 36 12"
                    role="img"
                    aria-label={m.terminal.memSparklineAria(
                      formatBytes(activeSessionMemory.rssBytes),
                      formatBytes(activeSessionPeak)
                    )}
                    className="hidden shrink-0 sm:block"
                  >
                    <polyline
                      fill="none"
                      stroke={
                        activeSharePct >= 45
                          ? "var(--dp-danger)"
                          : activeSharePct >= 25
                            ? "var(--dp-warning)"
                            : "var(--dp-accent)"
                      }
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={miniSparklinePoints}
                    />
                  </svg>
                )}
                {activeSessionMemory && activeSessionMemory.processCount > 1 && (
                  <span className="text-[10px] opacity-80">
                    · {activeSessionMemory.processCount}
                  </span>
                )}
                {memDetailsOpen ? (
                  <ChevronUp
                    className="h-3 w-3 shrink-0 opacity-75"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronDown
                    className="h-3 w-3 shrink-0 opacity-75"
                    aria-hidden="true"
                  />
                )}
              </button>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5 select-none">
            {/* Primary Process Controls for active command */}
            {status === "stopped" ? (
              <button
                type="button"
                onClick={() => onStart(selectedProject.id, activeCommandId)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[var(--dp-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--dp-accent-fg)] transition-colors duration-150 hover:bg-[var(--dp-accent-hover)] ${FOCUS_RING}`}
              >
                <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                {isMulti ? m.terminal.startCurrent : m.common.start}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={status === "stopping"}
                  onClick={() => onStop(selectedProject.id, activeCommandId)}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[var(--dp-danger)] px-3 py-1.5 text-xs font-semibold text-[var(--dp-danger-fg)] transition-colors duration-150 hover:bg-[var(--dp-danger-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                >
                  <Square
                    className="h-3.5 w-3.5 fill-current"
                    aria-hidden="true"
                  />
                  {status === "stopping"
                    ? m.common.stoppingEllipsis
                    : isMulti
                      ? m.terminal.stopCurrent
                      : m.common.stop}
                </button>
                <button
                  type="button"
                  disabled={isTransitioning}
                  onClick={() => onRestart(selectedProject.id, activeCommandId)}
                  title={m.terminal.restartTitle(
                    formatShortcut("Ctrl+Shift+R", platform)
                  )}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--dp-fg)] transition-colors duration-150 hover:bg-[var(--dp-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                >
                  <RotateCw
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 ${
                      isTransitioning ? "motion-safe:animate-spin" : ""
                    }`}
                  />
                  {m.common.restart}
                </button>
              </>
            )}

            {/* Multi-command Batch Controls */}
            {isMulti && (
              <>
                {runningCmdCount < projectCommands.length && (
                  <button
                    type="button"
                    onClick={() => onStartAll(selectedProject)}
                    title={m.terminal.startAllTitle}
                    className={`inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] px-2.5 py-1.5 text-xs font-medium text-[var(--dp-accent-text)] transition-colors hover:opacity-90 ${FOCUS_RING}`}
                  >
                    <Play
                      className="h-3 w-3 fill-current"
                      aria-hidden="true"
                    />
                    {m.common.startAll}
                  </button>
                )}
                {runningCmdCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onStopAll(selectedProject.id)}
                    title={m.terminal.stopAllTitle}
                    className={`inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--dp-danger-border)] bg-[var(--dp-danger-soft)] px-2.5 py-1.5 text-xs font-medium text-[var(--dp-danger-text)] transition-colors hover:opacity-90 ${FOCUS_RING}`}
                  >
                    <Square
                      className="h-3 w-3 fill-current"
                      aria-hidden="true"
                    />
                    {m.common.stopAll}
                  </button>
                )}
              </>
            )}

            <div
              className="mx-0.5 h-4 w-px bg-[var(--dp-border)]"
              aria-hidden="true"
            />

            {/* Utility Controls */}
            <button
              type="button"
              onClick={() => onOpenDir(activeCwd)}
              title={m.terminal.openCwdTitle}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] px-2.5 py-1.5 text-xs text-[var(--dp-fg-secondary)] transition-colors duration-150 hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              {m.common.folder}
            </button>

            <button
              type="button"
              onClick={() => onOpenInEditor(activeCwd)}
              aria-label={m.terminal.openInEditorAria}
              title={m.terminal.openInEditorTitle(settings.editorCommand)}
              className={`cursor-pointer rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] p-1.5 text-[var(--dp-fg-secondary)] transition-colors duration-150 hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => onOpenInExternalTerminal(activeCwd, activeShell)}
              aria-label={m.terminal.openExternalTermAria}
              title={m.terminal.openExternalTermTitle}
              className={`cursor-pointer rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] p-1.5 text-[var(--dp-fg-secondary)] transition-colors duration-150 hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              <TerminalIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            {activeUrl && (
              <button
                type="button"
                onClick={() => onOpenUrl(activeUrl)}
                title={
                  liveDetectedUrl && liveDetectedUrl !== configuredUrl
                    ? m.terminal.openDetectedUrlTitle(activeUrl)
                    : m.terminal.openConfiguredUrlTitle(activeUrl)
                }
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] px-2.5 py-1.5 text-xs font-medium text-[var(--dp-info-text)] transition-colors duration-150 hover:opacity-90 ${FOCUS_RING}`}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                {m.common.open}
              </button>
            )}

            <button
              type="button"
              onClick={() => (searchOpen ? closeSearchBar() : openSearchBar())}
              aria-pressed={searchOpen}
              aria-label={m.terminal.searchAria}
              title={m.terminal.searchTitle(formatShortcut("Ctrl+F", platform))}
              className={`cursor-pointer rounded-md border p-1.5 transition-colors duration-150 ${
                searchOpen
                  ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                  : "border-[var(--dp-border)] bg-[var(--dp-surface)] text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)]"
              } ${FOCUS_RING}`}
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={handleExportCurrent}
              aria-label={m.terminal.exportLogAria}
              title={m.terminal.exportLogTitle}
              className={`cursor-pointer rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] p-1.5 text-[var(--dp-fg-secondary)] transition-colors duration-150 hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => {
                clearHandlersRef.current.get(activeSessionKey)?.();
                onClearHistory(activeSessionKey);
              }}
              aria-label={m.terminal.clearScreenAria}
              title={m.terminal.clear}
              className={`cursor-pointer rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] p-1.5 text-[var(--dp-fg-secondary)] transition-colors duration-150 hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onCollapseLog}
              aria-label={m.terminal.collapseLogAria}
              title={m.terminal.collapseLogTitle(
                formatShortcut("Ctrl+J", platform)
              )}
              className={`cursor-pointer rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] p-1.5 text-[var(--dp-fg-secondary)] transition-colors duration-150 hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Multi-command Tab Bar */}
        {isMulti && (
          <div
            role="tablist"
            aria-label={m.terminal.modesTablistAria}
            className="dp-tablist mt-2.5 border-b border-[var(--dp-border)] pb-0.5 select-none"
          >
            {projectCommands.map((cmd, idx) => {
              const key = makeSessionKey(selectedProject.id, cmd.id);
              const cmdStatus = statuses[key] ?? "stopped";
              const isTabActive = activeCommand?.id === cmd.id;
              const isTabTransitioning =
                cmdStatus === "starting" || cmdStatus === "stopping";

              return (
                <button
                  key={cmd.id}
                  ref={(el) => {
                    if (el) {
                      tabRefs.current.set(cmd.id, el);
                    } else {
                      tabRefs.current.delete(cmd.id);
                    }
                  }}
                  type="button"
                  role="tab"
                  aria-selected={isTabActive}
                  tabIndex={isTabActive ? 0 : -1}
                  onClick={() => onSelectCommand(selectedProject.id, cmd.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, idx)}
                  title={`${cmd.name}: ${cmd.command}`}
                  className={`dp-tab inline-flex cursor-pointer items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    isTabActive
                      ? "bg-[var(--dp-surface)] text-[var(--dp-info-text)]"
                      : "text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface)]/50 hover:text-[var(--dp-fg)]"
                  } ${FOCUS_RING}`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${
                      cmdStatus === "running"
                        ? "bg-[var(--dp-accent)]"
                        : isTabTransitioning
                          ? "bg-[var(--dp-warning)] motion-safe:animate-pulse"
                          : "bg-[var(--dp-fg-muted)]"
                    }`}
                  />
                  <span>{cmd.name}</span>
                  {cmd.cwd && (
                    <span className="rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-1 py-px font-mono-dev text-[10px] text-[var(--dp-fg-muted)]">
                      {cmd.cwd}
                    </span>
                  )}
                  {cmdStatus !== "stopped" &&
                    sessionMemoryMap?.[key] &&
                    sessionMemoryMap[key].rssBytes > 0 && (
                      <span className="rounded border border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] px-1 py-px font-mono-dev text-[10px] tabular-nums text-[var(--dp-accent-text)]">
                        {formatBytesCompact(sessionMemoryMap[key].rssBytes)}
                      </span>
                    )}
                </button>
              );
            })}
          </div>
        )}

        {/* Metadata Strip */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <div className="inline-flex max-w-full items-center gap-1.5 rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-2 py-0.5 text-[var(--dp-fg-secondary)]">
            <span className="text-[var(--dp-fg-muted)]">cwd</span>
            <span
              className="truncate font-mono-dev text-[var(--dp-fg)]"
              title={activeCwd}
            >
              {activeCwd}
            </span>
            <button
              type="button"
              onClick={handleCopyCwd}
              aria-label={m.terminal.copyCwdAria}
              title={copiedCwd ? m.common.copied : m.terminal.copyCwdTitle}
              className={`ml-0.5 cursor-pointer rounded p-0.5 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              {copiedCwd ? (
                <Check
                  className="h-3 w-3 text-[var(--dp-accent)]"
                  aria-hidden="true"
                />
              ) : (
                <Copy className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
          </div>

          <div className="inline-flex items-center gap-1.5 rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-2 py-0.5 text-[var(--dp-fg-secondary)]">
            <span className="text-[var(--dp-fg-muted)]">shell</span>
            <span className="font-mono-dev text-[var(--dp-fg)]">
              {activeShell}
            </span>
          </div>

          <div className="inline-flex min-w-0 max-w-xl items-center gap-1.5 rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-2 py-0.5 text-[var(--dp-fg-secondary)]">
            <span className="text-[var(--dp-fg-muted)]">cmd</span>
            <span
              className="truncate font-mono-dev text-[var(--dp-accent-text)]"
              title={activeCmdText}
            >
              {activeCmdText}
            </span>
          </div>

          {status !== "stopped" && (
            <div className="inline-flex flex-wrap items-center gap-1.5 rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-2 py-0.5 text-[var(--dp-fg-secondary)]">
              <span className="text-[var(--dp-fg-muted)]">
                {m.terminal.memLabel}
              </span>
              {activeSessionMemory && activeSessionMemory.rssBytes > 0 ? (
                <span className="inline-flex flex-wrap items-center gap-1.5 font-mono-dev tabular-nums">
                  <span className="font-medium text-[var(--dp-fg)]">
                    {m.terminal.memRss(
                      formatBytes(activeSessionMemory.rssBytes)
                    )}
                  </span>
                  <span className="text-[var(--dp-border-strong)]">·</span>
                  <span>
                    {m.terminal.memPrivate(
                      formatBytes(activeSessionMemory.privateBytes)
                    )}
                  </span>
                  {systemTotalMemoryBytes > 0 && (
                    <>
                      <span className="text-[var(--dp-border-strong)]">·</span>
                      <span>
                        {formatMemoryShare(
                          activeSessionMemory.rssBytes,
                          systemTotalMemoryBytes
                        )}
                      </span>
                    </>
                  )}
                  <span className="text-[var(--dp-border-strong)]">·</span>
                  <span>
                    {m.terminal.memPeak(formatBytes(activeSessionPeak))}
                  </span>
                  <span className="text-[var(--dp-border-strong)]">·</span>
                  <span className="text-[var(--dp-fg-muted)]">
                    {m.terminal.memProcs(activeSessionMemory.processCount)}
                  </span>
                </span>
              ) : (
                <span className="font-mono-dev text-[var(--dp-fg-muted)]">
                  {m.terminal.memMeasuring}
                </span>
              )}
              {isMulti &&
                activeSessionMemory &&
                projectTotalMemoryBytes > activeSessionMemory.rssBytes && (
                  <>
                    <span className="text-[var(--dp-border-strong)]">|</span>
                    <span className="font-mono-dev text-[var(--dp-info-text)] tabular-nums">
                      {m.terminal.memProjectTotal(
                        formatBytesCompact(projectTotalMemoryBytes)
                      )}
                    </span>
                  </>
                )}
            </div>
          )}
        </div>

        {/* Inline Expandable Session Process Tree Memory Breakdown */}
        {memDetailsOpen && status !== "stopped" && activeSessionMemory && (
          <div
            id={memDetailsId}
            className="mt-2 rounded-lg border border-[var(--dp-border)] bg-[var(--dp-bg)]/90 px-3 py-2 text-[11px]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[var(--dp-fg)]">
                  {m.terminal.memDetailsTitle}
                </span>
                {activeSessionMemory.rootPid && (
                  <span className="rounded border border-[var(--dp-border)] bg-[var(--dp-surface)] px-1.5 py-px font-mono-dev text-[10px] text-[var(--dp-fg-muted)]">
                    PID {activeSessionMemory.rootPid}
                  </span>
                )}
              </div>
              {onOpenMemoryMonitor && (
                <button
                  type="button"
                  onClick={onOpenMemoryMonitor}
                  className={`cursor-pointer rounded border border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--dp-info-text)] transition-opacity hover:opacity-90 ${FOCUS_RING}`}
                >
                  {m.terminal.memOpenMonitor}
                </button>
              )}
            </div>
            <div className="max-h-36 divide-y divide-[var(--dp-border-subtle)] overflow-y-auto">
              {activeSessionMemory.processes.map((proc) => {
                const barPct =
                  activeSessionMemory.rssBytes > 0
                    ? Math.max(
                        2,
                        Math.min(
                          100,
                          (proc.rssBytes / activeSessionMemory.rssBytes) * 100
                        )
                      )
                    : 0;
                return (
                  <div
                    key={proc.pid}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto_56px] items-center gap-3 py-1 font-mono-dev tabular-nums"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-[10px] text-[var(--dp-fg-muted)]">
                        #{proc.pid}
                      </span>
                      <span className="truncate text-[var(--dp-fg-secondary)]">
                        {proc.name}
                      </span>
                    </div>
                    <span className="text-[var(--dp-fg)]">
                      {formatBytes(proc.rssBytes)}
                    </span>
                    <span className="hidden text-[10px] text-[var(--dp-fg-muted)] sm:inline">
                      {m.terminal.memPrivate(formatBytes(proc.privateBytes))}
                    </span>
                    <div
                      aria-hidden="true"
                      className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--dp-surface)]"
                    >
                      <div
                        style={{ width: `${barPct}%` }}
                        className="h-full rounded-full bg-[var(--dp-accent)]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Persistent Terminal Container */}
      <div
        style={
          {
            "--dp-pty-bg": ptyBg,
            "--dp-pty-fg": ptyFg,
            backgroundColor: ptyBg,
          } as CSSProperties
        }
        className="relative flex-1 overflow-hidden p-3"
      >
        {/* Floating Terminal Search Bar */}
        {searchOpen && (
          <div
            style={{ boxShadow: "var(--dp-shadow)" }}
            className="absolute top-3 right-5 z-30 flex items-center gap-1 rounded-lg border border-[var(--dp-border-strong)] bg-[var(--dp-modal)] px-2 py-1.5 text-xs text-[var(--dp-fg)]"
          >
            <Search
              className="h-3.5 w-3.5 shrink-0 text-[var(--dp-fg-muted)]"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeSearchBar();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  runSearchStep(e.shiftKey ? "prev" : "next");
                }
              }}
              placeholder={m.terminal.findPlaceholder}
              aria-label={m.terminal.findInputAria}
              className="w-40 bg-transparent px-1 text-xs text-[var(--dp-fg)] placeholder-[var(--dp-fg-muted)] focus:outline-none"
            />

            {searchQuery && searchMatchInfo && (
              <span className="min-w-9 text-center font-mono-dev text-[10px] tabular-nums text-[var(--dp-fg-muted)]">
                {searchMatchInfo.count > 0
                  ? `${searchMatchInfo.index + 1}/${searchMatchInfo.count}`
                  : "0/0"}
              </span>
            )}

            <button
              type="button"
              aria-pressed={searchCaseSensitive}
              onClick={() => setSearchCaseSensitive((v) => !v)}
              title={m.terminal.matchCase}
              aria-label={m.terminal.matchCase}
              className={`cursor-pointer rounded p-1 transition-colors ${
                searchCaseSensitive
                  ? "bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                  : "text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)]"
              } ${FOCUS_RING}`}
            >
              <CaseSensitive className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              aria-pressed={searchRegex}
              onClick={() => setSearchRegex((v) => !v)}
              title={m.terminal.useRegex}
              aria-label={m.terminal.useRegex}
              className={`cursor-pointer rounded p-1 transition-colors ${
                searchRegex
                  ? "bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                  : "text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)]"
              } ${FOCUS_RING}`}
            >
              <Regex className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              disabled={!searchQuery}
              onClick={() => runSearchStep("prev")}
              title={m.terminal.prevMatchTitle}
              aria-label={m.terminal.prevMatchAria}
              className={`cursor-pointer rounded p-1 text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] disabled:opacity-40 ${FOCUS_RING}`}
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              disabled={!searchQuery}
              onClick={() => runSearchStep("next")}
              title={m.terminal.nextMatchTitle}
              aria-label={m.terminal.nextMatchAria}
              className={`cursor-pointer rounded p-1 text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] disabled:opacity-40 ${FOCUS_RING}`}
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={closeSearchBar}
              title={m.terminal.closeFindTitle}
              aria-label={m.terminal.closeFindAria}
              className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {mountedIds.map((sessionKey) => (
          <ProjectTerminalPane
            key={sessionKey}
            sessionKey={sessionKey}
            isActive={sessionKey === activeSessionKey && isVisible}
            terminalTheme={terminalTheme}
            fontSize={settings.terminalFontSize}
            lineHeight={settings.terminalLineHeight}
            cursorStyle={settings.terminalCursorStyle}
            cursorBlink={settings.terminalCursorBlink}
            scrollback={settings.terminalScrollback}
            subscribeOutput={subscribeOutput}
            fetchHistory={fetchHistory}
            reportTerminalSize={reportTerminalSize}
            onSizeMeasured={handleSizeMeasured}
            registerClearHandler={registerClearHandler}
            registerSearchAddon={registerSearchAddon}
            registerExportHandler={registerExportHandler}
            registerFocusHandler={registerFocusHandler}
            onOpenSearch={openSearchBar}
            onOpenUrl={onOpenUrl}
            onClearSession={onClearHistory}
            onExportCurrent={handleExportCurrent}
            onNotify={onNotify}
          />
        ))}
      </div>

      {/* Bottom Terminal Status Bar */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[var(--dp-border)] bg-[var(--dp-sidebar)] px-3.5 text-[11px] text-[var(--dp-fg-muted)] select-none">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              status === "running"
                ? "bg-[var(--dp-accent)]"
                : status === "starting" || status === "stopping"
                  ? "bg-[var(--dp-warning)]"
                  : "bg-[var(--dp-fg-muted)]"
            }`}
          />
          <span>
            {status === "running"
              ? m.terminal.footerRunning(
                  formatShortcut("Ctrl+F", platform),
                  formatClickShortcut(platform, locale)
                )
              : status === "stopping"
                ? m.terminal.footerStopping
                : status === "starting"
                  ? m.terminal.footerStarting
                  : m.terminal.footerStopped}
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono-dev text-[10px] tabular-nums text-[var(--dp-fg-secondary)]">
          {status !== "stopped" &&
            activeSessionMemory &&
            activeSessionMemory.rssBytes > 0 && (
              <>
                <button
                  type="button"
                  onClick={onOpenMemoryMonitor}
                  title={m.terminal.memoryBadgeTitle(
                    formatBytes(activeSessionMemory.rssBytes),
                    formatBytes(activeSessionMemory.privateBytes),
                    activeSessionMemory.processCount
                  )}
                  className={`inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[var(--dp-fg-secondary)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                >
                  <MemoryStick
                    className="h-3 w-3 text-[var(--dp-accent)]"
                    aria-hidden="true"
                  />
                  <span>
                    RAM {formatBytesCompact(activeSessionMemory.rssBytes)}
                    {systemTotalMemoryBytes > 0
                      ? ` (${formatMemoryShare(activeSessionMemory.rssBytes, systemTotalMemoryBytes)})`
                      : activeSessionMemory.processCount > 1
                        ? ` (${activeSessionMemory.processCount})`
                        : ""}
                  </span>
                </button>
                <span className="text-[var(--dp-border-strong)]">|</span>
              </>
            )}
          {activeSize && (
            <span>
              {activeSize.cols} × {activeSize.rows}
            </span>
          )}
          <span className="text-[var(--dp-border-strong)]">|</span>
          <span>{activeShell}</span>
          <span className="text-[var(--dp-border-strong)]">|</span>
          <span>UTF-8</span>
        </div>
      </footer>
    </main>
  );
}
