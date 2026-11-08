import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatRelative,
  latestModified,
  toteModifiedDate,
} from "../time";

const SEC = 1000;
const MIN = 60 * SEC;
const HR = 60 * MIN;
const DAY = 24 * HR;

describe("toteModifiedDate", () => {
  it("prefers updated_at", () => {
    expect(
      toteModifiedDate({
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
      }).toISOString()
    ).toBe("2026-02-01T00:00:00.000Z");
  });

  it("falls back to created_at when updated_at is missing or invalid", () => {
    const created = "2026-01-01T00:00:00.000Z";
    expect(toteModifiedDate({ created_at: created }).toISOString()).toBe(created);
    expect(
      toteModifiedDate({ updated_at: "garbage", created_at: created }).toISOString()
    ).toBe(created);
  });

  it("returns null when there is no usable timestamp", () => {
    expect(toteModifiedDate({})).toBeNull();
    expect(toteModifiedDate(null)).toBeNull();
    expect(toteModifiedDate({ updated_at: "garbage" })).toBeNull();
  });
});

describe("latestModified", () => {
  it("returns the newest updated_at (falling back to created_at)", () => {
    const d = latestModified([
      { updated_at: "2026-01-01T00:00:00Z" },
      { created_at: "2026-03-01T00:00:00Z" },
      { updated_at: "2026-02-01T00:00:00Z" },
    ]);
    expect(d.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("returns null when nothing has a timestamp", () => {
    expect(latestModified([])).toBeNull();
    expect(latestModified([{ updated_at: "garbage" }])).toBeNull();
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const ago = (ms) => new Date(now - ms);

  it.each([
    [0, "just now"],
    [59 * SEC, "just now"],
    [60 * SEC, "1 min ago"],
    [59 * MIN, "59 min ago"],
    [60 * MIN, "1 hr ago"],
    [23 * HR + 59 * MIN, "23 hr ago"],
    [DAY, "1 day ago"],
    [47 * HR, "1 day ago"],
    [2 * DAY, "2 days ago"],
    [6 * DAY + 23 * HR, "6 days ago"],
  ])("%i ms ago → %s", (ms, expected) => {
    expect(formatRelative(ago(ms), now)).toBe(expected);
  });

  it("shows a calendar date once it's a week or more old", () => {
    const label = formatRelative(ago(7 * DAY), now);
    expect(label).not.toMatch(/ago|just now/);
    expect(label).toMatch(/2026/);
  });

  it("treats small clock skew (timestamp slightly in the future) as just now", () => {
    expect(formatRelative(new Date(now + 2 * MIN), now)).toBe("just now");
    expect(formatRelative(new Date(now + 5 * MIN), now)).toBe("just now");
  });

  it("shows the real date for a timestamp well in the future instead of pinning on just now", () => {
    const label = formatRelative(new Date(now + 30 * MIN), now);
    expect(label).not.toBe("just now");
    expect(label).toMatch(/2026/);
  });

  it("accepts ISO strings and returns empty for missing/invalid input", () => {
    expect(formatRelative("2026-11-08T11:55:00Z", now)).toBe("5 min ago");
    expect(formatRelative("garbage", now)).toBe("");
    expect(formatRelative(null, now)).toBe("");
    expect(formatRelative(undefined, now)).toBe("");
  });
});

describe("formatDateTime", () => {
  it("formats a date with day and time", () => {
    const label = formatDateTime("2026-11-08T15:14:00Z");
    expect(label).toMatch(/2026/);
    expect(label).toMatch(/\d{1,2}:\d{2}/);
  });

  it("returns empty for missing/invalid input instead of 'Invalid Date'", () => {
    expect(formatDateTime("garbage")).toBe("");
    expect(formatDateTime(null)).toBe("");
  });
});
