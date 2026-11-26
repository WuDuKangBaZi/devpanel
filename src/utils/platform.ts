export type PlatformId = "windows" | "macos" | "linux";

export function detectInitialPlatform(): PlatformId {
  if (typeof navigator === "undefined") return "windows";
  const ua = (
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    ""
  ).toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "windows";
}

export function getDefaultShellForPlatform(os: PlatformId): string {
  if (os === "macos") return "/bin/zsh";
  if (os === "linux") return "/bin/bash";
  return "powershell.exe";
}

export function getShellOptionsForPlatform(
  os: PlatformId
): { value: string; label: string }[] {
  if (os === "macos") {
    return [
      { value: "/bin/zsh", label: "Zsh (/bin/zsh)" },
      { value: "/bin/bash", label: "Bash (/bin/bash)" },
      { value: "/bin/sh", label: "POSIX Shell (/bin/sh)" },
    ];
  }
  if (os === "linux") {
    return [
      { value: "/bin/bash", label: "Bash (/bin/bash)" },
      { value: "/bin/zsh", label: "Zsh (/bin/zsh)" },
      { value: "/bin/sh", label: "POSIX Shell (/bin/sh)" },
    ];
  }
  return [
    { value: "powershell.exe", label: "Windows PowerShell (powershell.exe)" },
    { value: "pwsh.exe", label: "PowerShell 7 (pwsh.exe)" },
    { value: "cmd.exe", label: "Command Prompt (cmd.exe)" },
  ];
}

export function getShellPresetsForPlatform(os: PlatformId): string[] {
  if (os === "macos") return ["/bin/zsh", "/bin/bash", "/bin/sh"];
  if (os === "linux") return ["/bin/bash", "/bin/zsh", "/bin/sh"];
  return ["powershell.exe", "pwsh.exe", "cmd.exe"];
}

export function formatShortcut(keys: string, os: PlatformId): string {
  if (os === "macos") {
    return keys.replace(/Ctrl\+/g, "⌘").replace(/Shift\+/g, "⇧");
  }
  return keys;
}

export function formatClickShortcut(
  os: PlatformId,
  locale: "zh-CN" | "en"
): string {
  const clickWord = locale === "en" ? "Click" : "点击";
  return os === "macos" ? `⌘+${clickWord}` : `Ctrl+${clickWord}`;
}
