import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderKanban,
  FolderOpen,
  Layers,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Search,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useI18n } from "../i18n";
import type {
  LaunchBinding,
  ProjectConfig,
  ProjectStatus,
  SessionMemoryInfo,
} from "../types/project";
import {
  formatBytesCompact,
  getProjectTotalMemoryBytes,
} from "../utils/memoryFormat";
import {
  countBindingRunning,
  countRunningCommands,
  getBindingAggregateStatus,
  getProjectAggregateStatus,
  isMultiCommandProject,
  makeSessionKey,
  resolveBindingTargets,
  resolveProjectOpenUrl,
} from "../utils/projectCommands";

interface SidebarProps {
  width: number;
  fullWidth?: boolean;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  projects: ProjectConfig[];
  groups: string[];
  bindings: LaunchBinding[];
  statuses: Record<string, ProjectStatus>;
  detectedUrls?: Record<string, string>;
  sessionMemoryMap?: Record<string, SessionMemoryInfo>;
  selectedId: string | null;
  selectedCommandId: string | null;
  configPath: string;
  configError: string | null;
  onSelect: (id: string, commandId?: string | null) => void;
  onStart: (id: string, commandId?: string | null) => void;
  onStop: (id: string, commandId?: string | null) => void;
  onRestart: (id: string, commandId?: string | null) => void;
  onStartAll: (project: ProjectConfig) => void;
  onStopAll: (projectId: string) => void;
  onStartBinding: (binding: LaunchBinding) => void;
  onStopBinding: (binding: LaunchBinding) => void;
  onStartGroup: (groupName: string) => void;
  onStopGroup: (groupName: string) => void;
  onOpenDir: (cwd: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenConfigFolder: () => void;
  onOpenGroupManager: () => void;
  onAddBinding: () => void;
  onEditBinding: (binding: LaunchBinding) => void;
  onDeleteBinding: (id: string) => void;
  onReorderBindings: (orderedIds: string[]) => void;
  onAdd: () => void;
  onEdit: (project: ProjectConfig) => void;
  onDuplicate: (project: ProjectConfig) => void;
  onDelete: (id: string) => void;
  onReorderProjects: (orderedIds: string[]) => void;
}

type FilterMode = "all" | "running";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-sidebar)]";

function StatusLed({ status }: { status: ProjectStatus }) {
  if (status === "running") {
    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--dp-accent)]"
      />
    );
  }
  if (status === "starting" || status === "stopping") {
    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--dp-warning)] motion-safe:animate-pulse"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--dp-border-strong)] bg-[var(--dp-surface)]"
    />
  );
}

const COLLAPSED_PROJECTS_KEY = "devpanel-collapsed-projects";
const COLLAPSED_GROUPS_KEY = "devpanel-collapsed-groups";
const BINDINGS_COLLAPSED_KEY = "devpanel-bindings-collapsed";

function readBoolRecord(key: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readBoolFlag(key: string, fallback = false): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}

function reorderIdList(ids: string[], fromId: string, toId: string): string[] | null {
  if (fromId === toId) return null;
  const fromIdx = ids.indexOf(fromId);
  const toIdx = ids.indexOf(toId);
  if (fromIdx < 0 || toIdx < 0) return null;
  const next = [...ids];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

export function Sidebar({
  width,
  fullWidth = false,
  searchInputRef,
  projects,
  groups,
  bindings,
  statuses,
  detectedUrls,
  sessionMemoryMap,
  selectedId,
  selectedCommandId,
  configPath,
  configError,
  onSelect,
  onStart,
  onStop,
  onRestart,
  onStartAll,
  onStopAll,
  onStartBinding,
  onStopBinding,
  onStartGroup,
  onStopGroup,
  onOpenDir,
  onOpenUrl,
  onOpenConfigFolder,
  onOpenGroupManager,
  onAddBinding,
  onEditBinding,
  onDeleteBinding,
  onReorderBindings,
  onAdd,
  onEdit,
  onDuplicate,
  onDelete,
  onReorderProjects,
}: SidebarProps) {
  const { m } = useI18n();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteBindingId, setConfirmDeleteBindingId] = useState<
    string | null
  >(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [collapsedProjects, setCollapsedProjects] = useState<
    Record<string, boolean>
  >(() => readBoolRecord(COLLAPSED_PROJECTS_KEY));
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >(() => readBoolRecord(COLLAPSED_GROUPS_KEY));
  const [bindingsCollapsed, setBindingsCollapsed] = useState(() =>
    readBoolFlag(BINDINGS_COLLAPSED_KEY, false)
  );
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(
    null
  );
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(
    null
  );
  const [draggingBindingId, setDraggingBindingId] = useState<string | null>(
    null
  );
  const [dragOverBindingId, setDragOverBindingId] = useState<string | null>(
    null
  );

  const canReorder = !searchQuery.trim() && filterMode === "all";

  useEffect(() => {
    try {
      window.localStorage.setItem(
        COLLAPSED_PROJECTS_KEY,
        JSON.stringify(collapsedProjects)
      );
    } catch {
      // Ignore storage errors
    }
  }, [collapsedProjects]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        COLLAPSED_GROUPS_KEY,
        JSON.stringify(collapsedGroups)
      );
    } catch {
      // Ignore storage errors
    }
  }, [collapsedGroups]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        BINDINGS_COLLAPSED_KEY,
        String(bindingsCollapsed)
      );
    } catch {
      // Ignore storage errors
    }
  }, [bindingsCollapsed]);

  const runningCount = useMemo(
    () =>
      projects.filter((p) => {
        const s = getProjectAggregateStatus(p, statuses);
        return s === "running" || s === "starting";
      }).length,
    [projects, statuses]
  );

  const customGroupSet = useMemo(() => new Set(groups), [groups]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((project) => {
      const s = getProjectAggregateStatus(project, statuses);
      if (filterMode === "running" && s === "stopped") {
        return false;
      }
      if (!q) return true;
      const matchesGroup =
        project.group && customGroupSet.has(project.group)
          ? project.group.toLowerCase().includes(q)
          : false;
      const matchesBase =
        project.name.toLowerCase().includes(q) ||
        project.command.toLowerCase().includes(q) ||
        project.cwd.toLowerCase().includes(q) ||
        matchesGroup;
      if (matchesBase) return true;
      return (project.commands ?? []).some(
        (cmd) =>
          cmd.name.toLowerCase().includes(q) ||
          cmd.command.toLowerCase().includes(q) ||
          (cmd.cwd?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [projects, statuses, searchQuery, filterMode, customGroupSet]);

  const filteredBindings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return bindings.filter((binding) => {
      const agg = getBindingAggregateStatus(binding, projects, statuses);
      if (filterMode === "running" && agg === "stopped") {
        return false;
      }
      if (!q) return true;
      if (
        binding.name.toLowerCase().includes(q) ||
        (binding.description?.toLowerCase().includes(q) ?? false)
      ) {
        return true;
      }
      const resolved = resolveBindingTargets(binding, projects);
      return resolved.some((r) => r.label.toLowerCase().includes(q));
    });
  }, [bindings, projects, statuses, searchQuery, filterMode]);

  const groupedSections = useMemo(() => {
    if (groups.length === 0) return null;

    const sections: {
      key: string;
      name: string;
      isCustom: boolean;
      items: ProjectConfig[];
    }[] = [];

    const hasFilter = Boolean(searchQuery.trim()) || filterMode === "running";
    for (const g of groups) {
      const items = filteredProjects.filter((p) => p.group?.trim() === g);
      if (!hasFilter || items.length > 0) {
        sections.push({ key: g, name: g, isCustom: true, items });
      }
    }

    const unassigned = filteredProjects.filter((p) => {
      const g = p.group?.trim();
      return !g || !customGroupSet.has(g);
    });
    if (unassigned.length > 0) {
      sections.push({
        key: "__ungrouped__",
        name: m.sidebar.ungrouped,
        isCustom: false,
        items: unassigned,
      });
    }

    return sections;
  }, [groups, filteredProjects, customGroupSet, searchQuery, filterMode, m.sidebar.ungrouped]);

  const toggleProjectExpand = (projectId: string) => {
    setCollapsedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const toggleGroupExpand = (groupName: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }));
  };

  const renderProjectCard = (project: ProjectConfig) => {
    const isMulti = isMultiCommandProject(project);
    const status = getProjectAggregateStatus(project, statuses);
    const isSelected = project.id === selectedId;
    const isRunning = status === "running";
    const isTransitioning = status === "starting" || status === "stopping";
    const isConfirmingDelete = confirmDeleteId === project.id;
    const commands = project.commands ?? [];
    const runningCmdCount = countRunningCommands(project, statuses);
    const isProjectCollapsed = Boolean(collapsedProjects[project.id]);
    const effectiveProjectUrl = resolveProjectOpenUrl(project, detectedUrls);
    const projectMemoryBytes = sessionMemoryMap
      ? getProjectTotalMemoryBytes(project, sessionMemoryMap)
      : 0;

    return (
      <div
        key={project.id}
        draggable={canReorder}
        onDragStart={(e) => {
          if (!canReorder) return;
          setDraggingProjectId(project.id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", project.id);
        }}
        onDragOver={(e) => {
          if (!canReorder || !draggingProjectId || draggingProjectId === project.id) {
            return;
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOverProjectId(project.id);
        }}
        onDrop={(e) => {
          if (!canReorder || !draggingProjectId) return;
          e.preventDefault();
          const next = reorderIdList(
            projects.map((p) => p.id),
            draggingProjectId,
            project.id
          );
          setDraggingProjectId(null);
          setDragOverProjectId(null);
          if (next) {
            onReorderProjects(next);
          }
        }}
        onDragEnd={() => {
          setDraggingProjectId(null);
          setDragOverProjectId(null);
        }}
        className={`group relative overflow-hidden rounded-lg border transition-colors duration-150 ${
          dragOverProjectId === project.id
            ? "border-[var(--dp-info)] bg-[var(--dp-info-soft)]"
            : isSelected
              ? "border-[var(--dp-border-strong)] bg-[var(--dp-surface)] shadow-xs"
              : "border-[var(--dp-border-subtle)] bg-[var(--dp-sidebar)] hover:border-[var(--dp-border)] hover:bg-[var(--dp-surface)]/70"
        }`}
      >
        {/* Left active/running indicator bar */}
        <div
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 w-1 transition-colors ${
            isRunning
              ? "bg-[var(--dp-accent)]"
              : isTransitioning
                ? "bg-[var(--dp-warning)]"
                : isSelected
                  ? "bg-[var(--dp-info)]"
                  : "bg-transparent"
          }`}
        />

        <div className="px-3 py-2.5 pl-3.5">
          {/* Top Row: Selection button + Sibling process action buttons */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() =>
                onSelect(project.id, isMulti ? commands[0]?.id ?? null : null)
              }
              aria-current={isSelected ? "true" : undefined}
              className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded text-left ${FOCUS_RING}`}
            >
              <StatusLed status={status} />
              <span className="sr-only">
                {m.sidebar.srStatus(m.status.ofStatus(status))}
              </span>
              <span className="truncate text-[13px] font-medium text-[var(--dp-fg)]">
                {project.name}
              </span>
              {isMulti ? (
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                    runningCmdCount > 0
                      ? "border border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] text-[var(--dp-accent-text)]"
                      : "border border-[var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-fg-muted)]"
                  }`}
                >
                  {runningCmdCount > 0
                    ? `${runningCmdCount}/${commands.length}`
                    : m.sidebar.commandsCount(commands.length)}
                </span>
              ) : (
                status !== "stopped" && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      status === "running"
                        ? "border border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] text-[var(--dp-accent-text)]"
                        : "border border-[var(--dp-warning-border)] bg-[var(--dp-warning-soft)] text-[var(--dp-warning-text)]"
                    }`}
                  >
                    {m.status.ofStatus(status)}
                  </span>
                )
              )}
              {isRunning && projectMemoryBytes > 0 && (
                <span className="shrink-0 rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-1.5 py-0.5 font-mono-dev text-[10px] tabular-nums text-[var(--dp-fg-muted)]">
                  {formatBytesCompact(projectMemoryBytes)}
                </span>
              )}
            </button>

            {/* Process Controls */}
            <div className="flex shrink-0 items-center gap-1 select-none">
              {isMulti ? (
                <>
                  {status !== "stopped" && (
                    <button
                      type="button"
                      disabled={status === "stopping"}
                      onClick={() => onStopAll(project.id)}
                      aria-label={m.sidebar.stopAllAria(project.name)}
                      title={m.common.stopAll}
                      className={`cursor-pointer rounded p-1.5 text-[var(--dp-danger-text)] transition-colors hover:bg-[var(--dp-danger-soft)] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                    >
                      <Square
                        className="h-3.5 w-3.5 fill-current"
                        aria-hidden="true"
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleProjectExpand(project.id)}
                    aria-expanded={!isProjectCollapsed}
                    aria-label={
                      isProjectCollapsed
                        ? m.sidebar.expandModes
                        : m.sidebar.collapseModes
                    }
                    title={
                      isProjectCollapsed
                        ? m.sidebar.expandModes
                        : m.sidebar.collapseModes
                    }
                    className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                  >
                    {isProjectCollapsed ? (
                      <ChevronRight
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </>
              ) : status === "stopped" ? (
                <button
                  type="button"
                  onClick={() => onStart(project.id)}
                  aria-label={m.sidebar.startItemAria(project.name)}
                  title={m.common.start}
                  className={`cursor-pointer rounded p-1.5 text-[var(--dp-accent-text)] transition-colors hover:bg-[var(--dp-accent-soft)] ${FOCUS_RING}`}
                >
                  <Play
                    className="h-3.5 w-3.5 fill-current"
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={status === "stopping"}
                    onClick={() => onStop(project.id)}
                    aria-label={m.sidebar.stopItemAria(project.name)}
                    title={
                      status === "stopping"
                        ? m.common.stoppingEllipsis
                        : m.common.stop
                    }
                    className={`cursor-pointer rounded p-1.5 text-[var(--dp-danger-text)] transition-colors hover:bg-[var(--dp-danger-soft)] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                  >
                    <Square
                      className="h-3.5 w-3.5 fill-current"
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    disabled={isTransitioning}
                    onClick={() => onRestart(project.id)}
                    aria-label={m.sidebar.restartItemAria(project.name)}
                    title={m.common.restart}
                    className={`cursor-pointer rounded p-1.5 text-[var(--dp-warning-text)] transition-colors hover:bg-[var(--dp-warning-soft)] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                  >
                    <RotateCw
                      aria-hidden="true"
                      className={`h-3.5 w-3.5 ${
                        isTransitioning ? "motion-safe:animate-spin" : ""
                      }`}
                    />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Command Preview (Single-command) OR Sub-command List (Multi-command) */}
          {!isMulti ? (
            <div
              className="mt-1 truncate pl-4.5 font-mono-dev text-[11px] text-[var(--dp-fg-muted)]"
              title={project.command}
            >
              $ {project.command}
            </div>
          ) : (
            !isProjectCollapsed && (
              <div className="mt-2 space-y-1 pl-3">
                {commands.map((cmd) => {
                  const cmdKey = makeSessionKey(project.id, cmd.id);
                  const cmdStatus = statuses[cmdKey] ?? "stopped";
                  const isCmdSelected =
                    isSelected && selectedCommandId === cmd.id;
                  const isCmdTransitioning =
                    cmdStatus === "starting" || cmdStatus === "stopping";

                  return (
                    <div
                      key={cmd.id}
                      className={`flex items-center justify-between gap-1.5 rounded-md border px-2 py-1 transition-colors ${
                        isCmdSelected
                          ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)]"
                          : "border-transparent bg-[var(--dp-bg)]/60 hover:border-[var(--dp-border)] hover:bg-[var(--dp-surface-hover)]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(project.id, cmd.id)}
                        className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded text-left ${FOCUS_RING}`}
                        title={`${cmd.name}: ${cmd.command}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            cmdStatus === "running"
                              ? "bg-[var(--dp-accent)]"
                              : isCmdTransitioning
                                ? "bg-[var(--dp-warning)] motion-safe:animate-pulse"
                                : "bg-[var(--dp-fg-muted)]"
                          }`}
                        />
                        <span
                          className={`truncate text-[11px] font-medium ${
                            isCmdSelected
                              ? "text-[var(--dp-info-text)]"
                              : "text-[var(--dp-fg-secondary)]"
                          }`}
                        >
                          {cmd.name}
                        </span>
                        {cmd.cwd && (
                          <span className="shrink-0 rounded border border-[var(--dp-border)] bg-[var(--dp-surface)] px-1 py-px font-mono-dev text-[9px] text-[var(--dp-fg-muted)]">
                            {cmd.cwd}
                          </span>
                        )}
                        {cmdStatus !== "stopped" &&
                          sessionMemoryMap?.[cmdKey] &&
                          sessionMemoryMap[cmdKey].rssBytes > 0 && (
                            <span className="shrink-0 font-mono-dev text-[10px] tabular-nums text-[var(--dp-fg-muted)]">
                              {formatBytesCompact(
                                sessionMemoryMap[cmdKey].rssBytes
                              )}
                            </span>
                          )}
                      </button>

                      <div className="flex shrink-0 items-center gap-0.5 select-none">
                        {cmdStatus === "stopped" ? (
                          <button
                            type="button"
                            onClick={() => onStart(project.id, cmd.id)}
                            aria-label={m.sidebar.startItemAria(cmd.name)}
                            title={m.sidebar.startItemAria(cmd.name)}
                            className={`cursor-pointer rounded p-1 text-[var(--dp-accent-text)] transition-colors hover:bg-[var(--dp-accent-soft)] ${FOCUS_RING}`}
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
                              disabled={cmdStatus === "stopping"}
                              onClick={() => onStop(project.id, cmd.id)}
                              aria-label={m.sidebar.stopItemAria(cmd.name)}
                              title={m.sidebar.stopItemAria(cmd.name)}
                              className={`cursor-pointer rounded p-1 text-[var(--dp-danger-text)] transition-colors hover:bg-[var(--dp-danger-soft)] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                            >
                              <Square
                                className="h-3 w-3 fill-current"
                                aria-hidden="true"
                              />
                            </button>
                            <button
                              type="button"
                              disabled={isCmdTransitioning}
                              onClick={() => onRestart(project.id, cmd.id)}
                              aria-label={m.sidebar.restartItemAria(cmd.name)}
                              title={m.sidebar.restartItemAria(cmd.name)}
                              className={`cursor-pointer rounded p-1 text-[var(--dp-warning-text)] transition-colors hover:bg-[var(--dp-warning-soft)] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                            >
                              <RotateCw
                                aria-hidden="true"
                                className={`h-3 w-3 ${
                                  isCmdTransitioning
                                    ? "motion-safe:animate-spin"
                                    : ""
                                }`}
                              />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Quick Actions Row */}
          <div
            className={`mt-2 flex items-center justify-between pl-4.5 transition-opacity duration-150 select-none ${
              isSelected || isRunning || isConfirmingDelete
                ? "opacity-100"
                : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
            }`}
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onOpenDir(project.cwd)}
                aria-label={m.sidebar.openProjectDirAria(project.name)}
                title={m.sidebar.openProjectDirTitle(project.cwd)}
                className={`inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--dp-fg-secondary)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
              >
                <FolderOpen className="h-3 w-3" aria-hidden="true" />
                {m.common.folder}
              </button>
              {isMulti && runningCmdCount < commands.length && (
                <button
                  type="button"
                  onClick={() => onStartAll(project)}
                  title={m.sidebar.startAllUnrunningTitle}
                  className={`inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--dp-accent-text)] transition-colors hover:bg-[var(--dp-accent-soft)] ${FOCUS_RING}`}
                >
                  <Play
                    className="h-2.5 w-2.5 fill-current"
                    aria-hidden="true"
                  />
                  {m.common.startAll}
                </button>
              )}
              {effectiveProjectUrl && (
                <button
                  type="button"
                  onClick={() => onOpenUrl(effectiveProjectUrl)}
                  aria-label={m.sidebar.openBrowserAria(project.name)}
                  title={m.sidebar.openBrowserTitle(effectiveProjectUrl)}
                  className={`inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--dp-info-text)] transition-colors hover:bg-[var(--dp-info-soft)] ${FOCUS_RING}`}
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  {m.common.open}
                </button>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteId(null);
                  onDuplicate(project);
                }}
                aria-label={m.sidebar.duplicateAria(project.name)}
                title={m.sidebar.duplicateTitle}
                className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteId(null);
                  onEdit(project);
                }}
                aria-label={m.sidebar.editProjectAria(project.name)}
                title={m.sidebar.editProjectTitle}
                className={`cursor-pointer rounded p-1 text-[var(--dp-fg-secondary)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
              </button>
              {isConfirmingDelete ? (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDeleteId(null);
                    onDelete(project.id);
                  }}
                  onMouseLeave={() => setConfirmDeleteId(null)}
                  className={`cursor-pointer rounded bg-[var(--dp-danger)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--dp-danger-fg)] hover:bg-[var(--dp-danger-hover)] ${FOCUS_RING}`}
                >
                  {m.common.confirmDelete}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(project.id)}
                  aria-label={m.sidebar.deleteProjectAria(project.name)}
                  title={m.sidebar.deleteProjectTitle}
                  className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] transition-colors hover:bg-[var(--dp-danger-soft)] hover:text-[var(--dp-danger-text)] ${FOCUS_RING}`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside
      style={fullWidth ? undefined : { width }}
      className={
        fullWidth
          ? "flex h-full min-w-0 flex-1 flex-col bg-[var(--dp-sidebar)]"
          : "flex h-full shrink-0 flex-col border-r border-[var(--dp-border)] bg-[var(--dp-sidebar)]"
      }
    >
      {/* Workspace Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--dp-border)] px-3.5 py-2.5 select-none">
        <div className="flex min-w-0 items-center gap-2">
          <Layers
            className="h-4 w-4 shrink-0 text-[var(--dp-info)]"
            aria-hidden="true"
          />
          <h1 className="text-xs font-semibold tracking-wide text-[var(--dp-fg)] uppercase">
            {m.sidebar.heading}
          </h1>
          <span className="rounded-full border border-[var(--dp-border)] bg-[var(--dp-surface)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--dp-fg-muted)]">
            {runningCount}/{projects.length}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onOpenGroupManager}
            aria-label={m.sidebar.manageGroupsAria}
            title={m.sidebar.manageGroupsAria}
            className={`cursor-pointer rounded-md border border-transparent p-1.5 text-[var(--dp-fg-muted)] transition-colors duration-150 hover:border-[var(--dp-border)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
          >
            <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onAddBinding}
            aria-label={m.sidebar.newBindingAria}
            title={m.sidebar.newBindingTitle}
            className={`cursor-pointer rounded-md border border-transparent p-1.5 text-[var(--dp-fg-muted)] transition-colors duration-150 hover:border-[var(--dp-border)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-accent-text)] ${FOCUS_RING}`}
          >
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onAdd}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md bg-[var(--dp-accent)] px-2.5 py-1.5 text-xs font-semibold text-[var(--dp-accent-fg)] transition-colors duration-150 hover:bg-[var(--dp-accent-hover)] ${FOCUS_RING}`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {m.sidebar.addNew}
          </button>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="space-y-2 border-b border-[var(--dp-border-subtle)] px-3 py-2.5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--dp-fg-muted)]"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={m.sidebar.searchAria}
            placeholder={m.sidebar.searchPlaceholder}
            className={`w-full rounded-md border border-[var(--dp-border)] bg-[var(--dp-input-bg)] py-1.5 pr-7 pl-8 text-xs text-[var(--dp-fg)] placeholder-[var(--dp-fg-muted)] transition-colors focus:border-[var(--dp-info)] ${FOCUS_RING}`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label={m.sidebar.clearSearchAria}
              className={`absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-0.5 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div
          className="grid grid-cols-2 gap-1 rounded-md border border-[var(--dp-border)] bg-[var(--dp-bg)] p-0.5 select-none"
          role="group"
          aria-label={m.sidebar.filterAria}
        >
          <button
            type="button"
            aria-pressed={filterMode === "all"}
            onClick={() => setFilterMode("all")}
            className={`cursor-pointer rounded px-2 py-1 text-[11px] font-medium tabular-nums transition-colors duration-150 ${
              filterMode === "all"
                ? "bg-[var(--dp-surface)] text-[var(--dp-fg)] shadow-xs"
                : "text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
            } ${FOCUS_RING}`}
          >
            {m.sidebar.filterAll(projects.length)}
          </button>
          <button
            type="button"
            aria-pressed={filterMode === "running"}
            onClick={() => setFilterMode("running")}
            className={`cursor-pointer rounded px-2 py-1 text-[11px] font-medium tabular-nums transition-colors duration-150 ${
              filterMode === "running"
                ? "bg-[var(--dp-surface)] text-[var(--dp-accent-text)] shadow-xs"
                : "text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
            } ${FOCUS_RING}`}
          >
            {m.sidebar.filterRunning(runningCount)}
          </button>
        </div>
      </div>

      {/* External Config Error Banner */}
      {configError && (
        <div
          role="alert"
          className="mx-3 mt-2.5 flex items-start gap-2 rounded-lg border border-[var(--dp-warning-border)] bg-[var(--dp-warning-soft)] p-2.5 text-xs text-[var(--dp-warning-text)]"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--dp-warning)]"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 break-words">
            <div className="font-medium">{m.sidebar.configParseError}</div>
            <div className="mt-0.5 text-[11px] leading-relaxed opacity-90">
              {configError}
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Content: Launch Bindings + Projects */}
      <div className="flex-1 space-y-3 overflow-y-auto px-2.5 py-2.5">
        {/* Launch Bindings Quick-Launch Section */}
        {filteredBindings.length > 0 && (
          <section aria-label={m.sidebar.bindingsSection} className="space-y-1.5">
            <div className="flex items-center justify-between px-1 select-none">
              <button
                type="button"
                aria-expanded={!bindingsCollapsed}
                onClick={() => setBindingsCollapsed((prev) => !prev)}
                className={`flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[11px] font-semibold tracking-wider text-[var(--dp-fg-muted)] uppercase hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
              >
                {bindingsCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <Zap
                  className="h-3 w-3 text-[var(--dp-accent)]"
                  aria-hidden="true"
                />
                {m.sidebar.bindingsHeader(filteredBindings.length)}
              </button>
              <button
                type="button"
                onClick={onAddBinding}
                title={m.sidebar.addBindingAria}
                aria-label={m.sidebar.addBindingAria}
                className={`cursor-pointer rounded p-0.5 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            {!bindingsCollapsed && (
              <div className="space-y-1.5">
                {filteredBindings.map((binding) => {
                  const resolved = resolveBindingTargets(binding, projects);
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
                  const isConfirming = confirmDeleteBindingId === binding.id;

                  return (
                    <div
                      key={binding.id}
                      draggable={canReorder}
                      onDragStart={(e) => {
                        if (!canReorder) return;
                        setDraggingBindingId(binding.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", binding.id);
                      }}
                      onDragOver={(e) => {
                        if (
                          !canReorder ||
                          !draggingBindingId ||
                          draggingBindingId === binding.id
                        ) {
                          return;
                        }
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverBindingId(binding.id);
                      }}
                      onDrop={(e) => {
                        if (!canReorder || !draggingBindingId) return;
                        e.preventDefault();
                        const next = reorderIdList(
                          bindings.map((b) => b.id),
                          draggingBindingId,
                          binding.id
                        );
                        setDraggingBindingId(null);
                        setDragOverBindingId(null);
                        if (next) {
                          onReorderBindings(next);
                        }
                      }}
                      onDragEnd={() => {
                        setDraggingBindingId(null);
                        setDragOverBindingId(null);
                      }}
                      className={`group rounded-lg border px-3 py-2 transition-colors ${
                        dragOverBindingId === binding.id
                          ? "border-[var(--dp-info)] bg-[var(--dp-info-soft)]"
                          : "border-[var(--dp-border)] bg-[var(--dp-surface)]/75 hover:border-[var(--dp-border-strong)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <StatusLed status={aggStatus} />
                          <span className="truncate text-xs font-semibold text-[var(--dp-fg)]">
                            {binding.name}
                          </span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                              runningInBinding > 0
                                ? "border border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] text-[var(--dp-accent-text)]"
                                : "border border-[var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-fg-muted)]"
                            }`}
                          >
                            {runningInBinding}/{resolved.length}
                          </span>
                        </div>

                        <div className="flex shrink-0 items-center gap-0.5 select-none">
                          {runningInBinding < resolved.length && (
                            <button
                              type="button"
                              onClick={() => onStartBinding(binding)}
                              aria-label={m.sidebar.startBindingAria(
                                binding.name
                              )}
                              title={m.sidebar.startBindingTitle}
                              className={`cursor-pointer rounded p-1 text-[var(--dp-accent-text)] transition-colors hover:bg-[var(--dp-accent-soft)] ${FOCUS_RING}`}
                            >
                              <Play
                                className="h-3.5 w-3.5 fill-current"
                                aria-hidden="true"
                              />
                            </button>
                          )}
                          {runningInBinding > 0 && (
                            <button
                              type="button"
                              disabled={aggStatus === "stopping"}
                              onClick={() => onStopBinding(binding)}
                              aria-label={m.sidebar.stopBindingAria(
                                binding.name
                              )}
                              title={m.sidebar.stopBindingTitle}
                              className={`cursor-pointer rounded p-1 text-[var(--dp-danger-text)] transition-colors hover:bg-[var(--dp-danger-soft)] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                            >
                              <Square
                                className="h-3.5 w-3.5 fill-current"
                                aria-hidden="true"
                              />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteBindingId(null);
                              onEditBinding(binding);
                            }}
                            aria-label={m.sidebar.editBindingAria(binding.name)}
                            title={m.sidebar.editBindingTitle}
                            className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                          </button>
                          {isConfirming ? (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteBindingId(null);
                                onDeleteBinding(binding.id);
                              }}
                              onMouseLeave={() =>
                                setConfirmDeleteBindingId(null)
                              }
                              className={`cursor-pointer rounded bg-[var(--dp-danger)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--dp-danger-fg)] ${FOCUS_RING}`}
                            >
                              {m.common.delete}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmDeleteBindingId(binding.id)
                              }
                              aria-label={m.sidebar.deleteBindingAria(
                                binding.name
                              )}
                              title={m.sidebar.deleteBindingTitle}
                              className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-[var(--dp-danger-soft)] hover:text-[var(--dp-danger-text)] ${FOCUS_RING}`}
                            >
                              <Trash2 className="h-3 w-3" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>

                      {binding.description && (
                        <p className="mt-1 truncate pl-4.5 text-[10px] text-[var(--dp-fg-muted)]">
                          {binding.description}
                        </p>
                      )}

                      {resolved.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1 pl-4.5">
                          {resolved.map((item) => {
                            const itemStatus =
                              statuses[item.sessionKey] ?? "stopped";
                            return (
                              <button
                                key={item.sessionKey}
                                type="button"
                                onClick={() =>
                                  onSelect(item.project.id, item.commandId)
                                }
                                title={m.sidebar.switchToTargetTitle(
                                  item.label
                                )}
                                className={`inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                                  itemStatus === "running"
                                    ? "border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] text-[var(--dp-accent-text)]"
                                    : "border-[var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-fg-secondary)] hover:border-[var(--dp-info-border)] hover:text-[var(--dp-fg)]"
                                } ${FOCUS_RING}`}
                              >
                                <span
                                  aria-hidden="true"
                                  className={`h-1 w-1 rounded-full ${
                                    itemStatus === "running"
                                      ? "bg-[var(--dp-accent)]"
                                      : itemStatus === "starting" ||
                                          itemStatus === "stopping"
                                        ? "bg-[var(--dp-warning)]"
                                        : "bg-[var(--dp-fg-muted)]"
                                  }`}
                                />
                                <span className="max-w-[140px] truncate">
                                  {item.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Projects List (Flat when no custom groups, Grouped when custom groups exist) */}
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--dp-border-strong)] bg-[var(--dp-surface)]/50 px-4 py-12 text-center">
            <p className="text-xs text-[var(--dp-fg-secondary)]">
              {m.sidebar.noProjectsTitle}
            </p>
            <p className="mt-1 text-[11px] text-[var(--dp-fg-muted)]">
              {m.sidebar.noProjectsHint}
            </p>
            <button
              type="button"
              onClick={onAdd}
              className={`mt-3 cursor-pointer rounded-md bg-[var(--dp-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--dp-accent-fg)] hover:bg-[var(--dp-accent-hover)] ${FOCUS_RING}`}
            >
              {m.sidebar.addFirstProject}
            </button>
          </div>
        ) : filteredProjects.length === 0 && filteredBindings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-xs text-[var(--dp-fg-secondary)]">
              {m.sidebar.noMatchTitle}
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setFilterMode("all");
              }}
              className={`mt-2 cursor-pointer rounded-md border border-[var(--dp-border)] px-2.5 py-1 text-[11px] text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              {m.sidebar.resetFilters}
            </button>
          </div>
        ) : groupedSections ? (
          <div className="space-y-3">
            {groupedSections.map((section) => {
              const isCollapsed = Boolean(collapsedGroups[section.key]);
              const groupRunning = section.items.filter((p) => {
                const s = getProjectAggregateStatus(p, statuses);
                return s === "running" || s === "starting";
              }).length;

              return (
                <section key={section.key} aria-label={section.name}>
                  <div className="group/hdr mb-1 flex items-center justify-between gap-1 px-1 select-none">
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleGroupExpand(section.key)}
                      className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-semibold tracking-wider text-[var(--dp-fg-muted)] uppercase transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                    >
                      {isCollapsed ? (
                        <ChevronRight
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronDown
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{section.name}</span>
                      <span className="ml-1 shrink-0 text-[10px] font-medium tabular-nums opacity-80">
                        {groupRunning > 0
                          ? `${groupRunning}/${section.items.length}`
                          : section.items.length}
                      </span>
                    </button>

                    {section.isCustom && section.items.length > 0 && (
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/hdr:opacity-100 group-hover/hdr:opacity-100">
                        {groupRunning < section.items.length && (
                          <button
                            type="button"
                            onClick={() => onStartGroup(section.name)}
                            aria-label={m.sidebar.startGroupAria(section.name)}
                            title={m.sidebar.startGroupTitle(section.name)}
                            className={`cursor-pointer rounded p-1 text-[var(--dp-accent-text)] hover:bg-[var(--dp-accent-soft)] ${FOCUS_RING}`}
                          >
                            <Play
                              className="h-3 w-3 fill-current"
                              aria-hidden="true"
                            />
                          </button>
                        )}
                        {groupRunning > 0 && (
                          <button
                            type="button"
                            onClick={() => onStopGroup(section.name)}
                            aria-label={m.sidebar.stopGroupAria(section.name)}
                            title={m.sidebar.stopGroupTitle(section.name)}
                            className={`cursor-pointer rounded p-1 text-[var(--dp-danger-text)] hover:bg-[var(--dp-danger-soft)] ${FOCUS_RING}`}
                          >
                            <Square
                              className="h-3 w-3 fill-current"
                              aria-hidden="true"
                            />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {!isCollapsed &&
                    (section.items.length === 0 ? (
                      <div className="rounded-md border border-dashed border-[var(--dp-border-subtle)] px-3 py-2 text-[11px] text-[var(--dp-fg-muted)]">
                        {m.sidebar.emptyGroupHint}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {section.items.map(renderProjectCard)}
                      </div>
                    ))}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredProjects.map(renderProjectCard)}
          </div>
        )}
      </div>

      {/* Footer Config Watcher Status */}
      <div className="border-t border-[var(--dp-border)] bg-[var(--dp-bg)]/80 px-3 py-2">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="flex items-center gap-1.5 text-[var(--dp-fg-secondary)] select-none">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                configError ? "bg-[var(--dp-warning)]" : "bg-[var(--dp-accent)]"
              }`}
            />
            {configError ? m.sidebar.watcherError : m.sidebar.watcherActive}
          </span>
          <button
            type="button"
            onClick={onOpenConfigFolder}
            className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--dp-info-text)] hover:bg-[var(--dp-surface-hover)] select-none ${FOCUS_RING}`}
          >
            {m.common.openFolder}
          </button>
        </div>
        <div
          className="mt-1 truncate font-mono-dev text-[10px] text-[var(--dp-fg-muted)]"
          title={configPath}
        >
          {configPath || "~/.dev-panel/projects.json"}
        </div>
      </div>
    </aside>
  );
}
