import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, X, Zap } from "lucide-react";
import { useI18n } from "../i18n";
import type {
  BindingTarget,
  LaunchBinding,
  ProjectConfig,
} from "../types/project";
import {
  isMultiCommandProject,
  makeSessionKey,
  makeUniqueId,
  slugifyId,
} from "../utils/projectCommands";

interface BindingModalProps {
  isOpen: boolean;
  editingBinding: LaunchBinding | null;
  existingBindingIds: string[];
  projects: ProjectConfig[];
  groups: string[];
  onClose: () => void;
  onSave: (binding: LaunchBinding) => Promise<void>;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-modal)]";

const INPUT_CLASS =
  "dp-input w-full rounded-md border border-[var(--dp-border)] bg-[var(--dp-input-bg)] px-3 py-1.5 text-xs text-[var(--dp-fg)] placeholder-[var(--dp-fg-muted)] transition-colors focus:border-[var(--dp-info)] focus:outline-none focus:ring-2 focus:ring-[var(--dp-info)]/25";

export function BindingModal({
  isOpen,
  editingBinding,
  existingBindingIds,
  projects,
  groups,
  onClose,
  onSave,
}: BindingModalProps) {
  const { m } = useI18n();
  const isEditing = Boolean(editingBinding);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const nameInputId = useId();
  const descInputId = useId();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [sequential, setSequential] = useState(false);
  const [delayMs, setDelayMs] = useState(1000);
  const [autoStart, setAutoStart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;

    const handleClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) {
        dialog.close();
      }
    };

    dialog.addEventListener("click", handleClick);
    return () => dialog.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (editingBinding) {
      setName(editingBinding.name);
      setDescription(editingBinding.description ?? "");
      const keys = editingBinding.targets.map((t) =>
        makeSessionKey(t.projectId, t.commandId)
      );
      setSelectedKeys(Array.from(new Set(keys)));
      setSequential(Boolean(editingBinding.sequential));
      setDelayMs(editingBinding.delayMs ?? 1000);
      setAutoStart(Boolean(editingBinding.autoStart));
    } else {
      setName("");
      setDescription("");
      setSelectedKeys([]);
      setSequential(false);
      setDelayMs(1000);
      setAutoStart(false);
    }
    setError(null);
    setSubmitting(false);
  }, [isOpen, editingBinding]);

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const selectGroupTargets = (groupName: string) => {
    const groupKeys: string[] = [];
    for (const p of projects) {
      if (p.group?.trim() !== groupName) continue;
      if (p.commands && p.commands.length > 0) {
        for (const cmd of p.commands) {
          groupKeys.push(makeSessionKey(p.id, cmd.id));
        }
      } else {
        groupKeys.push(p.id);
      }
    }
    if (groupKeys.length === 0) return;
    setSelectedKeys((prev) => Array.from(new Set([...prev, ...groupKeys])));
  };

  const keyToTargetMap = useMemo(() => {
    const map = new Map<string, BindingTarget>();
    for (const p of projects) {
      if (p.commands && p.commands.length > 0) {
        for (const cmd of p.commands) {
          map.set(makeSessionKey(p.id, cmd.id), {
            projectId: p.id,
            commandId: cmd.id,
          });
        }
      } else {
        map.set(p.id, { projectId: p.id });
      }
    }
    return map;
  }, [projects]);

  const activeGroups = useMemo(
    () =>
      groups.filter((g) => projects.some((p) => p.group?.trim() === g)),
    [groups, projects]
  );

  const moveSelectedKey = (index: number, delta: -1 | 1) => {
    setSelectedKeys((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const keyToLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      if (p.commands && p.commands.length > 0) {
        for (const cmd of p.commands) {
          map.set(makeSessionKey(p.id, cmd.id), `${p.name} · ${cmd.name}`);
        }
      } else {
        map.set(p.id, p.name);
      }
    }
    return map;
  }, [projects]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(m.bindingModal.errEmptyName);
      return;
    }

    const targets: BindingTarget[] = [];
    for (const key of selectedKeys) {
      const target = keyToTargetMap.get(key);
      if (target) {
        targets.push(target);
      }
    }

    if (targets.length === 0) {
      setError(m.bindingModal.errNoTarget);
      return;
    }

    const bindingId = editingBinding
      ? editingBinding.id
      : makeUniqueId(
          slugifyId(trimmedName) || "binding",
          existingBindingIds,
          "binding"
        );

    setSubmitting(true);
    setError(null);
    try {
      await onSave({
        id: bindingId,
        name: trimmedName,
        description: description.trim() || undefined,
        targets,
        sequential: sequential || undefined,
        delayMs: sequential ? Math.max(0, Math.round(delayMs)) : undefined,
        autoStart: autoStart || undefined,
      });
      onClose();
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      {...({ closedby: "any" } as Record<string, string>)}
      style={{ boxShadow: "var(--dp-shadow)" }}
      className="devpanel-dialog m-auto max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-xl border border-[var(--dp-border)] bg-[var(--dp-modal)] p-0 text-[var(--dp-fg)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--dp-border)] px-5 py-3.5 select-none">
        <div className="flex items-center gap-2">
          <Zap
            className="h-4 w-4 text-[var(--dp-accent)]"
            aria-hidden="true"
          />
          <h3 id={titleId} className="text-sm font-semibold text-[var(--dp-fg)]">
            {isEditing ? m.bindingModal.titleEdit : m.bindingModal.titleNew}
          </h3>
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

        <div>
          <label
            htmlFor={nameInputId}
            className="mb-1 block text-xs font-medium text-[var(--dp-fg-secondary)]"
          >
            {m.bindingModal.nameLabel}
          </label>
          <input
            id={nameInputId}
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={m.bindingModal.namePlaceholder}
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label
            htmlFor={descInputId}
            className="mb-1 block text-xs font-medium text-[var(--dp-fg-secondary)]"
          >
            {m.bindingModal.descLabel}
          </label>
          <input
            id={descInputId}
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={m.bindingModal.descPlaceholder}
            className={INPUT_CLASS}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--dp-fg-secondary)]">
              {m.bindingModal.selectTargetsLabel}
            </span>
            <span className="rounded-full border border-[var(--dp-info-border)] bg-[var(--dp-info-soft)] px-2 py-0.5 text-[10px] font-medium tabular-nums text-[var(--dp-info-text)]">
              {m.bindingModal.selectedCount(selectedKeys.length)}
            </span>
          </div>

          {activeGroups.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-[var(--dp-fg-muted)]">
                {m.bindingModal.quickSelectByGroup}
              </span>
              {activeGroups.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => selectGroupTargets(g)}
                  className={`cursor-pointer rounded border border-[var(--dp-border)] bg-[var(--dp-surface)] px-2 py-0.5 text-[10px] font-medium text-[var(--dp-fg-secondary)] transition-colors hover:border-[var(--dp-info-border)] hover:text-[var(--dp-info-text)] ${FOCUS_RING}`}
                >
                  + {g}
                </button>
              ))}
            </div>
          )}

          {projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--dp-border-strong)] bg-[var(--dp-surface)]/40 px-4 py-6 text-center text-xs text-[var(--dp-fg-muted)]">
              {m.bindingModal.noProjectsHint}
            </div>
          ) : (
            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-[var(--dp-border)] bg-[var(--dp-bg)]/60 p-2">
              {projects.map((project) => {
                const isMulti = isMultiCommandProject(project);
                if (!isMulti) {
                  const checked = selectedKeys.includes(project.id);
                  return (
                    <label
                      key={project.id}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                        checked
                          ? "border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)]"
                          : "border-transparent bg-[var(--dp-surface)] hover:border-[var(--dp-border)]"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleKey(project.id)}
                          className="sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            checked
                              ? "border-[var(--dp-accent)] bg-[var(--dp-accent)] text-[var(--dp-accent-fg)]"
                              : "border-[var(--dp-border-strong)] bg-[var(--dp-input-bg)]"
                          }`}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-[var(--dp-fg)]">
                            {project.name}
                          </span>
                          <span className="block truncate font-mono-dev text-[10px] text-[var(--dp-fg-muted)]">
                            $ {project.command}
                          </span>
                        </span>
                      </span>
                      {project.group && groups.includes(project.group) && (
                        <span className="shrink-0 rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-1.5 py-0.5 text-[10px] text-[var(--dp-fg-muted)]">
                          {project.group}
                        </span>
                      )}
                    </label>
                  );
                }

                return (
                  <div
                    key={project.id}
                    className="space-y-1 rounded-md border border-[var(--dp-border)] bg-[var(--dp-surface)] p-2"
                  >
                    <div className="flex items-center justify-between gap-2 px-1">
                      <span className="truncate text-xs font-semibold text-[var(--dp-fg)]">
                        {project.name}
                      </span>
                      {project.group && groups.includes(project.group) && (
                        <span className="shrink-0 rounded border border-[var(--dp-border)] bg-[var(--dp-bg)] px-1.5 py-0.5 text-[10px] text-[var(--dp-fg-muted)]">
                          {project.group}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 pl-1">
                      {(project.commands ?? []).map((cmd) => {
                        const key = makeSessionKey(project.id, cmd.id);
                        const checked = selectedKeys.includes(key);
                        return (
                          <label
                            key={key}
                            className={`flex cursor-pointer items-center justify-between gap-2 rounded border px-2 py-1.5 transition-colors ${
                              checked
                                ? "border-[var(--dp-accent-border)] bg-[var(--dp-accent-soft)]"
                                : "border-transparent bg-[var(--dp-bg)]/60 hover:border-[var(--dp-border)]"
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleKey(key)}
                                className="sr-only"
                              />
                              <span
                                aria-hidden="true"
                                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                                  checked
                                    ? "border-[var(--dp-accent)] bg-[var(--dp-accent)] text-[var(--dp-accent-fg)]"
                                    : "border-[var(--dp-border-strong)] bg-[var(--dp-input-bg)]"
                                }`}
                              >
                                {checked && <Check className="h-2.5 w-2.5" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-[11px] font-medium text-[var(--dp-fg)]">
                                  {cmd.name}
                                </span>
                                <span className="block truncate font-mono-dev text-[10px] text-[var(--dp-fg-muted)]">
                                  {cmd.command}
                                </span>
                              </span>
                            </span>
                            {cmd.cwd && (
                              <span className="shrink-0 rounded border border-[var(--dp-border)] bg-[var(--dp-surface)] px-1 py-px font-mono-dev text-[9px] text-[var(--dp-fg-muted)]">
                                {cmd.cwd}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Launch Strategy & Auto-start */}
        <div className="space-y-2.5 rounded-lg border border-[var(--dp-border)] bg-[var(--dp-surface)]/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--dp-fg)]">
              <input
                type="checkbox"
                checked={sequential}
                onChange={(e) => setSequential(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-[var(--dp-border-strong)] accent-[var(--dp-accent)]"
              />
              {m.bindingModal.sequentialLabel}
            </label>

            {sequential && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[var(--dp-fg-muted)]">
                  {m.bindingModal.delayLabel}
                </span>
                <input
                  type="number"
                  min={0}
                  max={30000}
                  step={100}
                  value={delayMs}
                  onChange={(e) =>
                    setDelayMs(Math.max(0, Number(e.target.value) || 0))
                  }
                  aria-label={m.bindingModal.delayAria}
                  className="dp-input w-20 rounded border border-[var(--dp-border)] bg-[var(--dp-input-bg)] px-2 py-1 text-right font-mono-dev text-[11px] text-[var(--dp-fg)]"
                />
                <span className="text-[11px] text-[var(--dp-fg-muted)]">ms</span>
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--dp-fg-secondary)]">
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => setAutoStart(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--dp-border-strong)] accent-[var(--dp-accent)]"
            />
            {m.bindingModal.autoStartLabel}
          </label>

          {sequential && selectedKeys.length >= 2 && (
            <div className="space-y-1 border-t border-[var(--dp-border-subtle)] pt-2">
              <div className="text-[10px] font-medium text-[var(--dp-fg-muted)]">
                {m.bindingModal.orderHeader}
              </div>
              <div className="space-y-1">
                {selectedKeys.map((key, idx) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 rounded border border-[var(--dp-border)] bg-[var(--dp-bg)]/70 px-2 py-1 text-[11px]"
                  >
                    <span className="truncate text-[var(--dp-fg-secondary)]">
                      <span className="mr-1.5 font-mono-dev text-[10px] text-[var(--dp-fg-muted)]">
                        {idx + 1}.
                      </span>
                      {keyToLabelMap.get(key) ?? key}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveSelectedKey(idx, -1)}
                        aria-label={m.bindingModal.moveOrderUpAria}
                        className={`cursor-pointer rounded p-0.5 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] disabled:opacity-30 ${FOCUS_RING}`}
                      >
                        <ArrowUp className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === selectedKeys.length - 1}
                        onClick={() => moveSelectedKey(idx, 1)}
                        aria-label={m.bindingModal.moveOrderDownAria}
                        className={`cursor-pointer rounded p-0.5 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] disabled:opacity-30 ${FOCUS_RING}`}
                      >
                        <ArrowDown className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--dp-border)] pt-3.5 select-none">
          <button
            type="button"
            onClick={onClose}
            className={`cursor-pointer rounded-md border border-[var(--dp-border)] px-3.5 py-1.5 text-xs font-medium text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
          >
            {m.common.cancel}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`cursor-pointer rounded-md bg-[var(--dp-accent)] px-4 py-1.5 text-xs font-semibold text-[var(--dp-accent-fg)] transition-colors hover:bg-[var(--dp-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
          >
            {submitting ? m.common.saving : m.bindingModal.saveBinding}
          </button>
        </div>
      </form>
    </dialog>
  );
}
