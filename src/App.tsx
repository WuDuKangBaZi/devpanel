import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { BindingModal } from "./components/BindingModal";
import { GroupManagerModal } from "./components/GroupManagerModal";
import { ProjectModal } from "./components/ProjectModal";
import { SettingsModal, type SettingsTab } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { TerminalView } from "./components/TerminalView";
import { TitleBar } from "./components/TitleBar";
import { useDevPanel } from "./hooks/useDevPanel";
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
  getActiveCommandId,
  getProjectAggregateStatus,
} from "./utils/projectCommands";
import "./App.css";

const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 320;
const SIDEBAR_WIDTH_KEY = "devpanel-sidebar-width";

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
  const [isMaximized, setIsMaximized] = useState(false);
  const [logCollapsed, setLogCollapsed] = useState(false);
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

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // Ignore storage errors
    }
  }, [sidebarWidth]);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;
    try {
      const win = getCurrentWindow();
      const recordExpandedWidth = async () => {
        if (logCollapsedRef.current || isMaximizedRef.current) return;
        try {
          const [innerSize, scaleFactor, maximized] = await Promise.all([
            win.innerSize(),
            win.scaleFactor(),
            win.isMaximized(),
          ]);
          if (!mounted || maximized || logCollapsedRef.current) return;
          const logicalW = Math.round(innerSize.width / scaleFactor);
          if (logicalW >= 900) {
            expandedWidthRef.current = logicalW;
          }
        } catch {
          // Ignore
        }
      };
      void recordExpandedWidth();
      win
        .onResized(() => {
          void recordExpandedWidth();
        })
        .then((fn) => {
          if (mounted) unlisten = fn;
          else fn();
        })
        .catch(() => {});
    } catch {
      // Ignore outside Tauri runtime
    }
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const toggleLogPanel = useCallback(async () => {
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
  }, [logCollapsed, sidebarWidth]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId]
  );

  const selectedCommandId = useMemo(
    () => getActiveCommandId(selectedProject, selectedCommandByProject),
    [selectedProject, selectedCommandByProject]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      if (modalOpen || settingsOpen || groupManagerOpen || bindingModalOpen) {
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

      const key = event.key.toLowerCase();

      if (event.shiftKey && key === "r") {
        if (isFormControl || !selectedProject) return;
        event.preventDefault();
        void restartProject(selectedProject.id, selectedCommandId);
        return;
      }

      if (event.shiftKey) return;

      if (key === "j") {
        if (isFormControl) return;
        event.preventDefault();
        void toggleLogPanel();
      } else if (key === ",") {
        if (isFormControl) return;
        event.preventDefault();
        openSettings("general");
      } else if (key === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (key === "n") {
        if (isFormControl) return;
        event.preventDefault();
        setEditingProject(null);
        setCloningProject(null);
        setModalOpen(true);
      } else if (key === "f") {
        if (isFormControl || logCollapsed || !selectedProject) return;
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
    logCollapsed,
    selectedProject,
    selectedCommandId,
    toggleLogPanel,
    openSettings,
    restartProject,
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
        !isMaximized ? "border border-[var(--dp-border)]" : ""
      }`}
    >
      <TitleBar
        runningCount={runningProjectCount}
        totalCount={projects.length}
        preference={preference}
        activeTheme={activeTheme}
        platform={platform}
        closeToTray={settings.closeToTray}
        logCollapsed={logCollapsed}
        onToggleLogPanel={toggleLogPanel}
        onStopAllProjects={stopAllProjects}
        onOpenSettings={openSettings}
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
            terminalTheme={effectiveTerminalTheme}
            settings={settings}
            platform={platform}
            isVisible={!logCollapsed}
            searchTrigger={terminalSearchTrigger}
            onCollapseLog={toggleLogPanel}
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
