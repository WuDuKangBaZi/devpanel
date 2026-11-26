import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Cpu,
  FolderSearch,
  Layers,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "../i18n";
import type {
  DetectedProject,
  ProjectCommand,
  ProjectConfig,
} from "../types/project";
import {
  getDefaultShellForPlatform,
  getShellPresetsForPlatform,
  type PlatformId,
} from "../utils/platform";
import {
  makeUniqueId,
  resolveCommandCwd,
  slugifyId,
} from "../utils/projectCommands";

interface EnvRow {
  uid: string;
  key: string;
  value: string;
}

interface CommandDraft {
  _uid: string;
  id: string;
  name: string;
  command: string;
  cwd: string;
  url: string;
  shell: string;
  envRows: EnvRow[];
  autoStart: boolean;
  showAdvanced: boolean;
}

interface ProjectModalProps {
  isOpen: boolean;
  editingProject: ProjectConfig | null;
  cloningProject?: ProjectConfig | null;
  existingIds: string[];
  groups: string[];
  defaultShell: string;
  platform: PlatformId;
  onClose: () => void;
  onSave: (project: ProjectConfig, previousId?: string) => Promise<void>;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-modal)]";

const INPUT_CLASS =
  "dp-input w-full rounded-md border border-[var(--dp-border)] bg-[var(--dp-input-bg)] px-3 py-1.5 text-xs text-[var(--dp-fg)] placeholder-[var(--dp-fg-muted)] transition-colors focus:border-[var(--dp-info)] focus:outline-none focus:ring-2 focus:ring-[var(--dp-info)]/25";

let draftSeq = 1;
function nextUid(prefix = "uid"): string {
  draftSeq += 1;
  return `${prefix}-${draftSeq}`;
}

function recordToEnvRows(env?: Record<string, string>): EnvRow[] {
  if (!env) return [];
  return Object.entries(env).map(([key, value]) => ({
    uid: nextUid("env"),
    key,
    value,
  }));
}

function envRowsToRecord(rows: EnvRow[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const k = row.key.trim();
    if (k) {
      out[k] = row.value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseDotEnvText(raw: string): EnvRow[] {
  const rows: EnvRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) {
      rows.push({ uid: nextUid("env"), key, value: val });
    }
  }
  return rows;
}

function EnvEditorBlock({
  rows,
  onChange,
  compact = false,
}: {
  rows: EnvRow[];
  onChange: (next: EnvRow[]) => void;
  compact?: boolean;
}) {
  const { m } = useI18n();
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const handleImportPaste = () => {
    const parsed = parseDotEnvText(pasteText);
    if (parsed.length > 0) {
      const merged = [...rows];
      for (const item of parsed) {
        const idx = merged.findIndex((r) => r.key.trim() === item.key);
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], value: item.value };
        } else {
          merged.push(item);
        }
      }
      onChange(merged);
    }
    setPasteText("");
    setPasteMode(false);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[var(--dp-fg-secondary)]">
          {m.projectModal.envTitle}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPasteMode((v) => !v)}
            className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--dp-info-text)] hover:bg-[var(--dp-info-soft)] ${FOCUS_RING}`}
          >
            {pasteMode ? m.projectModal.cancelImportEnv : m.projectModal.pasteDotEnv}
          </button>
          <button
            type="button"
            onClick={() =>
              onChange([...rows, { uid: nextUid("env"), key: "", value: "" }])
            }
            className={`inline-flex cursor-pointer items-center gap-0.5 rounded border border-[var(--dp-border)] bg-[var(--dp-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--dp-fg-secondary)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
          >
            <Plus className="h-2.5 w-2.5" aria-hidden="true" />
            {m.projectModal.addEnvVar}
          </button>
        </div>
      </div>

      {pasteMode && (
        <div className="space-y-1.5 rounded border border-[var(--dp-border)] bg-[var(--dp-bg)]/80 p-2">
          <textarea
            rows={3}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"PORT=3001\nRUST_LOG=info"}
            className={`${INPUT_CLASS} font-mono-dev text-[11px]`}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleImportPaste}
              className={`cursor-pointer rounded bg-[var(--dp-accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--dp-accent-fg)] hover:bg-[var(--dp-accent-hover)] ${FOCUS_RING}`}
            >
              {m.projectModal.parseAndAppend}
            </button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-1">
          {rows.map((row) => (
            <div key={row.uid} className="flex items-center gap-1.5">
              <input
                type="text"
                value={row.key}
                onChange={(e) =>
                  onChange(
                    rows.map((r) =>
                      r.uid === row.uid ? { ...r, key: e.target.value } : r
                    )
                  )
                }
                placeholder="KEY"
                aria-label={m.projectModal.envKeyAria}
                className={`${INPUT_CLASS} font-mono-dev ${
                  compact ? "w-28 py-1 text-[11px]" : "w-36 text-[11px]"
                }`}
              />
              <span className="text-[11px] text-[var(--dp-fg-muted)]">=</span>
              <input
                type="text"
                value={row.value}
                onChange={(e) =>
                  onChange(
                    rows.map((r) =>
                      r.uid === row.uid ? { ...r, value: e.target.value } : r
                    )
                  )
                }
                placeholder="VALUE"
                aria-label={m.projectModal.envValAria}
                className={`${INPUT_CLASS} font-mono-dev flex-1 ${
                  compact ? "py-1 text-[11px]" : "text-[11px]"
                }`}
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((r) => r.uid !== row.uid))}
                aria-label={m.projectModal.removeEnvAria}
                className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-danger-soft)] hover:text-[var(--dp-danger-text)] ${FOCUS_RING}`}
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectModal({
  isOpen,
  editingProject,
  cloningProject,
  existingIds,
  groups,
  defaultShell,
  platform,
  onClose,
  onSave,
}: ProjectModalProps) {
  const { m } = useI18n();
  const cloneSuffixRef = useRef(m.projectModal.cloneSuffix);
  cloneSuffixRef.current = m.projectModal.cloneSuffix;
  const isEditing = Boolean(editingProject);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const manualDirInputId = useId();
  const nameInputId = useId();
  const idInputId = useId();
  const cwdInputId = useId();
  const cmdInputId = useId();
  const shellInputId = useId();
  const urlInputId = useId();
  const groupInputId = useId();

  const [id, setId] = useState("");
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [command, setCommand] = useState("");
  const [shell, setShell] = useState("");
  const [url, setUrl] = useState("");
  const [group, setGroup] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [commands, setCommands] = useState<CommandDraft[]>([]);
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [autoStart, setAutoStart] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [hasChosenDir, setHasChosenDir] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectedProject | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Fallback light-dismiss for engines without <dialog closedby="any">
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;

    const handleClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!isDialogContent) {
        dialog.close();
      }
    };

    dialog.addEventListener("click", handleClick);
    return () => dialog.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const source = editingProject ?? cloningProject ?? null;
    if (source) {
      const isClone = !editingProject && Boolean(cloningProject);
      setId(isClone ? makeUniqueId(source.id, existingIds) : source.id);
      setIdManuallyEdited(!isClone);
      setName(isClone ? `${source.name}${cloneSuffixRef.current}` : source.name);
      setCwd(source.cwd);
      setCommand(source.command);
      setShell(source.shell ?? "");
      setUrl(source.url ?? "");
      const existingGroup = source.group?.trim() ?? "";
      setGroup(existingGroup);
      setCreatingGroup(
        Boolean(existingGroup) && !groups.includes(existingGroup)
      );
      setCommands(
        (source.commands ?? []).map((cmd) => {
          const cmdEnvRows = recordToEnvRows(cmd.env);
          return {
            _uid: nextUid("cmd"),
            id: cmd.id,
            name: cmd.name,
            command: cmd.command,
            cwd: cmd.cwd ?? "",
            url: cmd.url ?? "",
            shell: cmd.shell ?? "",
            envRows: cmdEnvRows,
            autoStart: Boolean(cmd.autoStart),
            showAdvanced: cmdEnvRows.length > 0 || Boolean(cmd.autoStart),
          };
        })
      );
      const rootEnvRows = recordToEnvRows(source.env);
      setEnvRows(rootEnvRows);
      setAutoStart(isClone ? false : Boolean(source.autoStart));
      setShowAdvanced(rootEnvRows.length > 0 || Boolean(!isClone && source.autoStart));
      setHasChosenDir(true);
    } else {
      setId("");
      setIdManuallyEdited(false);
      setName("");
      setCwd("");
      setCommand("");
      setShell("");
      setUrl("");
      setGroup("");
      setCreatingGroup(false);
      setCommands([]);
      setEnvRows([]);
      setAutoStart(false);
      setShowAdvanced(false);
      setHasChosenDir(false);
    }
    setDetected(null);
    setDetecting(false);
    setError(null);
    setSubmitting(false);
  }, [isOpen, editingProject, cloningProject, existingIds, groups]);

  const applyDetectedResult = (result: DetectedProject) => {
    setDetected(result);
    setHasChosenDir(true);
    setCwd(result.cwd);

    if (!isEditing) {
      setName(result.suggestedName);
      setId(makeUniqueId(result.suggestedId, existingIds));
      setIdManuallyEdited(false);
    } else if (!name.trim()) {
      setName(result.suggestedName);
    }

    if (result.group) {
      setGroup(result.group);
      setCreatingGroup(!groups.includes(result.group));
    }

    setCommand(result.command);
    if (result.commands.length >= 2) {
      setCommands(
        result.commands.map((opt) => ({
          _uid: nextUid("cmd"),
          id: opt.id,
          name: opt.label,
          command: opt.command,
          cwd: opt.cwd ?? "",
          url: opt.url ?? "",
          shell: "",
          envRows: [],
          autoStart: false,
          showAdvanced: false,
        }))
      );
    } else {
      setCommands([]);
    }

    const osDefault = getDefaultShellForPlatform(platform);
    const detectedShell = result.shell?.trim() ?? "";
    setShell(detectedShell && detectedShell !== osDefault ? detectedShell : "");
    setUrl(result.url ?? "");
    setError(null);
  };

  const handlePickDirectory = async () => {
    setDetecting(true);
    setError(null);
    try {
      const result = await invoke<DetectedProject | null>(
        "pick_project_directory"
      );
      if (result) {
        applyDetectedResult(result);
      }
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setDetecting(false);
    }
  };

  const handleDetectDirectory = async (targetPath: string) => {
    const trimmed = targetPath.trim();
    if (!trimmed) {
      setError(m.projectModal.errPickDirFirst);
      return;
    }
    setDetecting(true);
    setError(null);
    try {
      const result = await invoke<DetectedProject>("detect_project_dir", {
        cwd: trimmed,
      });
      applyDetectedResult(result);
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setDetecting(false);
    }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!isEditing && !idManuallyEdited) {
      setId(makeUniqueId(slugifyId(val), existingIds));
    }
  };

  const handleEnableMultiMode = () => {
    const firstCmd = command.trim();
    setCommands([
      {
        _uid: nextUid("cmd"),
        id: "mode-1",
        name: firstCmd
          ? m.projectModal.defaultPrimaryMode
          : m.projectModal.defaultModeN(1),
        command: firstCmd,
        cwd: "",
        url: "",
        shell: "",
        envRows: [],
        autoStart: false,
        showAdvanced: false,
      },
      {
        _uid: nextUid("cmd"),
        id: "mode-2",
        name: m.projectModal.defaultModeN(2),
        command: "",
        cwd: "",
        url: "",
        shell: "",
        envRows: [],
        autoStart: false,
        showAdvanced: false,
      },
    ]);
  };

  const handleAddCommandRow = () => {
    setCommands((prev) => [
      ...prev,
      {
        _uid: nextUid("cmd"),
        id: "",
        name: m.projectModal.defaultModeN(prev.length + 1),
        command: "",
        cwd: "",
        url: "",
        shell: "",
        envRows: [],
        autoStart: false,
        showAdvanced: false,
      },
    ]);
  };

  const handleUpdateCommandRow = (
    uid: string,
    patch: Partial<CommandDraft>
  ) => {
    setCommands((prev) =>
      prev.map((item) => (item._uid === uid ? { ...item, ...patch } : item))
    );
  };

  const handleMoveCommandRow = (idx: number, delta: -1 | 1) => {
    setCommands((prev) => {
      const target = idx + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleRemoveCommandRow = (idx: number) => {
    setCommands((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0 && prev[idx]) {
        setCommand(prev[idx].command);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedId = id.trim();
    const trimmedName = name.trim();
    const trimmedCwd = cwd.trim();
    const isMulti = commands.length > 0;

    if (!trimmedId || !trimmedName || !trimmedCwd) {
      setError(m.projectModal.errRequiredFields);
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
      setError(m.projectModal.errInvalidId);
      return;
    }

    const otherIds =
      isEditing && editingProject
        ? existingIds.filter((item) => item !== editingProject.id)
        : existingIds;
    if (otherIds.includes(trimmedId)) {
      setError(m.projectModal.errDuplicateId(trimmedId));
      return;
    }

    let finalCommand = command.trim();
    let finalCommands: ProjectCommand[] | undefined;

    if (isMulti) {
      const usedCmdIds: string[] = [];
      const built: ProjectCommand[] = [];
      for (let idx = 0; idx < commands.length; idx += 1) {
        const draft = commands[idx];
        const cmdName = draft.name.trim();
        const cmdLine = draft.command.trim();
        if (!cmdName || !cmdLine) {
          setError(m.projectModal.errEmptyModeFields(idx + 1));
          return;
        }
        const rawCid = draft.id.trim().replace(/::/g, "-");
        const baseCid = rawCid || slugifyId(cmdName) || `cmd-${idx + 1}`;
        const uniqueCid = makeUniqueId(baseCid, usedCmdIds, `cmd-${idx + 1}`);
        usedCmdIds.push(uniqueCid);

        built.push({
          id: uniqueCid,
          name: cmdName,
          command: cmdLine,
          cwd: draft.cwd.trim() || undefined,
          url: draft.url.trim() || undefined,
          shell: draft.shell.trim() || undefined,
          env: envRowsToRecord(draft.envRows),
          autoStart: draft.autoStart || undefined,
        });
      }
      finalCommands = built;
      finalCommand = built[0].command;
    } else if (!finalCommand) {
      setError(m.projectModal.errEmptyCommand);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onSave(
        {
          id: trimmedId,
          name: trimmedName,
          cwd: trimmedCwd,
          command: finalCommand,
          shell: shell.trim() || undefined,
          url: url.trim() || undefined,
          group: group.trim() || undefined,
          commands: finalCommands,
          env: envRowsToRecord(envRows),
          autoStart: autoStart || undefined,
        },
        editingProject?.id
      );
      onClose();
    } catch {
      setSubmitting(false);
    }
  };

  const showStepOnePicker = !isEditing && !cloningProject && !hasChosenDir;
  const shellPresets = getShellPresetsForPlatform(platform);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      {...({ closedby: "any" } as Record<string, string>)}
      style={{ boxShadow: "var(--dp-shadow)" }}
      className="devpanel-dialog m-auto max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-hidden rounded-xl border border-[var(--dp-border)] bg-[var(--dp-modal)] p-0 text-[var(--dp-fg)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--dp-border)] px-5 py-3.5 select-none">
        <div className="flex items-center gap-2">
          <h3 id={titleId} className="text-sm font-semibold text-[var(--dp-fg)]">
            {isEditing
              ? m.projectModal.titleEdit
              : cloningProject
                ? m.projectModal.titleClone
                : m.projectModal.titleNew}
          </h3>
          {!isEditing && !cloningProject && (
            <span className="rounded-full border border-[var(--dp-border)] bg-[var(--dp-surface)] px-2 py-0.5 text-[10px] font-medium text-[var(--dp-fg-secondary)]">
              {showStepOnePicker
                ? m.projectModal.step1Badge
                : m.projectModal.step2Badge}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={m.common.closeDialog}
          className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {showStepOnePicker ? (
        <div className="space-y-4 px-5 py-5">
          {error && (
            <div
              role="alert"
              className="rounded-md border border-[var(--dp-danger-border)] bg-[var(--dp-danger-soft)] px-3 py-2 text-xs text-[var(--dp-danger-text)]"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--dp-border-strong)] bg-[var(--dp-surface)]/50 px-5 py-7 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] text-[var(--dp-accent-text)]">
              <FolderSearch className="h-5 w-5" aria-hidden="true" />
            </div>
            <h4 className="mt-3 text-sm font-semibold text-[var(--dp-fg)]">
              {m.projectModal.step1Title}
            </h4>
            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--dp-fg-secondary)]">
              {m.projectModal.step1Desc}
            </p>
            <button
              type="button"
              disabled={detecting}
              onClick={handlePickDirectory}
              className={`mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--dp-accent)] px-4 py-2 text-xs font-semibold text-[var(--dp-accent-fg)] transition-colors hover:bg-[var(--dp-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
            >
              <FolderSearch className="h-4 w-4" aria-hidden="true" />
              {detecting
                ? m.projectModal.detectingBtn
                : m.projectModal.pickDirBtn}
            </button>
          </div>

          <div className="space-y-2 border-t border-[var(--dp-border)] pt-3.5">
            <label
              htmlFor={manualDirInputId}
              className="block text-[11px] font-medium text-[var(--dp-fg-secondary)]"
            >
              {m.projectModal.manualDirLabel}
            </label>
            <div className="flex gap-2">
              <input
                id={manualDirInputId}
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (e.nativeEvent.isComposing || e.keyCode === 229) {
                      return;
                    }
                    void handleDetectDirectory(cwd);
                  }
                }}
                placeholder={
                  platform === "windows"
                    ? m.projectModal.dirPlaceholderWin
                    : m.projectModal.dirPlaceholderUnix
                }
                className={`${INPUT_CLASS} font-mono-dev flex-1`}
              />
              <button
                type="button"
                disabled={detecting}
                onClick={() => handleDetectDirectory(cwd)}
                className={`shrink-0 cursor-pointer rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] px-3 py-1.5 text-xs font-medium text-[var(--dp-fg)] transition-colors hover:bg-[var(--dp-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
              >
                {m.projectModal.detectDirBtn}
              </button>
            </div>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setHasChosenDir(true);
                }}
                className={`cursor-pointer rounded px-1 py-0.5 text-[11px] text-[var(--dp-fg-muted)] underline-offset-2 hover:text-[var(--dp-fg)] hover:underline ${FOCUS_RING}`}
              >
                {m.projectModal.skipDetectBtn}
              </button>
              <button
                type="button"
                onClick={onClose}
                className={`cursor-pointer rounded-md border border-[var(--dp-border)] px-3 py-1 text-xs text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
              >
                {m.common.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="max-h-[calc(100vh-7rem)] space-y-3.5 overflow-y-auto px-5 py-4"
        >
          {error && (
            <div
              role="alert"
              className="rounded-md border border-[var(--dp-danger-border)] bg-[var(--dp-danger-soft)] px-3 py-2 text-xs text-[var(--dp-danger-text)]"
            >
              {error}
            </div>
          )}

          {/* Auto-detection Result Banner */}
          {detected && (
            <div className="rounded-lg border border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] px-3 py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles
                  className="h-3.5 w-3.5 shrink-0 text-[var(--dp-accent-text)]"
                  aria-hidden="true"
                />
                <span className="font-semibold text-[var(--dp-accent-text)]">
                  {detected.projectType}
                </span>
                {detected.packageManager && (
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--dp-accent-border)] bg-[var(--dp-bg)]/70 px-1.5 py-0.5 font-mono-dev text-[10px] text-[var(--dp-accent-text)]">
                    <Cpu className="h-2.5 w-2.5" aria-hidden="true" />
                    {detected.packageManager}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--dp-fg-secondary)]">
                {detected.summary}
              </p>
            </div>
          )}

          {/* Directory Field First with Pick & Re-detect Actions */}
          <div>
            <label
              htmlFor={cwdInputId}
              className="mb-1 block text-xs font-medium text-[var(--dp-fg-secondary)]"
            >
              {m.projectModal.cwdLabel}
            </label>
            <div className="flex gap-1.5">
              <input
                id={cwdInputId}
                type="text"
                required
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder={
                  platform === "windows"
                    ? m.projectModal.dirPlaceholderWin
                    : m.projectModal.dirPlaceholderUnix
                }
                className={`${INPUT_CLASS} font-mono-dev flex-1`}
              />
              <button
                type="button"
                disabled={detecting}
                onClick={handlePickDirectory}
                title={m.projectModal.browseTitle}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--dp-fg-secondary)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
              >
                <FolderSearch className="h-3.5 w-3.5" aria-hidden="true" />
                {m.projectModal.browseBtn}
              </button>
              <button
                type="button"
                disabled={detecting || !cwd.trim()}
                onClick={() => handleDetectDirectory(cwd)}
                title={m.projectModal.redetectTitle}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--dp-info-text)] transition-colors hover:bg-[var(--dp-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    detecting ? "motion-safe:animate-spin" : ""
                  }`}
                  aria-hidden="true"
                />
                {m.projectModal.redetectBtn}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={nameInputId}
                className="mb-1 block text-xs font-medium text-[var(--dp-fg-secondary)]"
              >
                {m.projectModal.nameLabel}
              </label>
              <input
                id={nameInputId}
                type="text"
                required
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder={m.projectModal.namePlaceholder}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label
                htmlFor={idInputId}
                className="mb-1 block text-xs font-medium text-[var(--dp-fg-secondary)]"
              >
                {m.projectModal.idLabel}
              </label>
              <input
                id={idInputId}
                type="text"
                required
                value={id}
                onChange={(e) => {
                  setIdManuallyEdited(true);
                  setId(e.target.value);
                }}
                placeholder={m.projectModal.idPlaceholder}
                className={`${INPUT_CLASS} font-mono-dev`}
              />
              {isEditing && editingProject && id.trim() !== editingProject.id && (
                <p className="mt-0.5 text-[10px] text-[var(--dp-warning-text)]">
                  {m.projectModal.idRenameHint}
                </p>
              )}
            </div>
          </div>

          {commands.length === 0 ? (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label
                  htmlFor={cmdInputId}
                  className="text-xs font-medium text-[var(--dp-fg-secondary)]"
                >
                  {m.projectModal.commandLabel}
                </label>
                <button
                  type="button"
                  onClick={handleEnableMultiMode}
                  className={`inline-flex cursor-pointer items-center gap-1 rounded border border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--dp-info-text)] transition-colors hover:opacity-90 ${FOCUS_RING}`}
                >
                  <Layers className="h-3 w-3" aria-hidden="true" />
                  {m.projectModal.multiModeBtn}
                </button>
              </div>
              <input
                id={cmdInputId}
                type="text"
                required
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={m.projectModal.commandPlaceholder}
                className={`${INPUT_CLASS} font-mono-dev`}
              />

              {detected && detected.alternatives.length > 1 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-[var(--dp-fg-muted)]">
                    {m.projectModal.availableCommands}
                  </span>
                  {detected.alternatives.map((opt) => {
                    const resolvedOptCwd = resolveCommandCwd(
                      detected.cwd,
                      opt.cwd
                    );
                    const active =
                      command.trim() === opt.command &&
                      cwd.trim() === resolvedOptCwd;
                    return (
                      <button
                        key={`${opt.cwd ?? ""}:${opt.command}`}
                        type="button"
                        onClick={() => {
                          setCommand(opt.command);
                          setCwd(resolvedOptCwd);
                          if (opt.url) {
                            setUrl(opt.url);
                          }
                        }}
                        title={
                          opt.cwd
                            ? `[${opt.cwd}] ${opt.command}`
                            : opt.command
                        }
                        className={`cursor-pointer rounded border px-2 py-0.5 font-mono-dev text-[10px] transition-colors ${
                          active
                            ? "border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] text-[var(--dp-accent-text)]"
                            : "border-[var(--dp-border)] bg-[var(--dp-surface)] text-[var(--dp-fg-secondary)] hover:border-[var(--dp-border-strong)] hover:text-[var(--dp-fg)]"
                        } ${FOCUS_RING}`}
                      >
                        {opt.label}: {opt.command}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-[var(--dp-border)] bg-[var(--dp-bg)]/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--dp-fg)]">
                  <Layers
                    className="h-3.5 w-3.5 text-[var(--dp-info)]"
                    aria-hidden="true"
                  />
                  {m.projectModal.commandListLabel(commands.length)}
                </span>
                <div className="flex items-center gap-1.5">
                  {commands.length === 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCommand(commands[0].command);
                        setCommands([]);
                      }}
                      className={`cursor-pointer rounded border border-[var(--dp-border)] px-2 py-0.5 text-[11px] text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                    >
                      {m.projectModal.switchSingleMode}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleAddCommandRow}
                    className={`inline-flex cursor-pointer items-center gap-1 rounded border border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--dp-accent-text)] transition-colors hover:opacity-90 ${FOCUS_RING}`}
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    {m.projectModal.addCommandBtn}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {commands.map((draft, idx) => (
                  <div
                    key={draft._uid}
                    className="space-y-2 rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold tracking-wide text-[var(--dp-fg-muted)] uppercase">
                        {m.projectModal.modeItemHeader(idx + 1)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateCommandRow(draft._uid, {
                              showAdvanced: !draft.showAdvanced,
                            })
                          }
                          className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                        >
                          {draft.showAdvanced
                            ? m.projectModal.hideAdvanced
                            : m.projectModal.showAdvanced}
                          {(draft.envRows.length > 0 || draft.autoStart) &&
                            " •"}
                        </button>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveCommandRow(idx, -1)}
                          aria-label={m.common.moveUp}
                          title={m.common.moveUp}
                          className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] disabled:cursor-not-allowed disabled:opacity-35 ${FOCUS_RING}`}
                        >
                          <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === commands.length - 1}
                          onClick={() => handleMoveCommandRow(idx, 1)}
                          aria-label={m.common.moveDown}
                          title={m.common.moveDown}
                          className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] disabled:cursor-not-allowed disabled:opacity-35 ${FOCUS_RING}`}
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveCommandRow(idx)}
                          aria-label={m.projectModal.removeModeAria(idx + 1)}
                          title={
                            commands.length === 1
                              ? m.projectModal.removeLastModeTitle
                              : m.projectModal.removeModeTitle
                          }
                          className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-danger-soft)] hover:text-[var(--dp-danger-text)] ${FOCUS_RING}`}
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <input
                        type="text"
                        value={draft.name}
                        onChange={(e) =>
                          handleUpdateCommandRow(draft._uid, {
                            name: e.target.value,
                          })
                        }
                        placeholder={m.projectModal.modeNamePlaceholder}
                        aria-label={m.projectModal.modeNameAria(idx + 1)}
                        className={INPUT_CLASS}
                      />
                      <input
                        type="text"
                        value={draft.command}
                        onChange={(e) =>
                          handleUpdateCommandRow(draft._uid, {
                            command: e.target.value,
                          })
                        }
                        placeholder={m.projectModal.modeCmdPlaceholder}
                        aria-label={m.projectModal.modeCmdAria(idx + 1)}
                        className={`${INPUT_CLASS} font-mono-dev sm:col-span-2`}
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <input
                        type="text"
                        value={draft.cwd}
                        onChange={(e) =>
                          handleUpdateCommandRow(draft._uid, {
                            cwd: e.target.value,
                          })
                        }
                        placeholder={m.projectModal.modeCwdPlaceholder}
                        aria-label={m.projectModal.modeCwdAria(idx + 1)}
                        className={`${INPUT_CLASS} font-mono-dev text-[11px]`}
                      />
                      <input
                        type="text"
                        value={draft.url}
                        onChange={(e) =>
                          handleUpdateCommandRow(draft._uid, {
                            url: e.target.value,
                          })
                        }
                        placeholder={m.projectModal.modeUrlPlaceholder}
                        aria-label={m.projectModal.modeUrlAria(idx + 1)}
                        className={`${INPUT_CLASS} font-mono-dev text-[11px]`}
                      />
                      <input
                        type="text"
                        value={draft.shell}
                        onChange={(e) =>
                          handleUpdateCommandRow(draft._uid, {
                            shell: e.target.value,
                          })
                        }
                        placeholder={m.projectModal.modeShellPlaceholder}
                        aria-label={m.projectModal.modeShellAria(idx + 1)}
                        className={`${INPUT_CLASS} font-mono-dev text-[11px]`}
                      />
                    </div>

                    {draft.showAdvanced && (
                      <div className="space-y-2 border-t border-[var(--dp-border-subtle)] pt-2">
                        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--dp-fg-secondary)]">
                          <input
                            type="checkbox"
                            checked={draft.autoStart}
                            onChange={(e) =>
                              handleUpdateCommandRow(draft._uid, {
                                autoStart: e.target.checked,
                              })
                            }
                            className="h-3.5 w-3.5 rounded border-[var(--dp-border-strong)] accent-[var(--dp-accent)]"
                          />
                          {m.projectModal.modeAutoStart}
                        </label>
                        <EnvEditorBlock
                          compact
                          rows={draft.envRows}
                          onChange={(nextRows) =>
                            handleUpdateCommandRow(draft._uid, {
                              envRows: nextRows,
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {detected && detected.alternatives.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-[var(--dp-fg-muted)]">
                    {m.projectModal.quickAppend}
                  </span>
                  {detected.alternatives.map((opt) => {
                    const exists = commands.some(
                      (c) =>
                        c.command.trim() === opt.command &&
                        c.cwd.trim() === (opt.cwd ?? "")
                    );
                    return (
                      <button
                        key={`${opt.cwd ?? ""}:${opt.command}`}
                        type="button"
                        disabled={exists}
                        onClick={() =>
                          setCommands((prev) => [
                            ...prev,
                            {
                              _uid: nextUid("cmd"),
                              id: opt.id,
                              name: opt.label,
                              command: opt.command,
                              cwd: opt.cwd ?? "",
                              url: opt.url ?? "",
                              shell: "",
                              envRows: [],
                              autoStart: false,
                              showAdvanced: false,
                            },
                          ])
                        }
                        title={
                          opt.cwd
                            ? `[${opt.cwd}] ${opt.command}`
                            : opt.command
                        }
                        className={`cursor-pointer rounded border px-2 py-0.5 font-mono-dev text-[10px] transition-colors disabled:cursor-default ${
                          exists
                            ? "border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)] text-[var(--dp-accent-text)] opacity-85"
                            : "border-[var(--dp-border)] bg-[var(--dp-surface)] text-[var(--dp-fg-secondary)] hover:border-[var(--dp-info-border)] hover:text-[var(--dp-fg)]"
                        } ${FOCUS_RING}`}
                      >
                        {exists ? "✓ " : "+ "}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={shellInputId}
                className="mb-1 block text-xs font-medium text-[var(--dp-fg-secondary)]"
              >
                {m.projectModal.shellLabel}
              </label>
              <input
                id={shellInputId}
                type="text"
                value={shell}
                onChange={(e) => setShell(e.target.value)}
                placeholder={m.projectModal.shellPlaceholder(defaultShell)}
                className={`${INPUT_CLASS} font-mono-dev`}
              />
              <div className="mt-1 flex flex-wrap gap-1">
                {shellPresets.map((preset) => {
                  const active = shell.trim().toLowerCase() === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setShell(preset)}
                      className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono-dev text-[10px] transition-colors ${
                        active
                          ? "border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] text-[var(--dp-info-text)]"
                          : "border-[var(--dp-border)] bg-[var(--dp-surface)] text-[var(--dp-fg-muted)] hover:text-[var(--dp-fg)]"
                      } ${FOCUS_RING}`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label
                htmlFor={urlInputId}
                className="mb-1 block text-xs font-medium text-[var(--dp-fg-secondary)]"
              >
                {m.projectModal.urlLabel}
              </label>
              <input
                id={urlInputId}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={m.projectModal.urlPlaceholder}
                className={`${INPUT_CLASS} font-mono-dev`}
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label
                htmlFor={groupInputId}
                className="text-xs font-medium text-[var(--dp-fg-secondary)]"
              >
                {m.projectModal.groupLabel}
              </label>
              <button
                type="button"
                onClick={() => {
                  if (creatingGroup) {
                    setCreatingGroup(false);
                    if (!groups.includes(group)) setGroup("");
                  } else {
                    setCreatingGroup(true);
                    setGroup("");
                  }
                }}
                className={`cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--dp-info-text)] hover:bg-[var(--dp-info-soft)] ${FOCUS_RING}`}
              >
                {creatingGroup
                  ? m.projectModal.selectExistingGroup
                  : m.projectModal.newGroupBtn}
              </button>
            </div>
            {creatingGroup || groups.length === 0 ? (
              <input
                id={groupInputId}
                type="text"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder={m.projectModal.newGroupPlaceholder}
                className={INPUT_CLASS}
              />
            ) : (
              <select
                id={groupInputId}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">{m.projectModal.noGroupOption}</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Collapsible Environment Variables & Auto-start */}
          <div className="rounded-lg border border-[var(--dp-border)] bg-[var(--dp-surface)]/50">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className={`flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs font-medium text-[var(--dp-fg-secondary)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              <span className="inline-flex items-center gap-1.5">
                {showAdvanced ? (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {m.projectModal.envAndAutoStart}
                {(envRows.length > 0 || autoStart) && (
                  <span className="rounded-full border border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] px-1.5 py-0.5 text-[10px] text-[var(--dp-info-text)]">
                    {m.projectModal.configuredBadge}
                  </span>
                )}
              </span>
            </button>

            {showAdvanced && (
              <div className="space-y-3 border-t border-[var(--dp-border-subtle)] px-3 py-2.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--dp-fg-secondary)]">
                  <input
                    type="checkbox"
                    checked={autoStart}
                    onChange={(e) => setAutoStart(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[var(--dp-border-strong)] accent-[var(--dp-accent)]"
                  />
                  {m.projectModal.projectAutoStart(commands.length > 0)}
                </label>

                <EnvEditorBlock rows={envRows} onChange={setEnvRows} />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--dp-border)] pt-3.5 select-none">
            <button
              type="button"
              onClick={onClose}
              className={`cursor-pointer rounded-md border border-[var(--dp-border)] px-3.5 py-1.5 text-xs font-medium text-[var(--dp-fg-secondary)] transition-colors hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
            >
              {m.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`cursor-pointer rounded-md bg-[var(--dp-accent)] px-4 py-1.5 text-xs font-semibold text-[var(--dp-accent-fg)] transition-colors hover:bg-[var(--dp-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
            >
              {submitting ? m.common.saving : m.common.save}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
