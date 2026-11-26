import type {
  MemoryHistoryPoint,
  ProjectConfig,
  SessionMemoryInfo,
} from "../types/project";
import { getProjectSessionKeys } from "./projectCommands.ts";

export type MemoryLevel = "normal" | "warning" | "danger";

export interface MemoryHistoryStats {
  systemCurrent: number;
  systemPeak: number;
  systemAvg: number;
  managedCurrent: number;
  managedPeak: number;
  managedAvg: number;
}

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const TB = 1024 * GB;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < KB) return `${Math.round(bytes)} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) {
    const val = bytes / MB;
    return `${val >= 100 ? Math.round(val) : val.toFixed(1)} MB`;
  }
  if (bytes < TB) {
    const val = bytes / GB;
    return `${val >= 10 ? val.toFixed(1) : val.toFixed(2)} GB`;
  }
  return `${(bytes / TB).toFixed(2)} TB`;
}

export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < MB) return "<1 MB";
  if (bytes < GB) return `${Math.round(bytes / MB)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

export function getMemoryLevel(usagePercent: number): MemoryLevel {
  if (!Number.isFinite(usagePercent)) return "normal";
  if (usagePercent >= 90) return "danger";
  if (usagePercent >= 75) return "warning";
  return "normal";
}

export function buildSessionMemoryMap(
  sessions: SessionMemoryInfo[]
): Record<string, SessionMemoryInfo> {
  const map: Record<string, SessionMemoryInfo> = {};
  for (const session of sessions) {
    map[session.sessionKey] = session;
  }
  return map;
}

export function getProjectTotalMemoryBytes(
  project: ProjectConfig,
  sessionMemoryMap: Record<string, SessionMemoryInfo>
): number {
  let total = 0;
  for (const key of getProjectSessionKeys(project)) {
    const info = sessionMemoryMap[key];
    if (info) {
      total += info.rssBytes;
    }
  }
  return total;
}

export function computeHistoryStats(
  points: MemoryHistoryPoint[]
): MemoryHistoryStats {
  if (points.length === 0) {
    return {
      systemCurrent: 0,
      systemPeak: 0,
      systemAvg: 0,
      managedCurrent: 0,
      managedPeak: 0,
      managedAvg: 0,
    };
  }

  let systemSum = 0;
  let systemPeak = 0;
  let managedSum = 0;
  let managedPeak = 0;

  for (const pt of points) {
    systemSum += pt.systemPercent;
    if (pt.systemPercent > systemPeak) systemPeak = pt.systemPercent;
    managedSum += pt.managedRssBytes;
    if (pt.managedRssBytes > managedPeak) managedPeak = pt.managedRssBytes;
  }

  const last = points[points.length - 1];
  return {
    systemCurrent: last.systemPercent,
    systemPeak,
    systemAvg: systemSum / points.length,
    managedCurrent: last.managedRssBytes,
    managedPeak,
    managedAvg: managedSum / points.length,
  };
}

export function formatMemoryShare(bytes: number, totalBytes: number): string {
  if (
    !Number.isFinite(bytes) ||
    !Number.isFinite(totalBytes) ||
    bytes <= 0 ||
    totalBytes <= 0
  ) {
    return "0.0%";
  }
  const pct = (bytes / totalBytes) * 100;
  if (pct < 0.1) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}

export function buildMiniSparklinePoints(
  values: number[],
  width: number,
  height: number,
  padY = 2
): string {
  if (values.length < 2 || width <= 0 || height <= 0) {
    return "";
  }
  const innerH = Math.max(1, height - padY * 2);
  const maxVal = Math.max(...values, 1) * 1.1;
  const stepX = width / (values.length - 1);

  return values
    .map((val, idx) => {
      const clamped = Math.max(0, Math.min(maxVal, val));
      const x = Number((idx * stepX).toFixed(2));
      const y = Number(
        (padY + innerH - (clamped / maxVal) * innerH).toFixed(2)
      );
      return `${x},${y}`;
    })
    .join(" ");
}
