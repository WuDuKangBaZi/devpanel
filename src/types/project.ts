export type ProjectStatus = "stopped" | "starting" | "running" | "stopping";

export interface ProjectCommand {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  shell?: string;
  url?: string;
  env?: Record<string, string>;
  autoStart?: boolean;
}

export interface ProjectConfig {
  id: string;
  name: string;
  cwd: string;
  command: string;
  shell?: string;
  url?: string;
  group?: string;
  commands?: ProjectCommand[];
  env?: Record<string, string>;
  autoStart?: boolean;
}

export interface CommandOption {
  id: string;
  label: string;
  command: string;
  cwd?: string | null;
  url?: string | null;
}

export interface DetectedProject {
  cwd: string;
  suggestedId: string;
  suggestedName: string;
  projectType: string;
  group?: string | null;
  shell?: string | null;
  command: string;
  url?: string | null;
  packageManager?: string | null;
  alternatives: CommandOption[];
  commands: CommandOption[];
  summary: string;
}

export interface BindingTarget {
  projectId: string;
  commandId?: string;
}

export interface LaunchBinding {
  id: string;
  name: string;
  description?: string;
  targets: BindingTarget[];
  sequential?: boolean;
  delayMs?: number;
  autoStart?: boolean;
}

export interface ConfigPayload {
  projects: ProjectConfig[];
  groups: string[];
  bindings: LaunchBinding[];
  configPath: string;
  error?: string | null;
}

export interface PtyOutputEvent {
  id: string;
  data: string;
  seq: number;
}

export interface PtyHistoryPayload {
  data: string;
  seq: number;
}

export interface PtyStatusEvent {
  id: string;
  status: ProjectStatus;
  exitCode?: number | null;
}

export interface PtyUrlEvent {
  id: string;
  url?: string | null;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface SystemMemoryInfo {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface ProcessMemoryEntry {
  pid: number;
  parentPid: number;
  name: string;
  rssBytes: number;
  privateBytes: number;
  sessionKey?: string | null;
}

export interface SessionMemoryInfo {
  sessionKey: string;
  rootPid?: number | null;
  rssBytes: number;
  privateBytes: number;
  processCount: number;
  processes: ProcessMemoryEntry[];
}

export interface MemorySnapshot {
  timestampMs: number;
  system: SystemMemoryInfo;
  appRssBytes: number;
  appPrivateBytes: number;
  appProcessCount: number;
  managedTotalRssBytes: number;
  managedTotalPrivateBytes: number;
  managedProcessCount: number;
  sessions: SessionMemoryInfo[];
  topProcesses: ProcessMemoryEntry[];
}

export interface MemoryHistoryPoint {
  timestampMs: number;
  systemPercent: number;
  systemUsedBytes: number;
  managedRssBytes: number;
  appRssBytes: number;
}
