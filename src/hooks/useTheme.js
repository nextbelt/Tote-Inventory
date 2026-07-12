import { useEffect, useState } from "react";

const THEME_KEY = "theme"; // "auto" | "light" | "dark"

function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch {
    return "auto";
  }
}

/**
 * Theme preference: follows the phone's appearance by default ("auto"),
 * with an explicit light/dark override. The <html> class is also set by an
 * inline script in index.html before React loads, to avoid a flash.
 */
export function useTheme() {
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // storage unavailable — theme just won't persist
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "auto" && mq.matches)
      );
    apply();
    if (theme === "auto" && mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    return undefined;
  }, [theme]);

  const cycleTheme = () =>
    setTheme((t) => (t === "auto" ? "dark" : t === "dark" ? "light" : "auto"));

  return { theme, cycleTheme };
}
