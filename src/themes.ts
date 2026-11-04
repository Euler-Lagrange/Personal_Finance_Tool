export const themes = [
  {
    id: "light",
    name: "Light",
    description: "White surfaces and forest accents.",
    scheme: "light",
  },
  {
    id: "dark",
    name: "Dark",
    description: "Charcoal surfaces and soft teal.",
    scheme: "dark",
  },
  {
    id: "slate",
    name: "Slate",
    description: "Blue-gray surfaces and cool blue.",
    scheme: "dark",
  },
  {
    id: "neon",
    name: "Neon",
    description: "Near-black with lime and cyan.",
    scheme: "dark",
  },
  {
    id: "synthwave",
    name: "Synthwave",
    description: "Deep violet with magenta and blue.",
    scheme: "dark",
  },
  {
    id: "terminal",
    name: "Robotic Terminal",
    description: "Graphite green and monospace details.",
    scheme: "dark",
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    description: "Soft lavender over deep charcoal.",
    scheme: "dark",
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    description: "Pale neutral surfaces and violet accents.",
    scheme: "light",
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    description: "Warm charcoal, cream, and amber.",
    scheme: "dark",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    description: "Midnight navy with blue and violet.",
    scheme: "dark",
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "Charcoal with purple, pink, and cyan.",
    scheme: "dark",
  },
  {
    id: "marshmallow",
    name: "Marshmallow",
    description: "Blush, lavender, and mint with soft curves.",
    scheme: "light",
  },
  {
    id: "pewter",
    name: "Pewter",
    description: "Mid-tone cool gray with restrained steel-blue accents.",
    scheme: "light",
  },
  {
    id: "pebble",
    name: "Pebble",
    description: "Soft gray, dusty pastels, and playful rounded edges.",
    scheme: "light",
  },
] as const;

export type ThemeId = (typeof themes)[number]["id"];
const storageKey = "appearance-theme";

export function readTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(storageKey);
    return themes.find((theme) => theme.id === saved)?.id ?? "light";
  } catch {
    return "light";
  }
}

export function themeScheme(theme: ThemeId) {
  return themes.find((option) => option.id === theme)!.scheme;
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = themeScheme(theme);
}

export function saveTheme(theme: ThemeId) {
  applyTheme(theme);
  try {
    localStorage.setItem(storageKey, theme);
    return true;
  } catch {
    return false;
  }
}
