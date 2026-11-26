import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { BindingModal } from "./components/BindingModal";
import { GroupManagerModal } from "./components/GroupManagerModal";
import {
  MemoryMonitorModal,
  type MemoryMonitorTab,
} from "./components/MemoryMonitorModal";
import { MiniView } from "./components/MiniView";
import { ProjectModal } from "./components/ProjectModal";
import { SettingsModal, type SettingsTab } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { TerminalView } from "./components/TerminalView";
import { TitleBar } from "./components/TitleBar";
import { useDevPanel } from "./hooks/useDevPanel";
import { useMemoryMonitor } from "./hooks/useMemoryMonitor";
import { useSettings } from "./hooks/useSettings";
import { useTheme } from "./hooks/useTheme";
import {
  I18nContext,
  useI18nController,
  type LanguagePreference,
} from "./i18n";
import { DEFAULT_DARK_TERMINAL_THEME } from "./themes/themes";
import type { LaunchBinding, ProjectConfig } from "./types/project";
import {
  clampMiniBounds,
  DEFAULT_MINI_BOUNDS,
  MINI_MIN_HEIGHT,
  MINI_MIN_WIDTH,
  type MiniBounds,
  type NormalWindowSnapshot,
} from "./utils/miniMode";
import {
  getActiveCommandId,
  getProjectAggregateStatus,
} from "./utils/projectCommands";
import { installWebviewGuard } from "./utils/webviewGuard";
import "./App.css";

const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 320;
const SIDEBAR_WIDTH_KEY = "devpanel-sidebar-width";
const MINI_BOUNDS_KEY = "devpanel-mini-bounds";
const MINI_PIN_PREF_KEY = "devpanel-mini-always-on-top";

function clampWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function readStoredSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return DEFAULT_SIDEBAR_WIDTH;
    const num = Number(raw);
    return Number.isFinite(num) ? clampWidth(num) : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function readStoredMiniBounds(): MiniBounds {
  try {
    const raw = window.localStorage.getItem(MINI_BOUNDS_KEY);
    if (!raw) return DEFAULT_MINI_BOUNDS;
    return clampMiniBounds(JSON.parse(raw) as Partial<MiniBounds>);
  } catch {
    return DEFAULT_MINI_BOUNDS;
  }
}

function readStoredMiniPinPref(): boolean {
  try {
    return window.localStorage.getItem(MINI_PIN_PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

function App() {
  const { preference, setPreference, activeTheme, systemDark } = useTheme();
  const { settings, platform, updateSettings, resetSettings } = useSettings();
  const handleLanguageChange = useCallback(
    (language: LanguagePreference) => updateSettings({ language }),
    [updateSettings]
  );
  const i18n = useI18nController(settings.language, handleLanguageChange);

  const {
    projects,
    groups,
    bindings,
    configPath,
    configError,
    statuses,
    exitCodes,
    detectedUrls,
    selectedId,
    selectedCommandByProject,
    selectProject,
    toasts,
    pushToast,
    dismissToast,
    subscribeOutput,
    reportTerminalSize,
    startProject,
    stopProject,
    restartProject,
    stopAllProjects,
    startAllCommands,
    stopAllCommands,
    startBinding,
    stopBinding,
    startGroupProjects,
    stopGroupProjects,
    saveProject,
    deleteProject,
    createGroup,
    renameGroup,
    deleteGroup,
    saveBinding,
    deleteBinding,
    reorderProjects,
    reorderGroups,
    reorderBindings,
    exportConfigFile,
    importConfigFile,
    exportLogFile,
    openDirectory,
    openInEditor,
    openInExternalTerminal,
    openUrl,
    openConfigFolder,
    fetchHistory,
    clearHistory,
  } = useDevPanel({
    defaultShell: settings.defaultShell,
    notifyOnCrash: settings.notifyOnCrash,
    messages: i18n.m,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const [bindingModalOpen, setBindingModalOpen] = useState(false);
  const [editingBinding, setEditingBinding] = useState<LaunchBinding | null>(
    null
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");
  const [memoryMonitorOpen, setMemoryMonitorOpen] = useState(false);
  const [memoryMonitorTab, setMemoryMonitorTab] =
    useState<MemoryMonitorTab>("managed");
  const [isMaximized, setIsMaximized] = useState(false);
  const [logCollapsed, setLogCollapsed] = useState(false);
  const [miniMode, setMiniMode] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [miniAlwaysOnTopPref, setMiniAlwaysOnTopPref] = useState(
    readStoredMiniPinPref
  );
  const [editingProject, setEditingProject] = useState<ProjectConfig | null>(
    null
  );
  const [cloningProject, setCloningProject] = useState<ProjectConfig | null>(
    null
  );
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const [terminalSearchTrigger, setTerminalSearchTrigger] = useState(0);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
  const expandedWidthRef = useRef<number>(1200);
  const logCollapsedRef = useRef(logCollapsed);
  logCollapsedRef.current = logCollapsed;
  const isMaximizedRef = useRef(isMaximized);
  isMaximizedRef.current = isMaximized;
  const miniModeRef = useRef(miniMode);
  miniModeRef.current = miniMode;
  const alwaysOnTopRef = useRef(alwaysOnTop);
  alwaysOnTopRef.current = alwaysOnTop;
  const miniAlwaysOnTopPrefRef = useRef(miniAlwaysOnTopPref);
  miniAlwaysOnTopPrefRef.current = miniAlwaysOnTopPref;
  const miniBoundsRef = useRef<MiniBounds>(readStoredMiniBounds());
  const normalWindowRef = useRef<NormalWindowSnapshot | null>(null);

  useEffect(() => installWebviewGuard(), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // Ignore storage errors
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        MINI_PIN_PREF_KEY,
        String(miniAlwaysOnTopPref)
      );
    } catch {
      // Ignore storage errors
    }
  }, [miniAlwaysOnTopPref]);

  useEffect(() => {
    let mounted = true;
    let unlistenResize: (() => void) | null = null;
    let unlistenMove: (() => void) | null = null;
    try {
      const win = getCurrentWindow();
      const saveWindowMetrics = async () => {
        try {
          const [innerSize, outerPos, scaleFactor, maximized] =
            await Promise.all([
              win.innerSize(),
              win.outerPosition(),
              win.scaleFactor(),
              win.isMaximized(),
            ]);
          if (!mounted || maximized) return;
          const logicalW = Math.round(innerSize.width / scaleFactor);
          const logicalH = Math.round(innerSize.height / scaleFactor);
          const logicalX = Math.round(outerPos.x / scaleFactor);
          const logicalY = Math.round(outerPos.y / scaleFactor);

          if (miniModeRef.current) {
            const clamped = clampMiniBounds({
              width: logicalW,
              height: logicalH,
              x: logicalX,
              y: logicalY,
            });
            miniBoundsRef.current = clamped;
            try {
              window.localStorage.setItem(
                MINI_BOUNDS_KEY,
                JSON.stringify(clamped)
              );
            } catch {
              // Ignore storage errors
            }
            return;
          }

          if (!logCollapsedRef.current && logicalW >= 900) {
            expandedWidthRef.current = logicalW;
          }
        } catch {
          // Ignore
        }
      };

      void saveWindowMetrics();
      win
        .onResized(() => {
          void saveWindowMetrics();
        })
        .then((fn) => {
          if (mounted) unlistenResize = fn;
          else fn();
        })
        .catch(() => {});
      win
        .onMoved(() => {
          void saveWindowMetrics();
        })
        .then((fn) => {
          if (mounted) unlistenMove = fn;
          else fn();
        })
        .catch(() => {});
    } catch {
      // Ignore outside Tauri runtime
    }
    return () => {
      mounted = false;
      unlistenResize?.();
      unlistenMove?.();
    };
  }, []);

  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const setWindowAlwaysOnTop = useCallback(async (next: boolean) => {
    setAlwaysOnTop(next);
    alwaysOnTopRef.current = next;
    if (miniModeRef.current) {
      setMiniAlwaysOnTopPref(next);
      miniAlwaysOnTopPrefRef.current = next;
    }
    try {
      await getCurrentWindow().setAlwaysOnTop(next);
    } catch {
      // Ignore outside Tauri runtime
    }
  }, []);

  const enterMiniMode = useCallback(async () => {
    if (miniModeRef.current) return;

    setModalOpen(false);
    setGroupManagerOpen(false);
    setBindingModalOpen(false);
    setSettingsOpen(false);
    setMemoryMonitorOpen(false);

    try {
      const win = getCurrentWindow();
      const [innerSize, outerPos, scaleFactor, maximized, currentTop] =
        await Promise.all([
          win.innerSize(),
          win.outerPosition(),
          win.scaleFactor(),
          win.isMaximized(),
          win.isAlwaysOnTop().catch(() => alwaysOnTopRef.current),
        ]);

      normalWindowRef.current = {
        width: Math.max(360, Math.round(innerSize.width / scaleFactor)),
        height: Math.max(520, Math.round(innerSize.height / scaleFactor)),
        x: Math.round(outerPos.x / scaleFactor),
        y: Math.round(outerPos.y / scaleFactor),
        maximized,
        logCollapsed: logCollapsedRef.current,
        alwaysOnTop: currentTop,
      };

      setMiniMode(true);
      miniModeRef.current = true;

      if (maximized) {
        await win.unmaximize();
      }
      await win.setMinSize(new LogicalSize(MINI_MIN_WIDTH, MINI_MIN_HEIGHT));
      const bounds = miniBoundsRef.current;
      await win.setSize(new LogicalSize(bounds.width, bounds.height));
      if (bounds.x !== undefined && bounds.y !== undefined) {
        await win
          .setPosition(new LogicalPosition(bounds.x, bounds.y))
          .catch(() => {});
      }

      const pin = miniAlwaysOnTopPrefRef.current;
      setAlwaysOnTop(pin);
      alwaysOnTopRef.current = pin;
      await win.setAlwaysOnTop(pin).catch(() => {});
    } catch {
      setMiniMode(true);
      miniModeRef.current = true;
    }
  }, []);

  const exitMiniMode = useCallback(
    async (options?: { expandLog?: boolean }) => {
      if (!miniModeRef.current) return;

      const snap = normalWindowRef.current;
      const nextCollapsed = options?.expandLog
        ? false
        : (snap?.logCollapsed ?? logCollapsedRef.current);

      try {
        const win = getCurrentWindow();
        const [innerSize, outerPos, scaleFactor] = await Promise.all([
          win.innerSize(),
          win.outerPosition(),
          win.scaleFactor(),
        ]);
        const savedMini = clampMiniBounds({
          width: innerSize.width / scaleFactor,
          height: innerSize.height / scaleFactor,
          x: outerPos.x / scaleFactor,
          y: outerPos.y / scaleFactor,
        });
        miniBoundsRef.current = savedMini;
        try {
          window.localStorage.setItem(
            MINI_BOUNDS_KEY,
            JSON.stringify(savedMini)
          );
        } catch {
          // Ignore storage errors
        }

        setLogCollapsed(nextCollapsed);
        logCollapsedRef.current = nextCollapsed;
        setMiniMode(false);
        miniModeRef.current = false;

        const restorePin = snap?.alwaysOnTop ?? false;
        setAlwaysOnTop(restorePin);
        alwaysOnTopRef.current = restorePin;
        await win.setAlwaysOnTop(restorePin).catch(() => {});

        const minW = nextCollapsed ? 360 : 900;
        const minH = nextCollapsed ? 520 : 560;
        const targetW = options?.expandLog
          ? Math.max(900, expandedWidthRef.current, snap?.width ?? 1200)
          : Math.max(minW, snap?.width ?? 1200);
        const targetH = Math.max(minH, snap?.height ?? 760);

        await win.setMinSize(new LogicalSize(minW, minH));
        await win.setSize(new LogicalSize(targetW, targetH));
        if (snap?.x !== undefined && snap?.y !== undefined) {
          await win
            .setPosition(new LogicalPosition(snap.x, snap.y))
            .catch(() => {});
        }
        if (snap?.maximized) {
          await win.maximize().catch(() => {});
        }
      } catch {
        setLogCollapsed(nextCollapsed);
        logCollapsedRef.current = nextCollapsed;
        setMiniMode(false);
        miniModeRef.current = false;
      }
    },
    []
  );

  const toggleLogPanel = useCallback(async () => {
    if (miniModeRef.current) {
      await exitMiniMode({ expandLog: true });
      return;
    }

    const nextCollapsed = !logCollapsed;
    setLogCollapsed(nextCollapsed);

    try {
      const win = getCurrentWindow();
      const maximized = await win.isMaximized();
      if (maximized) return;

      const [innerSize, scaleFactor] = await Promise.all([
        win.innerSize(),
        win.scaleFactor(),
      ]);
      const logicalW = Math.round(innerSize.width / scaleFactor);
      const logicalH = Math.round(innerSize.height / scaleFactor);

      if (nextCollapsed) {
        expandedWidthRef.current = Math.max(900, logicalW);
        await win.setMinSize(new LogicalSize(360, 520));
        const compactWidth = Math.max(380, Math.min(460, sidebarWidth + 16));
        await win.setSize(new LogicalSize(compactWidth, logicalH));
      } else {
        const targetWidth = Math.max(900, expandedWidthRef.current);
        await win.setSize(new LogicalSize(targetWidth, logicalH));
        await win.setMinSize(new LogicalSize(900, 560));
      }
    } catch {
      // Ignore outside Tauri runtime or if window resize is unavailable
    }
  }, [logCollapsed, sidebarWidth, exitMiniMode]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId]
  );

  const selectedCommandId = useMemo(
    () => getActiveCommandId(selectedProject, selectedCommandByProject),
    [selectedProject, selectedCommandByProject]
  );

  const activeSessionSignature = useMemo(
    () =>
      Object.entries(statuses)
        .filter(([, s]) => s === "running" || s === "starting")
        .map(([key]) => key)
        .sort()
        .join("|"),
    [statuses]
  );

  const memoryMonitor = useMemoryMonitor({
    isModalOpen: memoryMonitorOpen,
    includeTopProcesses:
      memoryMonitorOpen && memoryMonitorTab === "processes",
    activeSessionSignature,
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      if (modalOpen || settingsOpen || groupManagerOpen || bindingModalOpen) {
        return;
      }

      const key = event.key.toLowerCase();
      if (event.shiftKey && key === "m") {
        event.preventDefault();
        if (miniModeRef.current) {
          void exitMiniMode();
        } else {
          void enterMiniMode();
        }
        return;
      }

      if (event.shiftKey && key === "t") {
        event.preventDefault();
        void setWindowAlwaysOnTop(!alwaysOnTopRef.current);
        return;
      }

      if (!event.shiftKey && key === "m") {
        event.preventDefault();
        if (miniModeRef.current) {
          void exitMiniMode().then(() => setMemoryMonitorOpen(true));
        } else {
          setMemoryMonitorOpen((open) => !open);
        }
        return;
      }

      if (memoryMonitorOpen) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isXtermTextarea = Boolean(
        target?.classList.contains("xterm-helper-textarea")
      );
      const isFormControl = Boolean(
        target &&
          !isXtermTextarea &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
      );

      const keyLower = key;

      if (event.shiftKey && keyLower === "r") {
        if (isFormControl || !selectedProject || miniModeRef.current) return;
        event.preventDefault();
        void restartProject(selectedProject.id, selectedCommandId);
        return;
      }

      if (event.shiftKey) return;

      if (keyLower === "j") {
        if (isFormControl) return;
        event.preventDefault();
        void toggleLogPanel();
      } else if (keyLower === ",") {
        if (isFormControl) return;
        event.preventDefault();
        if (miniModeRef.current) {
          void exitMiniMode().then(() => openSettings("general"));
        } else {
          openSettings("general");
        }
      } else if (keyLower === "k") {
        if (miniModeRef.current) return;
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (keyLower === "n") {
        if (isFormControl) return;
        event.preventDefault();
        const openNewProject = () => {
          setEditingProject(null);
          setCloningProject(null);
          setModalOpen(true);
        };
        if (miniModeRef.current) {
          void exitMiniMode().then(openNewProject);
        } else {
          openNewProject();
        }
      } else if (keyLower === "f") {
        if (
          isFormControl ||
          logCollapsed ||
          miniModeRef.current ||
          !selectedProject
        ) {
          return;
        }
        event.preventDefault();
        setTerminalSearchTrigger((n) => n + 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    modalOpen,
    settingsOpen,
    groupManagerOpen,
    bindingModalOpen,
    memoryMonitorOpen,
    logCollapsed,
    selectedProject,
    selectedCommandId,
    toggleLogPanel,
    openSettings,
    restartProject,
    enterMiniMode,
    exitMiniMode,
    setWindowAlwaysOnTop,
  ]);

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      setSidebarWidth(clampWidth(start.width + (event.clientX - start.x)));
    };

    const handleMouseUp = () => {
      dragStartRef.current = null;
      setResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizing]);

  const runningProjectCount = useMemo(
    () =>
      projects.filter((p) => {
        const s = getProjectAggregateStatus(p, statuses);
        return s === "running" || s === "starting";
      }).length,
    [projects, statuses]
  );

  const effectiveTerminalTheme = useMemo(() => {
    if (
      settings.keepTerminalDarkInLightMode &&
      activeTheme.scheme === "light"
    ) {
      return DEFAULT_DARK_TERMINAL_THEME;
    }
    return activeTheme.terminal;
  }, [settings.keepTerminalDarkInLightMode, activeTheme]);

  const existingIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const existingBindingIds = useMemo(
    () => bindings.map((b) => b.id),
    [bindings]
  );

  return (
    <I18nContext.Provider value={i18n}>
    <div
      className={`flex h-screen w-screen flex-col overflow-hidden bg-[var(--dp-bg)] text-[var(--dp-fg)] ${
        !isMaximized && !miniMode ? "border border-[var(--dp-border)]" : ""
      }`}
    >
      {miniMode && (
        <MiniView
          projects={projects}
          bindings={bindings}
          statuses={statuses}
          detectedUrls={detectedUrls}
          sessionMemoryMap={memoryMonitor.sessionMemoryMap}
          memorySnapshot={memoryMonitor.snapshot}
          runningCount={runningProjectCount}
          totalCount={projects.length}
          alwaysOnTop={alwaysOnTop}
          closeToTray={settings.closeToTray}
          platform={platform}
          onToggleAlwaysOnTop={() => void setWindowAlwaysOnTop(!alwaysOnTop)}
          onExitMini={() => void exitMiniMode()}
          onOpenSessionTerminal={(projectId, commandId) => {
            selectProject(projectId, commandId);
            void exitMiniMode({ expandLog: true });
          }}
          onOpenMemoryMonitor={() => {
            void exitMiniMode().then(() => setMemoryMonitorOpen(true));
          }}
          onStart={(projectId, commandId) =>
            void startProject(projectId, commandId)
          }
          onStop={(projectId, commandId) =>
            void stopProject(projectId, commandId)
          }
          onRestart={(projectId, commandId) =>
            void restartProject(projectId, commandId)
          }
          onStopAllProjects={stopAllProjects}
          onStartBinding={(binding) => void startBinding(binding)}
          onStopBinding={(binding) => void stopBinding(binding)}
          onOpenUrl={openUrl}
        />
      )}

      <div
        className={
          miniMode
            ? "hidden"
            : "flex min-h-0 flex-1 flex-col overflow-hidden"
        }
      >
      <TitleBar
        runningCount={runningProjectCount}
        totalCount={projects.length}
        preference={preference}
        activeTheme={activeTheme}
        platform={platform}
        closeToTray={settings.closeToTray}
        logCollapsed={logCollapsed}
        alwaysOnTop={alwaysOnTop}
        memorySnapshot={memoryMonitor.snapshot}
        onToggleLogPanel={toggleLogPanel}
        onToggleAlwaysOnTop={() => void setWindowAlwaysOnTop(!alwaysOnTop)}
        onEnterMiniMode={() => void enterMiniMode()}
        onStopAllProjects={stopAllProjects}
        onOpenSettings={openSettings}
        onOpenMemoryMonitor={() => setMemoryMonitorOpen(true)}
        onMaximizedChange={setIsMaximized}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          width={sidebarWidth}
          fullWidth={logCollapsed}
          searchInputRef={searchInputRef}
          projects={projects}
          groups={groups}
          bindings={bindings}
          statuses={statuses}
          detectedUrls={detectedUrls}
          sessionMemoryMap={memoryMonitor.sessionMemoryMap}
          selectedId={selectedId}
          selectedCommandId={selectedCommandId}
          configPath={configPath}
          configError={configError}
          onSelect={selectProject}
          onStart={startProject}
          onStop={stopProject}
          onRestart={restartProject}
          onStartAll={startAllCommands}
          onStopAll={stopAllCommands}
          onStartBinding={startBinding}
          onStopBinding={stopBinding}
          onStartGroup={startGroupProjects}
          onStopGroup={stopGroupProjects}
          onOpenDir={openDirectory}
          onOpenUrl={openUrl}
          onOpenConfigFolder={openConfigFolder}
          onOpenGroupManager={() => setGroupManagerOpen(true)}
          onAddBinding={() => {
            setEditingBinding(null);
            setBindingModalOpen(true);
          }}
          onEditBinding={(binding) => {
            setEditingBinding(binding);
            setBindingModalOpen(true);
          }}
          onDeleteBinding={deleteBinding}
          onReorderBindings={reorderBindings}
          onAdd={() => {
            setEditingProject(null);
            setCloningProject(null);
            setModalOpen(true);
          }}
          onEdit={(project) => {
            setEditingProject(project);
            setCloningProject(null);
            setModalOpen(true);
          }}
          onDuplicate={(project) => {
            setEditingProject(null);
            setCloningProject(project);
            setModalOpen(true);
          }}
          onDelete={deleteProject}
          onReorderProjects={reorderProjects}
        />

        {/* Resizable Splitter Handle */}
        {!logCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={i18n.m.app.resizeSidebarAria}
            aria-valuenow={sidebarWidth}
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            tabIndex={0}
            onMouseDown={(e) => {
              dragStartRef.current = { x: e.clientX, width: sidebarWidth };
              setResizing(true);
            }}
            onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                setSidebarWidth((w) => clampWidth(w - 16));
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                setSidebarWidth((w) => clampWidth(w + 16));
              }
            }}
            title={i18n.m.app.resizeSidebarTitle}
            className={`w-1 shrink-0 cursor-col-resize select-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-ring)] ${
              resizing
                ? "bg-[var(--dp-info)]"
                : "bg-transparent hover:bg-[var(--dp-info)]/60"
            }`}
          />
        )}

        <div
          className={
            logCollapsed
              ? "hidden"
              : "flex min-w-0 flex-1 overflow-hidden"
          }
        >
          <TerminalView
            projects={projects}
            selectedProject={selectedProject}
            selectedCommandId={selectedCommandId}
            statuses={statuses}
            exitCodes={exitCodes}
            detectedUrls={detectedUrls}
            sessionMemoryMap={memoryMonitor.sessionMemoryMap}
            sessionHistoryMap={memoryMonitor.sessionHistory}
            sessionPeakMap={memoryMonitor.sessionPeaks}
            systemTotalMemoryBytes={
              memoryMonitor.snapshot?.system.totalBytes ?? 0
            }
            terminalTheme={effectiveTerminalTheme}
            settings={settings}
            platform={platform}
            isVisible={!logCollapsed && !miniMode}
            searchTrigger={terminalSearchTrigger}
            onCollapseLog={toggleLogPanel}
            onOpenMemoryMonitor={() => setMemoryMonitorOpen(true)}
            subscribeOutput={subscribeOutput}
            fetchHistory={fetchHistory}
            reportTerminalSize={reportTerminalSize}
            onSelectCommand={selectProject}
            onStart={startProject}
            onStop={stopProject}
            onRestart={restartProject}
            onStartAll={startAllCommands}
            onStopAll={stopAllCommands}
            onOpenDir={openDirectory}
            onOpenInEditor={(path) =>
              void openInEditor(path, settings.editorCommand)
            }
            onOpenInExternalTerminal={(path, shell) =>
              void openInExternalTerminal(path, shell)
            }
            onOpenUrl={openUrl}
            onExportLog={(name, content) => void exportLogFile(name, content)}
            onClearHistory={clearHistory}
            onNotify={pushToast}
          />
        </div>
      </div>
      </div>

      <ProjectModal
        isOpen={modalOpen}
        editingProject={editingProject}
        cloningProject={cloningProject}
        existingIds={existingIds}
        groups={groups}
        defaultShell={settings.defaultShell}
        platform={platform}
        onClose={() => {
          setModalOpen(false);
          setCloningProject(null);
        }}
        onSave={saveProject}
      />

      <GroupManagerModal
        isOpen={groupManagerOpen}
        groups={groups}
        projects={projects}
        onClose={() => setGroupManagerOpen(false)}
        onCreateGroup={createGroup}
        onRenameGroup={renameGroup}
        onDeleteGroup={deleteGroup}
        onReorderGroups={reorderGroups}
      />

      <BindingModal
        isOpen={bindingModalOpen}
        editingBinding={editingBinding}
        existingBindingIds={existingBindingIds}
        projects={projects}
        groups={groups}
        onClose={() => setBindingModalOpen(false)}
        onSave={saveBinding}
      />

      <SettingsModal
        isOpen={settingsOpen}
        activeTab={settingsTab}
        onTabChange={setSettingsTab}
        onClose={() => setSettingsOpen(false)}
        preference={preference}
        activeTheme={activeTheme}
        effectiveTerminalTheme={effectiveTerminalTheme}
        systemDark={systemDark}
        platform={platform}
        onChangeTheme={setPreference}
        settings={settings}
        onUpdateSettings={updateSettings}
        onResetSettings={resetSettings}
        configPath={configPath}
        configError={configError}
        onOpenConfigFolder={openConfigFolder}
        onExportConfig={exportConfigFile}
        onImportConfig={importConfigFile}
        onOpenUrl={openUrl}
      />

      <MemoryMonitorModal
        isOpen={memoryMonitorOpen}
        activeTab={memoryMonitorTab}
        onTabChange={setMemoryMonitorTab}
        onClose={() => setMemoryMonitorOpen(false)}
        snapshot={memoryMonitor.snapshot}
        history={memoryMonitor.history}
        projects={projects}
        paused={memoryMonitor.paused}
        onTogglePaused={() => memoryMonitor.setPaused((p) => !p)}
        intervalMs={memoryMonitor.intervalMs}
        onChangeInterval={memoryMonitor.setIntervalMs}
        loading={memoryMonitor.loading}
        error={memoryMonitor.error}
        onRefresh={memoryMonitor.refreshNow}
        onClearHistory={memoryMonitor.clearHistory}
        onSelectSession={(projectId, commandId) => {
          selectProject(projectId, commandId);
          if (logCollapsed) {
            void toggleLogPanel();
          }
        }}
        onRestartSession={(projectId, commandId) =>
          void restartProject(projectId, commandId)
        }
        onStopSession={(projectId, commandId) =>
          void stopProject(projectId, commandId)
        }
      />

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed right-4 bottom-10 z-50 flex max-w-sm flex-col gap-2"
        >
          {toasts.map((toast) => {
            const borderAccent =
              toast.type === "error"
                ? "border-l-[var(--dp-danger)]"
                : toast.type === "success"
                  ? "border-l-[var(--dp-accent)]"
                  : "border-l-[var(--dp-info)]";
            const Icon =
              toast.type === "error"
                ? AlertCircle
                : toast.type === "success"
                  ? CheckCircle2
                  : Info;
            const iconColor =
              toast.type === "error"
                ? "text-[var(--dp-danger)]"
                : toast.type === "success"
                  ? "text-[var(--dp-accent)]"
                  : "text-[var(--dp-info)]";

            return (
              <div
                key={toast.id}
                style={{ boxShadow: "var(--dp-shadow)" }}
                className={`flex items-start gap-2.5 rounded-lg border border-[var(--dp-border-strong)] border-l-4 bg-[var(--dp-modal)] px-3.5 py-2.5 text-xs text-[var(--dp-fg)] ${borderAccent}`}
              >
                <Icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`}
                  aria-hidden="true"
                />
                <span className="flex-1 break-words">{toast.message}</span>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  aria-label={i18n.m.common.closeNotification}
                  className="shrink-0 cursor-pointer rounded p-0.5 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-ring)]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </I18nContext.Provider>
  );
}

export default App;
