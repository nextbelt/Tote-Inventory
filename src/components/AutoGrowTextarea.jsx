import { useLayoutEffect, useRef } from "react";

/**
 * A textarea that is exactly as tall as what is in it, up to about four
 * lines (then it scrolls). It measures the wrapped text, so a long
 * comma-separated entry is fully visible in a narrow box, not just its first
 * line. Takes the same props as <textarea>.
 */
export default function AutoGrowTextarea({ value, className = "", ...rest }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight leaves out the border; offsetHeight - clientHeight is it
    const border = el.offsetHeight - el.clientHeight;
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight + border}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={`max-h-[7.5rem] overflow-y-auto ${className}`}
      {...rest}
    />
  );
}
