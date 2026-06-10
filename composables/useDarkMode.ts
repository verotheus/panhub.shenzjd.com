export function useDarkMode() {
  const isDark = useState("dark-mode", () => false);

  function applyTheme(dark: boolean) {
    if (import.meta.client) {
      document.documentElement.classList.toggle("dark", dark);
    }
  }

  function toggle() {
    isDark.value = !isDark.value;
    localStorage.setItem("panhub:dark-mode", isDark.value ? "dark" : "light");
    applyTheme(isDark.value);
  }

  function init() {
    if (!import.meta.client) return;
    const saved = localStorage.getItem("panhub:dark-mode");
    if (saved === "dark") {
      isDark.value = true;
    } else if (saved === "light") {
      isDark.value = false;
    } else {
      isDark.value = window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    applyTheme(isDark.value);
  }

  return { isDark: readonly(isDark), toggle, init };
}
