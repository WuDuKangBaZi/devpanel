import type {
  LaunchBinding,
  ProjectCommand,
  ProjectConfig,
  ProjectStatus,
} from "../types/project";

export function makeSessionKey(
  projectId: string,
  commandId?: string | null
): string {
  const trimmed = commandId?.trim();
  return trimmed ? `${projectId}::${trimmed}` : projectId;
}

export function isMultiCommandProject(project: ProjectConfig): boolean {
  return Boolean(project.commands && project.commands.length > 0);
}

export function resolveCommandCwd(
  projectCwd: string,
  cmdCwd?: string | null
): string {
  const sub = cmdCwd?.trim();
  if (!sub) return projectCwd;
  // Detect Windows drive/UNC paths or POSIX absolute paths
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(sub)) {
    return sub;
  }
  const sep = projectCwd.includes("\\") ? "\\" : "/";
  const base = projectCwd.replace(/[\\/]+$/, "");
  const cleanSub = sub.replace(/^[\\/]+/, "").replace(/[\\/]+/g, sep);
  return base ? `${base}${sep}${cleanSub}` : cleanSub;
}

export function getProjectSessionKeys(project: ProjectConfig): string[] {
  if (project.commands && project.commands.length > 0) {
    return project.commands.map((cmd) => makeSessionKey(project.id, cmd.id));
  }
  return [project.id];
}

export function getActiveCommandId(
  project: ProjectConfig | null,
  selectedCommandByProject: Record<string, string>
): string | null {
  if (!project || !project.commands || project.commands.length === 0) {
    return null;
  }
  const saved = selectedCommandByProject[project.id];
  if (saved && project.commands.some((cmd) => cmd.id === saved)) {
    return saved;
  }
  return project.commands[0].id;
}

export function countRunningCommands(
  project: ProjectConfig,
  statuses: Record<string, ProjectStatus>
): number {
  return getProjectSessionKeys(project).filter((key) => {
    const s = statuses[key] ?? "stopped";
    return s === "running" || s === "starting";
  }).length;
}

export function getProjectAggregateStatus(
  project: ProjectConfig,
  statuses: Record<string, ProjectStatus>
): ProjectStatus {
  const keys = getProjectSessionKeys(project);
  let hasStarting = false;
  let hasStopping = false;

  for (const key of keys) {
    const s = statuses[key] ?? "stopped";
    if (s === "running") return "running";
    if (s === "starting") hasStarting = true;
    if (s === "stopping") hasStopping = true;
  }

  if (hasStarting) return "starting";
  if (hasStopping) return "stopping";
  return "stopped";
}

export function slugifyId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function makeUniqueId(
  baseId: string,
  existingIds: string[],
  fallbackPrefix = "project"
): string {
  const clean = baseId || fallbackPrefix;
  if (!existingIds.includes(clean)) return clean;
  let index = 2;
  while (existingIds.includes(`${clean}-${index}`)) {
    index += 1;
  }
  return `${clean}-${index}`;
}

export interface ResolvedBindingTarget {
  project: ProjectConfig;
  command: ProjectCommand | null;
  commandId: string | null;
  sessionKey: string;
  label: string;
}

export function resolveBindingTargets(
  binding: LaunchBinding,
  projects: ProjectConfig[]
): ResolvedBindingTarget[] {
  const resolved: ResolvedBindingTarget[] = [];
  const seenKeys = new Set<string>();

  for (const target of binding.targets) {
    const project = projects.find((p) => p.id === target.projectId);
    if (!project) continue;

    if (project.commands && project.commands.length > 0) {
      const cmd = target.commandId
        ? project.commands.find((c) => c.id === target.commandId)
        : project.commands[0];
      if (!cmd) continue;
      const sessionKey = makeSessionKey(project.id, cmd.id);
      if (seenKeys.has(sessionKey)) continue;
      seenKeys.add(sessionKey);
      resolved.push({
        project,
        command: cmd,
        commandId: cmd.id,
        sessionKey,
        label: `${project.name} · ${cmd.name}`,
      });
    } else {
      const sessionKey = project.id;
      if (seenKeys.has(sessionKey)) continue;
      seenKeys.add(sessionKey);
      resolved.push({
        project,
        command: null,
        commandId: null,
        sessionKey,
        label: project.name,
      });
    }
  }

  return resolved;
}

export function countBindingRunning(
  binding: LaunchBinding,
  projects: ProjectConfig[],
  statuses: Record<string, ProjectStatus>
): number {
  return resolveBindingTargets(binding, projects).filter((item) => {
    const s = statuses[item.sessionKey] ?? "stopped";
    return s === "running" || s === "starting";
  }).length;
}

export function getBindingAggregateStatus(
  binding: LaunchBinding,
  projects: ProjectConfig[],
  statuses: Record<string, ProjectStatus>
): ProjectStatus {
  const items = resolveBindingTargets(binding, projects);
  let hasStarting = false;
  let hasStopping = false;

  for (const item of items) {
    const s = statuses[item.sessionKey] ?? "stopped";
    if (s === "running") return "running";
    if (s === "starting") hasStarting = true;
    if (s === "stopping") hasStopping = true;
  }

  if (hasStarting) return "starting";
  if (hasStopping) return "stopping";
  return "stopped";
}

