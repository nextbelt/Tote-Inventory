import { useEffect, useState } from "react";
import { formatDateTime, formatRelative } from "../utils/time";

/**
 * Re-render once a minute, and as soon as the app comes back to the
 * foreground, so labels like "5 min ago" never go stale on a screen that
 * was left open (e.g. the Home Screen app after the phone slept).
 */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const timer = setInterval(bump, 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

/** "5 min ago" as a <time> element; its title holds the exact time. */
export default function RelativeTime({ date }) {
  useMinuteTick();
  const label = formatRelative(date);
  if (!label) return null;
  return (
    <time dateTime={new Date(date).toISOString()} title={formatDateTime(date)}>
      {label}
    </time>
  );
}
