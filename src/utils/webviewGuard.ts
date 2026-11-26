export type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

const BLOCKED_FUNCTION_KEYS = new Set(["F3", "F5", "F7", "F12"]);
const BLOCKED_CTRL_SHIFT_KEYS = new Set(["i", "j", "c", "r"]);
const BLOCKED_CTRL_KEYS = new Set([
  "r",
  "p",
  "s",
  "u",
  "g",
  "h",
  "l",
  "=",
  "+",
  "-",
  "0",
]);

export function shouldBlockBrowserShortcut(event: KeyEventLike): boolean {
  if (BLOCKED_FUNCTION_KEYS.has(event.key)) {
    return true;
  }

  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    (event.key === "ArrowLeft" || event.key === "ArrowRight")
  ) {
    return true;
  }

  const hasPrimary = event.ctrlKey || event.metaKey;
  if (!hasPrimary || event.altKey) {
    return false;
  }

  const key = event.key.toLowerCase();
  if (event.shiftKey) {
    return BLOCKED_CTRL_SHIFT_KEYS.has(key);
  }

  return BLOCKED_CTRL_KEYS.has(key);
}

export function installWebviewGuard(): () => void {
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (shouldBlockBrowserShortcut(event)) {
      event.preventDefault();
    }
  };

  const handleMouseUp = (event: MouseEvent) => {
    // Hardware Back (3) and Forward (4) mouse side buttons
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
    }
  };

  window.addEventListener("contextmenu", handleContextMenu);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("mouseup", handleMouseUp);

  return () => {
    window.removeEventListener("contextmenu", handleContextMenu);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("mouseup", handleMouseUp);
  };
}
