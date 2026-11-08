import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backupFilename,
  buildBackup,
  buildCsv,
  csvFilename,
  downloadFile,
  parseBackup,
  planRestore,
} from "../backup";

const tote = (over = {}) => ({
  id: 1,
  name: "Tools",
  position: "LW1",
  items: [{ id: 10, name: "Hammer", qty: 2 }],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-02-01T00:00:00Z",
  ...over,
});

describe("buildBackup", () => {
  it("excludes reserved rows and keeps optional fields only when present", () => {
    const b = buildBackup({
      totes: [
        tote({ tags: ["Camping"], notes: "lid cracked" }),
        tote({ id: 2, position: "__config__", items: {} }),
        tote({ id: 3, position: "LW2" }),
      ],
      layout: { a: 1 },
      exportedAt: "2026-11-08T10:00:00Z",
    });
    expect(b.app).toBe("garage-totes");
    expect(b.version).toBe(1);
    expect(b.exportedAt).toBe("2026-11-08T10:00:00Z");
    expect(b.layout).toEqual({ a: 1 });
    expect(b.totes.map((t) => t.id)).toEqual([1, 3]);
    expect(b.totes[0].tags).toEqual(["Camping"]);
    expect(b.totes[0].notes).toBe("lid cracked");
    expect("tags" in b.totes[1]).toBe(false);
    expect("notes" in b.totes[1]).toBe(false);
  });

  it("does not share item objects with the source", () => {
    const src = tote();
    const b = buildBackup({ totes: [src], exportedAt: "x" });
    b.totes[0].items[0].name = "changed";
    expect(src.items[0].name).toBe("Hammer");
  });
});

describe("filenames", () => {
  it("uses the local date", () => {
    const d = new Date(2026, 10, 8, 23, 59);
    expect(backupFilename(d)).toBe("garage-totes-backup-2026-11-08.json");
    expect(csvFilename(d)).toBe("garage-totes-2026-11-08.csv");
  });
});

describe("buildCsv", () => {
  const describe_ = (p) => `Spot ${p}`;

  it("starts with a BOM, header and uses CRLF", () => {
    const csv = buildCsv([tote()], describe_);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Tote,Location,Item,Quantity,Photo,Tags,Note");
    expect(lines[1]).toBe("Tools,Spot LW1,Hammer,2,,,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("quotes commas, quotes and newlines", () => {
    const csv = buildCsv(
      [
        tote({
          name: 'A, "B"',
          items: [{ id: 1, name: "x\ny", image: "http://i/1.jpg" }],
        }),
      ],
      describe_
    );
    expect(csv).toContain('"A, ""B""",Spot LW1,"x\ny",1,http://i/1.jpg,,');
  });

  it("defaults missing qty to 1, keeps 0, and emits a row for an empty tote", () => {
    const csv = buildCsv(
      [
        tote({ items: [{ id: 1, name: "a" }, { id: 2, name: "b", qty: 0 }] }),
        tote({ id: 2, name: "Empty", position: "LW2", items: [] }),
        tote({ id: 3, position: "__config__" }),
      ],
      describe_
    );
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines).toEqual([
      "Tote,Location,Item,Quantity,Photo,Tags,Note",
      "Tools,Spot LW1,a,1,,,",
      "Tools,Spot LW1,b,0,,,",
      "Empty,Spot LW2,,,,,",
    ]);
  });

  it("writes only web links to Photo; data: URIs become a short marker", () => {
    const huge = "data:image/jpeg;base64," + "A".repeat(100000);
    const csv = buildCsv(
      [
        tote({
          items: [
            { id: 1, name: "web", image: "https://x.co/a.jpg" },
            { id: 2, name: "old", image: huge },
            { id: 3, name: "odd", image: "file:///tmp/a.jpg" },
            { id: 4, name: "none" },
          ],
        }),
      ],
      describe_
    );
    expect(csv.length).toBeLessThan(1000);
    expect(csv.slice(1).trimEnd().split("\r\n")).toEqual([
      "Tote,Location,Item,Quantity,Photo,Tags,Note",
      "Tools,Spot LW1,web,1,https://x.co/a.jpg,,",
      "Tools,Spot LW1,old,1,(embedded photo),,",
      "Tools,Spot LW1,odd,1,,,",
      "Tools,Spot LW1,none,1,,,",
    ]);
  });

  it("adds Tags (per tote, joined) and Note (per item) columns", () => {
    const csv = buildCsv(
      [
        tote({
          tags: ["camping", "winter, big"],
          items: [
            { id: 1, name: "Stove", qty: 1, note: 'spare "fuel" inside' },
            { id: 2, name: "Pot" },
          ],
        }),
        tote({ id: 2, name: "Empty", position: "LW2", items: [], tags: ["x"] }),
        tote({ id: 3, name: "Plain", position: "LW3", tags: null }),
      ],
      describe_
    );
    expect(csv.slice(1).trimEnd().split("\r\n")).toEqual([
      "Tote,Location,Item,Quantity,Photo,Tags,Note",
      'Tools,Spot LW1,Stove,1,,"camping; winter, big","spare ""fuel"" inside"',
      'Tools,Spot LW1,Pot,1,,"camping; winter, big",',
      "Empty,Spot LW2,,,,x,",
      "Plain,Spot LW3,Hammer,2,,,",
    ]);
  });

  it("keeps the full data: URI in the JSON backup", () => {
    const huge = "data:image/jpeg;base64,AAAA";
    const b = buildBackup({
      totes: [tote({ items: [{ id: 1, name: "old", image: huge }] })],
    });
    expect(b.totes[0].items[0].image).toBe(huge);
  });

  it("accepts describe returning { path } and works without describe", () => {
    expect(buildCsv([tote()], () => ({ path: "Left wall" }))).toContain(
      "Left wall"
    );
    expect(buildCsv([tote()])).toContain("Tools,LW1,Hammer");
  });
});

describe("parseBackup", () => {
  const good = () =>
    buildBackup({ totes: [tote()], exportedAt: "2026-11-08T00:00:00Z" });

  it("round-trips a backup, also with a BOM", () => {
    const text = JSON.stringify(good());
    const r = parseBackup(String.fromCharCode(0xfeff) + text);
    expect(r.ok).toBe(true);
    expect(r.backup.totes).toHaveLength(1);
    expect(r.backup.totes[0].items[0].id).toBe(10);
  });

  it("keeps string and numeric ids as they are", () => {
    const b = good();
    b.totes[0].items.push({ id: "abc-123", name: "Rope" });
    const r = parseBackup(JSON.stringify(b));
    expect(r.backup.totes[0].items.map((i) => i.id)).toEqual([10, "abc-123"]);
  });

  it("rejects bad input with friendly errors", () => {
    expect(parseBackup("").ok).toBe(false);
    expect(parseBackup("not json").error).toMatch(/not valid JSON/);
    expect(
      parseBackup(JSON.stringify({ app: "other", version: 1, totes: [] })).error
    ).toMatch(/not a Garage Totes backup/);
    expect(parseBackup("[1]").ok).toBe(false);
    expect(parseBackup(JSON.stringify({ ...good(), version: 2 })).error).toMatch(
      /newer version/
    );
    expect(parseBackup(JSON.stringify({ ...good(), version: "1" })).ok).toBe(
      false
    );
    expect(parseBackup(JSON.stringify({ ...good(), totes: {} })).error).toMatch(
      /damaged/
    );
  });

  it("rejects malformed totes and items", () => {
    const bad = (mutate) => {
      const b = good();
      mutate(b);
      return parseBackup(JSON.stringify(b));
    };
    expect(bad((b) => (b.totes[0].id = null)).ok).toBe(false);
    expect(bad((b) => delete b.totes[0].name).ok).toBe(false);
    expect(bad((b) => (b.totes[0].position = "")).ok).toBe(false);
    expect(bad((b) => (b.totes[0].items = "x")).ok).toBe(false);
    expect(bad((b) => (b.totes[0].items = [{ name: "no id" }])).ok).toBe(false);
    expect(bad((b) => (b.totes[0].items = [{ id: 1 }])).ok).toBe(false);
    expect(
      bad((b) => (b.totes[0].items = [{ id: 1, name: "a", qty: "lots" }])).ok
    ).toBe(false);
    expect(bad((b) => (b.totes[0] = 5)).ok).toBe(false);
  });

  it("ignores reserved rows in the file", () => {
    const b = good();
    b.totes.push({ id: 9, position: "__config__", items: {} });
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(true);
    expect(r.backup.totes).toHaveLength(1);
  });
});

describe("planRestore", () => {
  const backup = (totes) => ({ totes });

  it("creates totes that are gone and whose slot is free", () => {
    const plan = planRestore(backup([tote()]), []);
    expect(plan.createTotes).toHaveLength(1);
    expect(plan.conflicts).toEqual([]);
    expect(plan.addItems).toEqual([]);
  });

  it("reports a conflict when the slot is taken by another tote", () => {
    const other = tote({ id: 99, name: "Other" });
    const plan = planRestore(backup([tote()]), [other]);
    expect(plan.createTotes).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].occupiedBy).toBe(other);
  });

  it("does not let two backup totes claim the same free slot", () => {
    const plan = planRestore(
      backup([tote({ id: 1 }), tote({ id: 2, name: "Dup" })]),
      []
    );
    expect(plan.createTotes.map((t) => t.id)).toEqual([1]);
    expect(plan.conflicts.map((c) => c.tote.id)).toEqual([2]);
  });

  it("adds only items missing by id to existing totes", () => {
    const current = tote({
      items: [{ id: 10, name: "Hammer (renamed)", qty: 5 }],
    });
    const b = tote({
      items: [
        { id: 10, name: "Hammer", qty: 2 },
        { id: "u-1", name: "Saw" },
      ],
    });
    const plan = planRestore(backup([b]), [current]);
    expect(plan.createTotes).toEqual([]);
    expect(plan.addItems).toEqual([
      { toteId: 1, items: [{ id: "u-1", name: "Saw" }] },
    ]);
  });

  it("does not re-add an item that was moved to another tote", () => {
    const hammer = { id: 10, name: "Hammer", qty: 2 };
    const saw = { id: 11, name: "Saw" };
    const backupA = tote({ id: 1, position: "LW1", items: [hammer, saw] });
    const currentA = tote({ id: 1, position: "LW1", items: [saw] });
    const currentB = tote({ id: 2, position: "LW2", items: [hammer] });
    const plan = planRestore(backup([backupA]), [currentA, currentB]);
    expect(plan.addItems).toEqual([]);
    expect(plan.movedElsewhere).toEqual([
      { item: hammer, fromToteId: 1, nowInToteId: 2 },
    ]);
  });

  it("does not report items that are still in their own tote as moved", () => {
    const plan = planRestore(backup([tote()]), [tote()]);
    expect(plan.movedElsewhere).toEqual([]);
  });

  it("leaves moved items out of created totes and conflicts too", () => {
    const hammer = { id: 10, name: "Hammer" };
    const nail = { id: 12, name: "Nail" };
    const elsewhere = tote({ id: 9, position: "LW9", items: [hammer] });
    const gone = tote({ id: 1, position: "LW1", items: [hammer, nail] });

    const created = planRestore(backup([gone]), [elsewhere]);
    expect(created.createTotes).toHaveLength(1);
    expect(created.createTotes[0].items).toEqual([nail]);
    expect(created.movedElsewhere).toHaveLength(1);
    expect(gone.items).toHaveLength(2); // input untouched

    const taken = tote({ id: 8, position: "LW1", items: [] });
    const conflict = planRestore(backup([gone]), [elsewhere, taken]);
    expect(conflict.conflicts[0].tote.items).toEqual([nail]);
    expect(conflict.conflicts[0].occupiedBy).toBe(taken);
  });

  it("compares ids with their original types", () => {
    const current = tote({ items: [{ id: "10", name: "String ten" }] });
    const plan = planRestore(backup([tote()]), [current]);
    expect(plan.addItems[0].items.map((i) => i.id)).toEqual([10]);

    // tote id 1 vs "1" are different totes
    const plan2 = planRestore(backup([tote({ id: 1 })]), [tote({ id: "1" })]);
    expect(plan2.conflicts).toHaveLength(1);
  });

  it("is empty when nothing is missing and never mutates its inputs", () => {
    const current = [tote()];
    const snapshot = JSON.stringify(current);
    const plan = planRestore(backup([tote()]), current);
    expect(plan).toEqual({
      createTotes: [],
      conflicts: [],
      addItems: [],
      movedElsewhere: [],
    });
    expect(JSON.stringify(current)).toBe(snapshot);
  });

  it("ignores reserved rows on both sides", () => {
    const plan = planRestore(
      backup([tote({ id: 5, position: "__config__" })]),
      [tote({ id: 5, position: "__config__" })]
    );
    expect(plan).toEqual({
      createTotes: [],
      conflicts: [],
      addItems: [],
      movedElsewhere: [],
    });
  });
});

describe("downloadFile", () => {
  const origShare = navigator.share;
  const origCanShare = navigator.canShare;

  const setShare = (share, canShare) => {
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "canShare", {
      value: canShare,
      configurable: true,
      writable: true,
    });
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setShare(origShare, origCanShare);
  });

  const mockUrl = () => {
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
  };

  it("falls back to a download link and revokes the URL much later", async () => {
    vi.useFakeTimers();
    setShare(undefined, undefined);
    mockUrl();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function () {
        expect(this.download).toBe("f.json");
        expect(this.href).toContain("blob:fake");
      });
    const result = await downloadFile("f.json", "application/json", "{}");
    expect(result).toBe("downloaded");
    expect(click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("prefers the share sheet when it can share files", async () => {
    const share = vi.fn(() => Promise.resolve());
    const canShare = vi.fn(() => true);
    setShare(share, canShare);
    mockUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const result = await downloadFile("f.csv", "text/csv", "a,b");
    expect(result).toBe("shared");
    const arg = share.mock.calls[0][0];
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0].name).toBe("f.csv");
    expect(arg.files[0].type).toBe("text/csv");
    expect(click).not.toHaveBeenCalled();
  });

  it("reports cancelled (and does not download) when the user dismisses the sheet", async () => {
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    setShare(vi.fn(() => Promise.reject(abort)), vi.fn(() => true));
    mockUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    expect(await downloadFile("f.csv", "text/csv", "a")).toBe("cancelled");
    expect(click).not.toHaveBeenCalled();
  });

  it("falls back to a download when sharing files is unsupported or fails", async () => {
    vi.useFakeTimers();
    mockUrl();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    setShare(vi.fn(), vi.fn(() => false));
    expect(await downloadFile("f.csv", "text/csv", "a")).toBe("downloaded");

    const denied = Object.assign(new Error("x"), { name: "NotAllowedError" });
    setShare(vi.fn(() => Promise.reject(denied)), vi.fn(() => true));
    expect(await downloadFile("f.csv", "text/csv", "a")).toBe("downloaded");
    expect(click).toHaveBeenCalledTimes(2);
    vi.runAllTimers();
  });
});
