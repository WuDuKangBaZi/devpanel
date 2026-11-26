import type {
  ProjectConfig,
  ProjectStatus,
  SessionMemoryInfo,
} from "../types/project";
import { makeSessionKey, resolveSessionOpenUrl } from "./projectCommands.ts";

export const MINI_MIN_WIDTH = 280;
export const MINI_MIN_HEIGHT = 150;
export const MINI_MAX_WIDTH = 560;
export const MINI_MAX_HEIGHT = 760;

export const DEFAULT_MINI_BOUNDS: MiniBounds = {
  width: 340,
  height: 320,
};

export interface MiniBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface NormalWindowSnapshot {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
  logCollapsed: boolean;
  alwaysOnTop: boolean;
}

export interface MiniSessionItem {
  sessionKey: string;
  projectId: string;
  commandId: string | null;
  title: string;
  subtitle?: string;
  status: ProjectStatus;
  url?: string;
  rssBytes: number;
}

export function clampMiniBounds(bounds: Partial<MiniBounds>): MiniBounds {
  const rawW =
    typeof bounds.width === "number" && Number.isFinite(bounds.width)
      ? Math.round(bounds.width)
      : DEFAULT_MINI_BOUNDS.width;
  const rawH =
    typeof bounds.height === "number" && Number.isFinite(bounds.height)
      ? Math.round(bounds.height)
      : DEFAULT_MINI_BOUNDS.height;

  const result: MiniBounds = {
    width: Math.min(MINI_MAX_WIDTH, Math.max(MINI_MIN_WIDTH, rawW)),
    height: Math.min(MINI_MAX_HEIGHT, Math.max(MINI_MIN_HEIGHT, rawH)),
  };

  if (typeof bounds.x === "number" && Number.isFinite(bounds.x)) {
    result.x = Math.round(bounds.x);
  }
  if (typeof bounds.y === "number" && Number.isFinite(bounds.y)) {
    result.y = Math.round(bounds.y);
  }

  return result;
}

export function buildMiniSessionItems(
  projects: ProjectConfig[],
  statuses: Record<string, ProjectStatus>,
  detectedUrls: Record<string, string>,
  sessionMemoryMap: Record<string, SessionMemoryInfo>
): MiniSessionItem[] {
  const items: MiniSessionItem[] = [];

  for (const project of projects) {
    if (project.commands && project.commands.length > 0) {
      for (const cmd of project.commands) {
        const sessionKey = makeSessionKey(project.id, cmd.id);
        const status = statuses[sessionKey] ?? "stopped";
        const url = resolveSessionOpenUrl(
          cmd.url?.trim() || project.url?.trim(),
          detectedUrls[sessionKey]
        );
        const rssBytes = sessionMemoryMap[sessionKey]?.rssBytes ?? 0;
        items.push({
          sessionKey,
          projectId: project.id,
          commandId: cmd.id,
          title: project.name,
          subtitle: cmd.name,
          status,
          url,
          rssBytes,
        });
      }
    } else {
      const sessionKey = project.id;
      const status = statuses[sessionKey] ?? "stopped";
      const url = resolveSessionOpenUrl(project.url, detectedUrls[sessionKey]);
      const rssBytes = sessionMemoryMap[sessionKey]?.rssBytes ?? 0;
      items.push({
        sessionKey,
        projectId: project.id,
        commandId: null,
        title: project.name,
        status,
        url,
        rssBytes,
      });
    }
  }

  return items;
}
