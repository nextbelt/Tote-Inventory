import { Moon, Sun, SunMoon } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

const META = {
  auto: { icon: SunMoon, label: "Theme: automatic (follows your phone)" },
  dark: { icon: Moon, label: "Theme: dark" },
  light: { icon: Sun, label: "Theme: light" },
};

export default function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();
  const { icon: Icon, label } = META[theme];

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={`${label} — tap to change`}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 dark:text-gray-300"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
