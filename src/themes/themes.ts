import type { ITheme } from "@xterm/xterm";

export type ThemeId = "midnight" | "obsidian" | "nord" | "daylight" | "paper";
export type ThemePreference = "system" | ThemeId;

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  englishName: string;
  scheme: "dark" | "light";
  description: string;
  englishDescription: string;
  swatches: [string, string, string];
  terminal: ITheme;
}

export const THEME_STORAGE_KEY = "devpanel-theme-preference";

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  midnight: {
    id: "midnight",
    name: "午夜深蓝",
    englishName: "Midnight",
    scheme: "dark",
    description: "经典高对比深海暗色",
    englishDescription: "Classic high-contrast deep ocean dark",
    swatches: ["#060B16", "#152036", "#22C55E"],
    terminal: {
      background: "#060B16",
      foreground: "#E2E8F0",
      cursor: "#22C55E",
      cursorAccent: "#060B16",
      selectionBackground: "rgba(56, 189, 248, 0.28)",
      scrollbarSliderBackground: "rgba(148, 163, 184, 0.25)",
      scrollbarSliderHoverBackground: "rgba(148, 163, 184, 0.42)",
      scrollbarSliderActiveBackground: "rgba(148, 163, 184, 0.58)",
      overviewRulerBorder: "#192438",
      black: "#1E293B",
      red: "#F87171",
      green: "#4ADE80",
      yellow: "#FACC15",
      blue: "#60A5FA",
      magenta: "#C084FC",
      cyan: "#22D3EE",
      white: "#E2E8F0",
      brightBlack: "#64748B",
      brightRed: "#FCA5A5",
      brightGreen: "#86EFAC",
      brightYellow: "#FDE047",
      brightBlue: "#93C5FD",
      brightMagenta: "#D8B4FE",
      brightCyan: "#67E8F9",
      brightWhite: "#F8FAFC",
    },
  },
  obsidian: {
    id: "obsidian",
    name: "黑曜碳黑",
    englishName: "Obsidian",
    scheme: "dark",
    description: "低眩光纯净 OLED 暗色",
    englishDescription: "Low-glare pure OLED carbon dark",
    swatches: ["#09090B", "#18181C", "#10B981"],
    terminal: {
      background: "#09090B",
      foreground: "#F4F4F5",
      cursor: "#10B981",
      cursorAccent: "#09090B",
      selectionBackground: "rgba(96, 165, 250, 0.28)",
      scrollbarSliderBackground: "rgba(161, 161, 170, 0.25)",
      scrollbarSliderHoverBackground: "rgba(161, 161, 170, 0.42)",
      scrollbarSliderActiveBackground: "rgba(161, 161, 170, 0.58)",
      overviewRulerBorder: "#27272A",
      black: "#27272A",
      red: "#F87171",
      green: "#34D399",
      yellow: "#FBBF24",
      blue: "#60A5FA",
      magenta: "#C084FC",
      cyan: "#22D3EE",
      white: "#E4E4E7",
      brightBlack: "#71717A",
      brightRed: "#FCA5A5",
      brightGreen: "#6EE7B7",
      brightYellow: "#FDE68A",
      brightBlue: "#93C5FD",
      brightMagenta: "#D8B4FE",
      brightCyan: "#67E8F9",
      brightWhite: "#FAFAFA",
    },
  },
  nord: {
    id: "nord",
    name: "北欧极光",
    englishName: "Nord",
    scheme: "dark",
    description: "柔和冰川灰蓝护眼暗色",
    englishDescription: "Soft glacial slate eye-care dark",
    swatches: ["#242933", "#3B4252", "#88C0D0"],
    terminal: {
      background: "#242933",
      foreground: "#ECEFF4",
      cursor: "#88C0D0",
      cursorAccent: "#242933",
      selectionBackground: "rgba(136, 192, 208, 0.28)",
      scrollbarSliderBackground: "rgba(216, 222, 233, 0.24)",
      scrollbarSliderHoverBackground: "rgba(216, 222, 233, 0.40)",
      scrollbarSliderActiveBackground: "rgba(216, 222, 233, 0.56)",
      overviewRulerBorder: "#3B4252",
      black: "#3B4252",
      red: "#BF616A",
      green: "#A3BE8C",
      yellow: "#EBCB8B",
      blue: "#81A1C1",
      magenta: "#B48EAD",
      cyan: "#88C0D0",
      white: "#E5E9F0",
      brightBlack: "#616E88",
      brightRed: "#D08770",
      brightGreen: "#B5D19C",
      brightYellow: "#F0D59B",
      brightBlue: "#8FBCBB",
      brightMagenta: "#C7A6C1",
      brightCyan: "#99D1E0",
      brightWhite: "#ECEFF4",
    },
  },
  daylight: {
    id: "daylight",
    name: "晴空浅白",
    englishName: "Daylight",
    scheme: "light",
    description: "清爽高对比日间浅色",
    englishDescription: "Crisp high-contrast daylight white",
    swatches: ["#F8FAFC", "#FFFFFF", "#15803D"],
    terminal: {
      background: "#F8FAFC",
      foreground: "#0F172A",
      cursor: "#15803D",
      cursorAccent: "#F8FAFC",
      selectionBackground: "rgba(2, 132, 199, 0.22)",
      scrollbarSliderBackground: "rgba(100, 116, 139, 0.28)",
      scrollbarSliderHoverBackground: "rgba(100, 116, 139, 0.46)",
      scrollbarSliderActiveBackground: "rgba(100, 116, 139, 0.62)",
      overviewRulerBorder: "#E2E8F0",
      black: "#1E293B",
      red: "#DC2626",
      green: "#15803D",
      yellow: "#B45309",
      blue: "#1D4ED8",
      magenta: "#7E22CE",
      cyan: "#0E7490",
      white: "#E2E8F0",
      brightBlack: "#475569",
      brightRed: "#EF4444",
      brightGreen: "#16A34A",
      brightYellow: "#D97706",
      brightBlue: "#2563EB",
      brightMagenta: "#9333EA",
      brightCyan: "#0891B2",
      brightWhite: "#0F172A",
    },
  },
  paper: {
    id: "paper",
    name: "暖纸护眼",
    englishName: "Warm Paper",
    scheme: "light",
    description: "柔和羊皮纸色调浅色",
    englishDescription: "Warm parchment eye-care light",
    swatches: ["#FAF8F4", "#EFEAE0", "#0F766E"],
    terminal: {
      background: "#FAF8F4",
      foreground: "#1C1917",
      cursor: "#0F766E",
      cursorAccent: "#FAF8F4",
      selectionBackground: "rgba(29, 78, 216, 0.20)",
      scrollbarSliderBackground: "rgba(120, 113, 108, 0.28)",
      scrollbarSliderHoverBackground: "rgba(120, 113, 108, 0.46)",
      scrollbarSliderActiveBackground: "rgba(120, 113, 108, 0.62)",
      overviewRulerBorder: "#E6DFD3",
      black: "#292524",
      red: "#B91C1C",
      green: "#0F766E",
      yellow: "#A16207",
      blue: "#1D4ED8",
      magenta: "#6D28D9",
      cyan: "#0369A1",
      white: "#E7E5E4",
      brightBlack: "#57534E",
      brightRed: "#DC2626",
      brightGreen: "#0D9488",
      brightYellow: "#CA8A04",
      brightBlue: "#2563EB",
      brightMagenta: "#7C3AED",
      brightCyan: "#0284C7",
      brightWhite: "#1C1917",
    },
  },
};

export const DEFAULT_DARK_TERMINAL_THEME: ITheme = THEMES.midnight.terminal;

export const THEME_LIST: ThemeDefinition[] = [
  THEMES.midnight,
  THEMES.obsidian,
  THEMES.nord,
  THEMES.daylight,
  THEMES.paper,
];

export function isValidThemeId(value: string | null): value is ThemeId {
  return (
    value === "midnight" ||
    value === "obsidian" ||
    value === "nord" ||
    value === "daylight" ||
    value === "paper"
  );
}

export function resolveThemeId(
  preference: ThemePreference,
  systemDark: boolean
): ThemeId {
  if (preference === "system") {
    return systemDark ? "midnight" : "daylight";
  }
  return preference;
}

export function getThemeDisplayName(
  theme: ThemeDefinition,
  locale: "zh-CN" | "en"
): string {
  return locale === "en" ? theme.englishName : theme.name;
}

export function getThemeDisplayDescription(
  theme: ThemeDefinition,
  locale: "zh-CN" | "en"
): string {
  return locale === "en" ? theme.englishDescription : theme.description;
}
