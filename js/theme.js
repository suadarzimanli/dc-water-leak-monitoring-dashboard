const STORAGE_KEY = "dcwater-theme";

export const THEMES = {
  DARK: "dark",
  LIGHT: "light",
};

export function getStoredTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === THEMES.LIGHT ? THEMES.LIGHT : THEMES.DARK;
}

export function applyTheme(theme) {
  const next = theme === THEMES.LIGHT ? THEMES.LIGHT : THEMES.DARK;
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(STORAGE_KEY, next);
  return next;
}

export function initTheme() {
  return applyTheme(getStoredTheme());
}

export function toggleTheme(currentTheme) {
  const next = currentTheme === THEMES.LIGHT ? THEMES.DARK : THEMES.LIGHT;
  return applyTheme(next);
}

export function getThemeLabel(theme) {
  return theme === THEMES.LIGHT ? "Dark mode" : "Light mode";
}

export function getChartTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    text: styles.getPropertyValue("--chart-text").trim() || "#9fb0cc",
    grid: styles.getPropertyValue("--chart-grid").trim() || "rgba(255,255,255,0.06)",
    flow: styles.getPropertyValue("--accent").trim() || "#2ea8ff",
    pressure: styles.getPropertyValue("--accent-2").trim() || "#1dd3b0",
  };
}
