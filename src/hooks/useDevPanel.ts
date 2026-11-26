import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { zhCN, type Messages } from "../i18n/zh-CN";
import type {
  ConfigPayload,
  LaunchBinding,
  ProjectConfig,
  ProjectStatus,
  PtyHistoryPayload,
  PtyOutputEvent,
  PtyStatusEvent,
  PtyUrlEvent,
  TerminalSize,
} from "../types/project";
import {
  makeSessionKey,
  resolveBindingTargets,
} from "../utils/projectCommands";

export interface ToastMessage {
  id: number;
  type: "error" | "info" | "success";
  message: string;
}

export interface OutputChunk {
  bytes: Uint8Array;
  seq: number;
}

type OutputListener = (chunk: OutputChunk) => void;

interface LaunchTargetItem {
  projectId: string;
  commandId: string | null;
  sessionKey: string;
  label: string;
}

export interface UseDevPanelOptions {
  defaultShell?: string;
  notifyOnCrash?: boolean;
  messages?: Messages;
}

const DEFAULT_SIZE: TerminalSize = { cols: 120, rows: 32 };
const SELECTED_PROJECT_KEY = "devpanel-selected-project";
const SELECTED_COMMANDS_KEY = "devpanel-selected-commands";

function readStoredSelectedId(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_PROJECT_KEY) || null;
  } catch {
    return null;
  }
}

function readStoredSelectedCommands(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SELECTED_COMMANDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function base64ToBytes(base64: string): Uint8Array {
  if (!base64) return new Uint8Array(0);
  const fromBase64 = (
    Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }
  ).fromBase64;
  if (typeof fromBase64 === "function") {
    return fromBase64(base64);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function findSessionLabel(sessionKey: string, projects: ProjectConfig[]): string {
  const sepIdx = sessionKey.indexOf("::");
  if (sepIdx > 0) {
    const projectId = sessionKey.slice(0, sepIdx);
    const commandId = sessionKey.slice(sepIdx + 2);
    const project = projects.find((p) => p.id === projectId);
    const cmd = project?.commands?.find((c) => c.id === commandId);
    if (project && cmd) return `${project.name} · ${cmd.name}`;
    if (project) return project.name;
  }
  return projects.find((p) => p.id === sessionKey)?.name ?? sessionKey;
}

function pruneRecordByProjectId<T>(
  record: Record<string, T>,
  projectId: string
): Record<string, T> {
  const prefix = `${projectId}::`;
  let changed = false;
  const next: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === projectId || k.startsWith(prefix)) {
      changed = true;
    } else {
      next[k] = v;
    }
  }
  return changed ? next : record;
}

export function useDevPanel(options: UseDevPanelOptions = {}) {
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [bindings, setBindings] = useState<LaunchBinding[]>([]);
  const [configPath, setConfigPath] = useState<string>("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({});
  const [exitCodes, setExitCodes] = useState<Record<string, number | null>>({});
  const [detectedUrls, setDetectedUrls] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(
    readStoredSelectedId
  );
  const [selectedCommandByProject, setSelectedCommandByProject] = useState<
    Record<string, string>
  >(readStoredSelectedCommands);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const outputListenersRef = useRef<Map<string, Set<OutputListener>>>(new Map());
  const terminalSizesRef = useRef<Map<string, TerminalSize>>(new Map());
  const statusesRef = useRef<Record<string, ProjectStatus>>({});
  statusesRef.current = statuses;
  const projectsRef = useRef<ProjectConfig[]>([]);
  projectsRef.current = projects;
  const defaultShellRef = useRef<string | undefined>(options.defaultShell);
  defaultShellRef.current = options.defaultShell;
  const notifyOnCrashRef = useRef<boolean>(options.notifyOnCrash ?? true);
  notifyOnCrashRef.current = options.notifyOnCrash ?? true;
  const mRef = useRef<Messages>(options.messages ?? zhCN);
  mRef.current = options.messages ?? zhCN;
  const manualStopKeysRef = useRef<Set<string>>(new Set());
  const autoStartedRef = useRef(false);
  const toastIdRef = useRef(0);

  useEffect(() => {
    try {
      if (selectedId) {
        window.localStorage.setItem(SELECTED_PROJECT_KEY, selectedId);
      } else {
        window.localStorage.removeItem(SELECTED_PROJECT_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, [selectedId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SELECTED_COMMANDS_KEY,
        JSON.stringify(selectedCommandByProject)
      );
    } catch {
      // Ignore storage errors
    }
  }, [selectedCommandByProject]);

  const pushToast = useCallback(
    (message: string, type: ToastMessage["type"] = "error") => {
      const id = ++toastIdRef.current;
      setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, 4500);
    },
    []
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const setPtySubscription = useCallback(
    (id: string, subscribed: boolean) => {
      invoke("set_pty_subscription", { id, subscribed }).catch(() => {});
    },
    []
  );

  const subscribeOutput = useCallback((id: string, cb: OutputListener) => {
    const map = outputListenersRef.current;
    let set = map.get(id);
    if (!set) {
      set = new Set();
      map.set(id, set);
    }
    const firstSubscriber = set.size === 0;
    set.add(cb);
    if (firstSubscriber) {
      invoke("set_pty_subscription", { id, subscribed: true }).catch(() => {});
    }
    return () => {
      const current = map.get(id);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) {
        map.delete(id);
        invoke("set_pty_subscription", { id, subscribed: false }).catch(
          () => {}
        );
      }
    };
  }, []);

  const reportTerminalSize = useCallback(
    (id: string, size: TerminalSize) => {
      terminalSizesRef.current.set(id, size);
    },
    []
  );

  const getTerminalSize = useCallback((id: string): TerminalSize => {
    return terminalSizesRef.current.get(id) ?? DEFAULT_SIZE;
  }, []);

  const applyConfigPayload = useCallback((payload: ConfigPayload) => {
    setProjects(payload.projects);
    setGroups(payload.groups ?? []);
    setBindings(payload.bindings ?? []);
    setConfigPath(payload.configPath);
    setConfigError(payload.error ?? null);
    setSelectedId((prev) => {
      if (prev && payload.projects.some((p) => p.id === prev)) return prev;
      return payload.projects[0]?.id ?? null;
    });
  }, []);

  const launchTargetsBatch = useCallback(
    async (targets: LaunchTargetItem[], selectFirst = true) => {
      const stoppedTargets = targets.filter(
        (t) => (statusesRef.current[t.sessionKey] ?? "stopped") === "stopped"
      );
      if (stoppedTargets.length === 0) return 0;

      if (selectFirst) {
        const first = stoppedTargets[0];
        setSelectedId(first.projectId);
        if (first.commandId) {
          setSelectedCommandByProject((prev) => ({
            ...prev,
            [first.projectId]: first.commandId!,
          }));
        }
      }

      await Promise.allSettled(
        stoppedTargets.map(async (target) => {
          manualStopKeysRef.current.delete(target.sessionKey);
          setStatuses((prev) => ({
            ...prev,
            [target.sessionKey]: "starting",
          }));
          setExitCodes((prev) => ({ ...prev, [target.sessionKey]: null }));
          const size = getTerminalSize(target.sessionKey);
          try {
            await invoke("start_project", {
              id: target.projectId,
              commandId: target.commandId,
              defaultShell: defaultShellRef.current ?? null,
              cols: size.cols,
              rows: size.rows,
            });
          } catch (err) {
            setStatuses((prev) => ({
              ...prev,
              [target.sessionKey]: "stopped",
            }));
            pushToast(
              mRef.current.toasts.startTargetFailed(
                target.label,
                getErrorMessage(err)
              )
            );
          }
        })
      );

      return stoppedTargets.length;
    },
    [getTerminalSize, pushToast]
  );

  const startBinding = useCallback(
    async (binding: LaunchBinding) => {
      const resolved = resolveBindingTargets(binding, projectsRef.current);
      if (resolved.length === 0) {
        pushToast(mRef.current.toasts.bindingEmpty(binding.name));
        return;
      }

      const targetItems: LaunchTargetItem[] = resolved.map((item) => ({
        projectId: item.project.id,
        commandId: item.commandId,
        sessionKey: item.sessionKey,
        label: item.label,
      }));

      if (!binding.sequential) {
        const started = await launchTargetsBatch(targetItems);
        if (started === 0) {
          pushToast(mRef.current.toasts.bindingAllRunning(binding.name), "info");
        } else {
          pushToast(
            mRef.current.toasts.bindingStarted(binding.name, started),
            "success"
          );
        }
        return;
      }

      const stoppedItems = targetItems.filter(
        (t) => (statusesRef.current[t.sessionKey] ?? "stopped") === "stopped"
      );
      if (stoppedItems.length === 0) {
        pushToast(mRef.current.toasts.bindingAllRunning(binding.name), "info");
        return;
      }

      const first = stoppedItems[0];
      setSelectedId(first.projectId);
      if (first.commandId) {
        setSelectedCommandByProject((prev) => ({
          ...prev,
          [first.projectId]: first.commandId!,
        }));
      }

      const delayMs = Math.max(0, binding.delayMs ?? 1000);
      let startedCount = 0;

      for (let i = 0; i < stoppedItems.length; i += 1) {
        const target = stoppedItems[i];
        manualStopKeysRef.current.delete(target.sessionKey);
        setStatuses((prev) => ({ ...prev, [target.sessionKey]: "starting" }));
        setExitCodes((prev) => ({ ...prev, [target.sessionKey]: null }));
        const size = getTerminalSize(target.sessionKey);
        try {
          await invoke("start_project", {
            id: target.projectId,
            commandId: target.commandId,
            defaultShell: defaultShellRef.current ?? null,
            cols: size.cols,
            rows: size.rows,
          });
          startedCount += 1;
        } catch (err) {
          setStatuses((prev) => ({ ...prev, [target.sessionKey]: "stopped" }));
          pushToast(
            mRef.current.toasts.startTargetFailed(
              target.label,
              getErrorMessage(err)
            )
          );
        }

        if (i < stoppedItems.length - 1 && delayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
      }

      if (startedCount > 0) {
        pushToast(
          mRef.current.toasts.bindingStartedSequential(
            binding.name,
            startedCount
          ),
          "success"
        );
      }
    },
    [getTerminalSize, launchTargetsBatch, pushToast]
  );

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const [cfg, initialStatuses, initialUrls] = await Promise.all([
          invoke<ConfigPayload>("get_config"),
          invoke<Record<string, ProjectStatus>>("get_all_statuses"),
          invoke<Record<string, string>>("get_detected_urls"),
        ]);
        if (!active) return;
        projectsRef.current = cfg.projects;
        statusesRef.current = initialStatuses;
        applyConfigPayload(cfg);
        setStatuses(initialStatuses);
        setDetectedUrls(initialUrls);

        if (!autoStartedRef.current) {
          autoStartedRef.current = true;
          const autoTargets: LaunchTargetItem[] = [];
          const seenKeys = new Set<string>();

          for (const p of cfg.projects) {
            if (p.commands && p.commands.length > 0) {
              for (const cmd of p.commands) {
                if (p.autoStart || cmd.autoStart) {
                  const sessionKey = makeSessionKey(p.id, cmd.id);
                  if (!seenKeys.has(sessionKey)) {
                    seenKeys.add(sessionKey);
                    autoTargets.push({
                      projectId: p.id,
                      commandId: cmd.id,
                      sessionKey,
                      label: `${p.name} · ${cmd.name}`,
                    });
                  }
                }
              }
            } else if (p.autoStart) {
              if (!seenKeys.has(p.id)) {
                seenKeys.add(p.id);
                autoTargets.push({
                  projectId: p.id,
                  commandId: null,
                  sessionKey: p.id,
                  label: p.name,
                });
              }
            }
          }

          if (autoTargets.length > 0) {
            void launchTargetsBatch(autoTargets, false);
          }

          for (const b of cfg.bindings ?? []) {
            if (b.autoStart) {
              void startBinding(b);
            }
          }
        }
      } catch (err) {
        if (active) {
          pushToast(mRef.current.toasts.loadConfigFailed(getErrorMessage(err)));
        }
      }
    }

    bootstrap();

    const unlistenPromises = [
      listen<ConfigPayload>("config-updated", (event) => {
        applyConfigPayload(event.payload);
      }),
      listen<PtyStatusEvent>("pty-status", (event) => {
        const { id, status, exitCode } = event.payload;
        setStatuses((prev) => ({ ...prev, [id]: status }));
        if (status === "running" || status === "starting") {
          manualStopKeysRef.current.delete(id);
          setExitCodes((prev) => ({ ...prev, [id]: null }));
        } else if (status === "stopped") {
          setExitCodes((prev) => ({ ...prev, [id]: exitCode ?? null }));
          const wasManual = manualStopKeysRef.current.delete(id);
          if (
            !wasManual &&
            notifyOnCrashRef.current &&
            exitCode !== null &&
            exitCode !== undefined &&
            exitCode !== 0
          ) {
            pushToast(
              mRef.current.toasts.crashedExit(
                findSessionLabel(id, projectsRef.current),
                exitCode
              ),
              "error"
            );
          }
        }
      }),
      listen<PtyOutputEvent>("pty-output", (event) => {
        const { id, data, seq } = event.payload;
        const listeners = outputListenersRef.current.get(id);
        if (!listeners || listeners.size === 0) return;
        const bytes = base64ToBytes(data);
        listeners.forEach((cb) => cb({ bytes, seq }));
      }),
      listen<PtyUrlEvent>("pty-url-detected", (event) => {
        const { id, url } = event.payload;
        setDetectedUrls((prev) => {
          if (!url) {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          }
          if (prev[id] === url) return prev;
          return { ...prev, [id]: url };
        });
      }),
    ];

    return () => {
      active = false;
      unlistenPromises.forEach((p) => {
        p.then((unlisten) => unlisten()).catch(() => {});
      });
    };
  }, [applyConfigPayload, launchTargetsBatch, pushToast, startBinding]);

  const selectProject = useCallback(
    (projectId: string, commandId?: string | null) => {
      setSelectedId(projectId);
      if (commandId) {
        setSelectedCommandByProject((prev) => ({
          ...prev,
          [projectId]: commandId,
        }));
      }
    },
    []
  );

  const startProject = useCallback(
    async (id: string, commandId?: string | null) => {
      const sessionKey = makeSessionKey(id, commandId);
      setSelectedId(id);
      if (commandId) {
        setSelectedCommandByProject((prev) => ({
          ...prev,
          [id]: commandId,
        }));
      }
      manualStopKeysRef.current.delete(sessionKey);
      setStatuses((prev) => ({ ...prev, [sessionKey]: "starting" }));
      setExitCodes((prev) => ({ ...prev, [sessionKey]: null }));
      const size = getTerminalSize(sessionKey);
      try {
        await invoke("start_project", {
          id,
          commandId: commandId ?? null,
          defaultShell: defaultShellRef.current ?? null,
          cols: size.cols,
          rows: size.rows,
        });
      } catch (err) {
        setStatuses((prev) => ({ ...prev, [sessionKey]: "stopped" }));
        pushToast(mRef.current.toasts.startFailed(getErrorMessage(err)));
      }
    },
    [getTerminalSize, pushToast]
  );

  const stopProject = useCallback(
    async (id: string, commandId?: string | null) => {
      const sessionKey = makeSessionKey(id, commandId);
      manualStopKeysRef.current.add(sessionKey);
      setStatuses((prev) => ({ ...prev, [sessionKey]: "stopping" }));
      try {
        await invoke("stop_project", { id, commandId: commandId ?? null });
      } catch (err) {
        manualStopKeysRef.current.delete(sessionKey);
        pushToast(mRef.current.toasts.stopFailed(getErrorMessage(err)));
      }
    },
    [pushToast]
  );

  const restartProject = useCallback(
    async (id: string, commandId?: string | null) => {
      const sessionKey = makeSessionKey(id, commandId);
      setSelectedId(id);
      if (commandId) {
        setSelectedCommandByProject((prev) => ({
          ...prev,
          [id]: commandId,
        }));
      }
      manualStopKeysRef.current.add(sessionKey);
      setStatuses((prev) => ({ ...prev, [sessionKey]: "stopping" }));
      setExitCodes((prev) => ({ ...prev, [sessionKey]: null }));
      const size = getTerminalSize(sessionKey);
      try {
        await invoke("restart_project", {
          id,
          commandId: commandId ?? null,
          defaultShell: defaultShellRef.current ?? null,
          cols: size.cols,
          rows: size.rows,
        });
      } catch (err) {
        setStatuses((prev) => ({ ...prev, [sessionKey]: "stopped" }));
        pushToast(mRef.current.toasts.restartFailed(getErrorMessage(err)));
      }
    },
    [getTerminalSize, pushToast]
  );

  const stopSessionKeysBatch = useCallback(
    async (sessionKeys: string[]) => {
      const activeKeys = sessionKeys.filter(
        (key) => (statusesRef.current[key] ?? "stopped") !== "stopped"
      );
      if (activeKeys.length === 0) return;

      for (const key of activeKeys) {
        manualStopKeysRef.current.add(key);
      }

      setStatuses((prev) => {
        const next = { ...prev };
        for (const key of activeKeys) {
          next[key] = "stopping";
        }
        return next;
      });

      try {
        await invoke("stop_sessions", { sessionKeys: activeKeys });
      } catch (err) {
        pushToast(mRef.current.toasts.batchStopFailed(getErrorMessage(err)));
      }
    },
    [pushToast]
  );

  const stopAllProjects = useCallback(async () => {
    const activeKeys = Object.entries(statusesRef.current)
      .filter(([, s]) => s !== "stopped")
      .map(([k]) => k);
    if (activeKeys.length === 0) return;

    for (const key of activeKeys) {
      manualStopKeysRef.current.add(key);
    }
    setStatuses((prev) => {
      const next = { ...prev };
      for (const key of activeKeys) {
        next[key] = "stopping";
      }
      return next;
    });
    try {
      await invoke("stop_all_projects");
      pushToast(
        mRef.current.toasts.stoppedAllProcesses(activeKeys.length),
        "info"
      );
    } catch (err) {
      pushToast(mRef.current.toasts.stopAllFailed(getErrorMessage(err)));
    }
  }, [pushToast]);

  const startAllCommands = useCallback(
    async (project: ProjectConfig) => {
      setSelectedId(project.id);
      const commands = project.commands ?? [];
      const targets =
        commands.length > 0
          ? commands.map((cmd) => ({
              projectId: project.id,
              commandId: cmd.id,
              sessionKey: makeSessionKey(project.id, cmd.id),
              label: cmd.name,
            }))
          : [
              {
                projectId: project.id,
                commandId: null,
                sessionKey: project.id,
                label: project.name,
              },
            ];

      await launchTargetsBatch(targets);
    },
    [launchTargetsBatch]
  );

  const stopAllCommands = useCallback(
    async (projectId: string) => {
      const prefix = `${projectId}::`;
      setStatuses((prev) => {
        const next = { ...prev };
        for (const [key, s] of Object.entries(prev)) {
          if (
            (key === projectId || key.startsWith(prefix)) &&
            s !== "stopped"
          ) {
            manualStopKeysRef.current.add(key);
            next[key] = "stopping";
          }
        }
        return next;
      });
      try {
        await invoke("stop_all_project_commands", { id: projectId });
      } catch (err) {
        pushToast(mRef.current.toasts.stopAllFailed(getErrorMessage(err)));
      }
    },
    [pushToast]
  );

  const stopBinding = useCallback(
    async (binding: LaunchBinding) => {
      const resolved = resolveBindingTargets(binding, projectsRef.current);
      await stopSessionKeysBatch(resolved.map((r) => r.sessionKey));
    },
    [stopSessionKeysBatch]
  );

  const startGroupProjects = useCallback(
    async (groupName: string) => {
      const groupProjects = projectsRef.current.filter(
        (p) => p.group?.trim() === groupName
      );
      const targets: LaunchTargetItem[] = groupProjects.flatMap((p) =>
        p.commands && p.commands.length > 0
          ? p.commands.map((cmd): LaunchTargetItem => ({
              projectId: p.id,
              commandId: cmd.id,
              sessionKey: makeSessionKey(p.id, cmd.id),
              label: `${p.name} · ${cmd.name}`,
            }))
          : [
              {
                projectId: p.id,
                commandId: null,
                sessionKey: p.id,
                label: p.name,
              },
            ]
      );
      const started = await launchTargetsBatch(targets);
      if (started > 0) {
        pushToast(
          mRef.current.toasts.groupStarted(groupName, started),
          "success"
        );
      }
    },
    [launchTargetsBatch, pushToast]
  );

  const stopGroupProjects = useCallback(
    async (groupName: string) => {
      const groupProjects = projectsRef.current.filter(
        (p) => p.group?.trim() === groupName
      );
      const keys = groupProjects.flatMap((p) =>
        p.commands && p.commands.length > 0
          ? p.commands.map((cmd) => makeSessionKey(p.id, cmd.id))
          : [p.id]
      );
      await stopSessionKeysBatch(keys);
    },
    [stopSessionKeysBatch]
  );

  const cleanupClientStateForProject = useCallback((projectId: string) => {
    const prefix = `${projectId}::`;
    for (const key of Array.from(terminalSizesRef.current.keys())) {
      if (key === projectId || key.startsWith(prefix)) {
        terminalSizesRef.current.delete(key);
      }
    }
    setStatuses((prev) => pruneRecordByProjectId(prev, projectId));
    setExitCodes((prev) => pruneRecordByProjectId(prev, projectId));
    setDetectedUrls((prev) => pruneRecordByProjectId(prev, projectId));
    setSelectedCommandByProject((prev) => {
      if (!(projectId in prev)) return prev;
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
  }, []);

  const saveProject = useCallback(
    async (project: ProjectConfig, previousId?: string) => {
      try {
        const payload = await invoke<ConfigPayload>("save_project", {
          project,
          previousId: previousId ?? null,
        });
        if (previousId && previousId !== project.id) {
          cleanupClientStateForProject(previousId);
        }
        applyConfigPayload(payload);
        setSelectedId(project.id);
        if (project.commands && project.commands.length > 0) {
          setSelectedCommandByProject((prev) => {
            const current = prev[project.id];
            if (current && project.commands!.some((c) => c.id === current)) {
              return prev;
            }
            return { ...prev, [project.id]: project.commands![0].id };
          });
        }
        pushToast(mRef.current.toasts.projectSaved(project.name), "success");
      } catch (err) {
        pushToast(mRef.current.toasts.saveFailed(getErrorMessage(err)));
        throw err;
      }
    },
    [applyConfigPayload, cleanupClientStateForProject, pushToast]
  );

  const deleteProject = useCallback(
    async (id: string) => {
      try {
        const payload = await invoke<ConfigPayload>("delete_project", { id });
        cleanupClientStateForProject(id);
        applyConfigPayload(payload);
        pushToast(mRef.current.toasts.projectDeleted, "info");
      } catch (err) {
        pushToast(mRef.current.toasts.deleteFailed(getErrorMessage(err)));
      }
    },
    [applyConfigPayload, cleanupClientStateForProject, pushToast]
  );

  const createGroup = useCallback(
    async (name: string) => {
      try {
        const payload = await invoke<ConfigPayload>("create_group", { name });
        applyConfigPayload(payload);
        pushToast(mRef.current.toasts.groupCreated(name.trim()), "success");
      } catch (err) {
        pushToast(mRef.current.toasts.createGroupFailed(getErrorMessage(err)));
        throw err;
      }
    },
    [applyConfigPayload, pushToast]
  );

  const renameGroup = useCallback(
    async (oldName: string, newName: string) => {
      try {
        const payload = await invoke<ConfigPayload>("rename_group", {
          oldName,
          newName,
        });
        applyConfigPayload(payload);
        pushToast(mRef.current.toasts.groupRenamed(newName.trim()), "success");
      } catch (err) {
        pushToast(mRef.current.toasts.renameGroupFailed(getErrorMessage(err)));
        throw err;
      }
    },
    [applyConfigPayload, pushToast]
  );

  const deleteGroup = useCallback(
    async (name: string) => {
      try {
        const payload = await invoke<ConfigPayload>("delete_group", { name });
        applyConfigPayload(payload);
        pushToast(mRef.current.toasts.groupDeleted(name), "info");
      } catch (err) {
        pushToast(mRef.current.toasts.deleteGroupFailed(getErrorMessage(err)));
        throw err;
      }
    },
    [applyConfigPayload, pushToast]
  );

  const saveBinding = useCallback(
    async (binding: LaunchBinding) => {
      try {
        const payload = await invoke<ConfigPayload>("save_binding", { binding });
        applyConfigPayload(payload);
        pushToast(mRef.current.toasts.bindingSaved(binding.name), "success");
      } catch (err) {
        pushToast(mRef.current.toasts.saveBindingFailed(getErrorMessage(err)));
        throw err;
      }
    },
    [applyConfigPayload, pushToast]
  );

  const deleteBinding = useCallback(
    async (id: string) => {
      try {
        const payload = await invoke<ConfigPayload>("delete_binding", { id });
        applyConfigPayload(payload);
        pushToast(mRef.current.toasts.bindingDeleted, "info");
      } catch (err) {
        pushToast(
          mRef.current.toasts.deleteBindingFailed(getErrorMessage(err))
        );
      }
    },
    [applyConfigPayload, pushToast]
  );

  const reorderProjects = useCallback(
    async (orderedIds: string[]) => {
      try {
        const payload = await invoke<ConfigPayload>("reorder_projects", {
          orderedIds,
        });
        applyConfigPayload(payload);
      } catch (err) {
        pushToast(mRef.current.toasts.reorderFailed(getErrorMessage(err)));
      }
    },
    [applyConfigPayload, pushToast]
  );

  const reorderGroups = useCallback(
    async (orderedNames: string[]) => {
      try {
        const payload = await invoke<ConfigPayload>("reorder_groups", {
          orderedNames,
        });
        applyConfigPayload(payload);
      } catch (err) {
        pushToast(mRef.current.toasts.reorderGroupFailed(getErrorMessage(err)));
      }
    },
    [applyConfigPayload, pushToast]
  );

  const reorderBindings = useCallback(
    async (orderedIds: string[]) => {
      try {
        const payload = await invoke<ConfigPayload>("reorder_bindings", {
          orderedIds,
        });
        applyConfigPayload(payload);
      } catch (err) {
        pushToast(
          mRef.current.toasts.reorderBindingFailed(getErrorMessage(err))
        );
      }
    },
    [applyConfigPayload, pushToast]
  );

  const exportConfigFile = useCallback(async () => {
    try {
      const savedPath = await invoke<string | null>("export_config_file");
      if (savedPath) {
        pushToast(mRef.current.toasts.configExported(savedPath), "success");
      }
    } catch (err) {
      pushToast(mRef.current.toasts.exportConfigFailed(getErrorMessage(err)));
    }
  }, [pushToast]);

  const importConfigFile = useCallback(
    async (replace: boolean) => {
      try {
        const payload = await invoke<ConfigPayload | null>(
          "import_config_file",
          { replace }
        );
        if (payload) {
          applyConfigPayload(payload);
          pushToast(
            replace
              ? mRef.current.toasts.configImportedReplace
              : mRef.current.toasts.configImportedMerge,
            "success"
          );
        }
      } catch (err) {
        pushToast(mRef.current.toasts.importConfigFailed(getErrorMessage(err)));
      }
    },
    [applyConfigPayload, pushToast]
  );

  const exportLogFile = useCallback(
    async (defaultName: string, content: string) => {
      try {
        const savedPath = await invoke<string | null>("export_log_file", {
          defaultName,
          content,
        });
        if (savedPath) {
          pushToast(mRef.current.toasts.logExported(savedPath), "success");
        }
      } catch (err) {
        pushToast(mRef.current.toasts.exportLogFailed(getErrorMessage(err)));
      }
    },
    [pushToast]
  );

  const openDirectory = useCallback(
    async (path: string) => {
      try {
        await invoke("open_directory", { path });
      } catch (err) {
        pushToast(mRef.current.toasts.openDirFailed(getErrorMessage(err)));
      }
    },
    [pushToast]
  );

  const openInEditor = useCallback(
    async (path: string, editor?: string) => {
      try {
        await invoke("open_in_editor", { path, editor: editor ?? null });
      } catch (err) {
        pushToast(mRef.current.toasts.openEditorFailed(getErrorMessage(err)));
      }
    },
    [pushToast]
  );

  const openInExternalTerminal = useCallback(
    async (path: string, shell?: string) => {
      try {
        await invoke("open_in_external_terminal", {
          path,
          shell: shell ?? defaultShellRef.current ?? null,
        });
      } catch (err) {
        pushToast(mRef.current.toasts.openExtTermFailed(getErrorMessage(err)));
      }
    },
    [pushToast]
  );

  const openUrl = useCallback(
    async (url: string) => {
      try {
        await invoke("open_url", { url });
      } catch (err) {
        pushToast(mRef.current.toasts.openUrlFailed(getErrorMessage(err)));
      }
    },
    [pushToast]
  );

  const openConfigFolder = useCallback(async () => {
    if (!configPath) return;
    const normalized = configPath.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    const dir = idx > 0 ? configPath.slice(0, idx) : configPath;
    await openDirectory(dir);
  }, [configPath, openDirectory]);

  const fetchHistory = useCallback(async (id: string): Promise<OutputChunk> => {
    const res = await invoke<PtyHistoryPayload>("get_pty_history", { id });
    return {
      bytes: base64ToBytes(res.data),
      seq: res.seq,
    };
  }, []);

  const clearHistory = useCallback(async (id: string) => {
    try {
      await invoke("clear_pty_history", { id });
    } catch {
      // Non-critical if session has no history
    }
  }, []);

  return {
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
    setSelectedId,
    selectProject,
    toasts,
    pushToast,
    dismissToast,
    setPtySubscription,
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
  };
}
