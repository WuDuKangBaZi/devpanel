import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  MemoryHistoryPoint,
  MemorySnapshot,
  SessionMemoryInfo,
} from "../types/project";
import { buildSessionMemoryMap } from "../utils/memoryFormat";

export type MemoryRefreshInterval = 1000 | 2000 | 5000;

export interface UseMemoryMonitorOptions {
  isModalOpen: boolean;
  includeTopProcesses: boolean;
  activeSessionSignature?: string;
}

const MAX_HISTORY_POINTS = 60;
const MAX_SESSION_HISTORY_POINTS = 30;
const BACKGROUND_POLL_MS = 3000;
const TOP_PROCESSES_LIMIT = 30;

function getErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export function useMemoryMonitor({
  isModalOpen,
  includeTopProcesses,
  activeSessionSignature = "",
}: UseMemoryMonitorOptions) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [history, setHistory] = useState<MemoryHistoryPoint[]>([]);
  const [sessionHistory, setSessionHistory] = useState<
    Record<string, number[]>
  >({});
  const [sessionPeaks, setSessionPeaks] = useState<Record<string, number>>({});
  const [paused, setPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState<MemoryRefreshInterval>(2000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const hasSnapshotRef = useRef(false);
  const optionsRef = useRef({ isModalOpen, includeTopProcesses });
  optionsRef.current = { isModalOpen, includeTopProcesses };

  const fetchSnapshot = useCallback(async (withTopOverride?: boolean) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    if (!hasSnapshotRef.current) {
      setLoading(true);
    }

    const wantTop =
      withTopOverride ??
      (optionsRef.current.isModalOpen && optionsRef.current.includeTopProcesses);

    try {
      const next = await invoke<MemorySnapshot>("get_memory_snapshot", {
        includeTopProcesses: wantTop,
        topLimit: TOP_PROCESSES_LIMIT,
      });

      hasSnapshotRef.current = true;
      setSnapshot((prev) => {
        if (
          !wantTop &&
          prev &&
          prev.topProcesses.length > 0 &&
          next.topProcesses.length === 0
        ) {
          return { ...next, topProcesses: prev.topProcesses };
        }
        return next;
      });
      setError(null);

      setHistory((prev) => {
        const point: MemoryHistoryPoint = {
          timestampMs: next.timestampMs,
          systemPercent: next.system.usagePercent,
          systemUsedBytes: next.system.usedBytes,
          managedRssBytes: next.managedTotalRssBytes,
          appRssBytes: next.appRssBytes,
        };
        const updated = [...prev, point];
        return updated.length > MAX_HISTORY_POINTS
          ? updated.slice(updated.length - MAX_HISTORY_POINTS)
          : updated;
      });

      setSessionHistory((prev) => {
        const nextMap: Record<string, number[]> = {};
        for (const session of next.sessions) {
          const existing = prev[session.sessionKey] ?? [];
          const updated = [...existing, session.rssBytes];
          nextMap[session.sessionKey] =
            updated.length > MAX_SESSION_HISTORY_POINTS
              ? updated.slice(updated.length - MAX_SESSION_HISTORY_POINTS)
              : updated;
        }
        return nextMap;
      });

      setSessionPeaks((prev) => {
        const nextPeaks: Record<string, number> = {};
        for (const session of next.sessions) {
          nextPeaks[session.sessionKey] = Math.max(
            prev[session.sessionKey] ?? 0,
            session.rssBytes
          );
        }
        return nextPeaks;
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const refreshNow = useCallback(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    void fetchSnapshot();
  }, [isModalOpen, includeTopProcesses, fetchSnapshot]);

  useEffect(() => {
    if (!activeSessionSignature) {
      void fetchSnapshot();
      return;
    }
    const timer = window.setTimeout(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      void fetchSnapshot();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeSessionSignature, fetchSnapshot]);

  useEffect(() => {
    if (isModalOpen && paused) {
      return;
    }

    const period = isModalOpen ? intervalMs : BACKGROUND_POLL_MS;
    const timer = window.setInterval(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      void fetchSnapshot();
    }, period);

    return () => {
      window.clearInterval(timer);
    };
  }, [isModalOpen, paused, intervalMs, fetchSnapshot]);

  useEffect(() => {
    const handleVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        !(optionsRef.current.isModalOpen && paused)
      ) {
        void fetchSnapshot();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [paused, fetchSnapshot]);

  const sessionMemoryMap = useMemo<Record<string, SessionMemoryInfo>>(
    () => buildSessionMemoryMap(snapshot?.sessions ?? []),
    [snapshot?.sessions]
  );

  return {
    snapshot,
    history,
    sessionMemoryMap,
    sessionHistory,
    sessionPeaks,
    paused,
    setPaused,
    intervalMs,
    setIntervalMs,
    loading,
    error,
    refreshNow,
    clearHistory,
  };
}
