import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  FolderKanban,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "../i18n";
import type { ProjectConfig } from "../types/project";

interface GroupManagerModalProps {
  isOpen: boolean;
  groups: string[];
  projects: ProjectConfig[];
  onClose: () => void;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (oldName: string, newName: string) => Promise<void>;
  onDeleteGroup: (name: string) => Promise<void>;
  onReorderGroups: (orderedNames: string[]) => Promise<void>;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-modal)]";

const INPUT_CLASS =
  "dp-input w-full rounded-md border border-[var(--dp-border)] bg-[var(--dp-input-bg)] px-3 py-1.5 text-xs text-[var(--dp-fg)] placeholder-[var(--dp-fg-muted)] transition-colors focus:border-[var(--dp-info)] focus:outline-none focus:ring-2 focus:ring-[var(--dp-info)]/25";

export function GroupManagerModal({
  isOpen,
  groups,
  projects,
  onClose,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onReorderGroups,
}: GroupManagerModalProps) {
  const { m } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const newGroupInputId = useId();

  const [newName, setNewName] = useState("");
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setNewName("");
    setEditingGroup(null);
    setRenameDraft("");
    setConfirmDelete(null);
    setError(null);
    setBusy(false);
  }, [isOpen]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setError(m.groupModal.errEmptyName);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreateGroup(trimmed);
      setNewName("");
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRename = async () => {
    if (!editingGroup) return;
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setError(m.groupModal.errEmptyNewName);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRenameGroup(editingGroup, trimmed);
      setEditingGroup(null);
      setRenameDraft("");
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      await onDeleteGroup(name);
      setConfirmDelete(null);
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleMoveGroup = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= groups.length) return;
    const next = [...groups];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setBusy(true);
    setError(null);
    try {
      await onReorderGroups(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      {...({ closedby: "any" } as Record<string, string>)}
      style={{ boxShadow: "var(--dp-shadow)" }}
      className="devpanel-dialog m-auto max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-md overflow-hidden rounded-xl border border-[var(--dp-border)] bg-[var(--dp-modal)] p-0 text-[var(--dp-fg)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--dp-border)] px-5 py-3.5 select-none">
        <div className="flex items-center gap-2">
          <FolderKanban
            className="h-4 w-4 text-[var(--dp-info)]"
            aria-hidden="true"
          />
          <h3 id={titleId} className="text-sm font-semibold text-[var(--dp-fg)]">
            {m.groupModal.title}
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

      <div className="space-y-4 px-5 py-4">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-[var(--dp-danger-border)] bg-[var(--dp-danger-soft)] px-3 py-2 text-xs text-[var(--dp-danger-text)]"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-1.5">
          <label
            htmlFor={newGroupInputId}
            className="block text-xs font-medium text-[var(--dp-fg-secondary)]"
          >
            {m.groupModal.newGroupLabel}
          </label>
          <div className="flex gap-2">
            <input
              id={newGroupInputId}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={m.groupModal.newGroupPlaceholder}
              className={`${INPUT_CLASS} flex-1`}
            />
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-[var(--dp-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--dp-accent-fg)] transition-colors hover:bg-[var(--dp-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {m.groupModal.createBtn}
            </button>
          </div>
        </form>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-[var(--dp-fg-muted)]">
            <span>{m.groupModal.existingCount(groups.length)}</span>
            <span>{m.groupModal.deleteKeepProjectsHint}</span>
          </div>

          {groups.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--dp-border-strong)] bg-[var(--dp-surface)]/40 px-4 py-6 text-center text-xs text-[var(--dp-fg-muted)]">
              {m.groupModal.emptyGroupsHint}
            </div>
          ) : (
            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
              {groups.map((groupName, idx) => {
                const count = projects.filter(
                  (p) => p.group?.trim() === groupName
                ).length;
                const isRenaming = editingGroup === groupName;
                const isConfirming = confirmDelete === groupName;

                return (
                  <div
                    key={groupName}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--dp-border)] bg-[var(--dp-surface)] px-3 py-2"
                  >
                    {isRenaming ? (
                      <div className="flex flex-1 items-center gap-1.5">
                        <input
                          type="text"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (e.nativeEvent.isComposing || e.keyCode === 229) {
                                return;
                              }
                              void handleSaveRename();
                            } else if (e.key === "Escape") {
                              e.stopPropagation();
                              setEditingGroup(null);
                            }
                          }}
                          autoFocus
                          aria-label={m.groupModal.newGroupNameAria}
                          className={`${INPUT_CLASS} flex-1 py-1`}
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleSaveRename}
                          aria-label={m.groupModal.saveRenameAria}
                          className={`cursor-pointer rounded bg-[var(--dp-accent)] p-1.5 text-[var(--dp-accent-fg)] hover:bg-[var(--dp-accent-hover)] ${FOCUS_RING}`}
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingGroup(null)}
                          aria-label={m.groupModal.cancelRenameAria}
                          className={`cursor-pointer rounded border border-[var(--dp-border)] p-1.5 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] ${FOCUS_RING}`}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-xs font-medium text-[var(--dp-fg)]">
                            {groupName}
                          </span>
                          <span className="shrink-0 rounded-full border border-[var(--dp-border)] bg-[var(--dp-bg)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--dp-fg-muted)]">
                            {m.groupModal.projectsCount(count)}
                          </span>
                        </div>

                        <div className="flex shrink-0 items-center gap-1 select-none">
                          <button
                            type="button"
                            disabled={busy || idx === 0}
                            onClick={() => void handleMoveGroup(idx, -1)}
                            aria-label={m.groupModal.moveUpAria(groupName)}
                            title={m.common.moveUp}
                            className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] disabled:cursor-not-allowed disabled:opacity-30 ${FOCUS_RING}`}
                          >
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={busy || idx === groups.length - 1}
                            onClick={() => void handleMoveGroup(idx, 1)}
                            aria-label={m.groupModal.moveDownAria(groupName)}
                            title={m.common.moveDown}
                            className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] disabled:cursor-not-allowed disabled:opacity-30 ${FOCUS_RING}`}
                          >
                            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setConfirmDelete(null);
                              setEditingGroup(groupName);
                              setRenameDraft(groupName);
                            }}
                            aria-label={m.groupModal.renameAria(groupName)}
                            title={m.groupModal.renameTitle}
                            className={`cursor-pointer rounded p-1 text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>

                          {isConfirming ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleDelete(groupName)}
                              onMouseLeave={() => setConfirmDelete(null)}
                              className={`cursor-pointer rounded bg-[var(--dp-danger)] px-2 py-0.5 text-[10px] font-semibold text-[var(--dp-danger-fg)] hover:bg-[var(--dp-danger-hover)] ${FOCUS_RING}`}
                            >
                              {m.common.confirmDelete}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setConfirmDelete(groupName)}
                              aria-label={m.groupModal.deleteGroupAria(groupName)}
                              title={m.groupModal.deleteGroupTitle}
                              className={`cursor-pointer rounded p-1 text-[var(--dp-fg-muted)] hover:bg-[var(--dp-danger-soft)] hover:text-[var(--dp-danger-text)] ${FOCUS_RING}`}
                            >
                              <Trash2
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--dp-border)] pt-3 select-none">
          <button
            type="button"
            onClick={onClose}
            className={`cursor-pointer rounded-md border border-[var(--dp-border)] px-3.5 py-1.5 text-xs font-medium text-[var(--dp-fg-secondary)] hover:bg-[var(--dp-surface-hover)] hover:text-[var(--dp-fg)] ${FOCUS_RING}`}
          >
            {m.common.close}
          </button>
        </div>
      </div>
    </dialog>
  );
}
