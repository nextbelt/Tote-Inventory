import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatTimeOfDay } from "../../utils/time";
import SyncStatus from "../SyncStatus";

const NOW = new Date("2026-11-08T12:00:00Z");
const text = () => screen.getByTestId("sync-status").textContent;

describe("SyncStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing in local mode (there is no cloud to sync with)", () => {
    const { container } = render(
      <SyncStatus source="local" lastSyncedAt={NOW.getTime()} connection="offline" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says 'Synced just now' right after a cloud fetch", () => {
    render(<SyncStatus source="cloud" lastSyncedAt={NOW.getTime()} connection="live" />);
    expect(text()).toBe("Synced just now");
    expect(screen.getByTestId("sync-status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("sync-status").querySelector("svg")).not.toBeNull();
  });

  it("ages the synced label through RelativeTime", () => {
    render(
      <SyncStatus
        source="cloud"
        lastSyncedAt={NOW.getTime() - 5 * 60 * 1000}
        connection="live"
      />
    );
    expect(text()).toBe("Synced 5 min ago");
    expect(screen.getByTestId("sync-status").querySelector("time")).not.toBeNull();
  });

  it("shows 'Reconnecting…' while the channel is being re-established", () => {
    render(<SyncStatus source="cloud" lastSyncedAt={NOW.getTime()} connection="connecting" />);
    expect(text()).toBe("Reconnecting…");
  });

  it("shows 'Connecting…' before the first sync has happened", () => {
    render(<SyncStatus source={null} lastSyncedAt={null} connection="connecting" />);
    expect(text()).toBe("Connecting…");
    render(<SyncStatus source="cloud" lastSyncedAt={null} connection="live" />);
    expect(screen.getAllByTestId("sync-status")[1].textContent).toBe("Connecting…");
  });

  it("names the time of the cached copy when offline", () => {
    const at = NOW.getTime() - 50 * 60 * 1000;
    render(<SyncStatus source="cache" lastSyncedAt={at} connection="live" />);
    expect(text()).toBe(`Offline — showing the copy from ${formatTimeOfDay(at)}`);
    expect(text()).toMatch(/from \d{1,2}:\d{2}/);
  });

  it("treats a lost network as offline even when the data came from the cloud", () => {
    render(<SyncStatus source="cloud" lastSyncedAt={NOW.getTime()} connection="offline" />);
    expect(text()).toMatch(/^Offline — showing the copy from /);
  });

  it("falls back to generic wording when nothing has ever been synced", () => {
    render(<SyncStatus source="cache" lastSyncedAt={null} connection="offline" />);
    expect(text()).toBe("Offline — showing the last saved copy");
  });
});
