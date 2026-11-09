/** The fourteen themes carried over from the first build. Colours live in themes.css. */
export const themes = [
  { id: "light", name: "Light", scheme: "light" },
  { id: "dark", name: "Dark", scheme: "dark" },
  { id: "slate", name: "Slate", scheme: "dark" },
  { id: "neon", name: "Neon", scheme: "dark" },
  { id: "synthwave", name: "Synthwave", scheme: "dark" },
  { id: "terminal", name: "Robotic Terminal", scheme: "dark" },
  { id: "catppuccin-mocha", name: "Catppuccin Mocha", scheme: "dark" },
  { id: "catppuccin-latte", name: "Catppuccin Latte", scheme: "light" },
  { id: "gruvbox", name: "Gruvbox", scheme: "dark" },
  { id: "tokyo-night", name: "Tokyo Night", scheme: "dark" },
  { id: "dracula", name: "Dracula", scheme: "dark" },
  { id: "marshmallow", name: "Marshmallow", scheme: "light" },
  { id: "pewter", name: "Pewter", scheme: "light" },
  { id: "pebble", name: "Pebble", scheme: "light" },
] as const;

export type ThemeId = (typeof themes)[number]["id"];

export function applyTheme(theme: string): void {
  const found = themes.find((t) => t.id === theme) ?? themes[2];
  document.documentElement.dataset.theme = found.id;
  document.documentElement.style.colorScheme = found.scheme;
}
