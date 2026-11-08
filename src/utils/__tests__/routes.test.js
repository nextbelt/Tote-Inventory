import { describe, expect, it } from "vitest";
import {
  buildEditUrl,
  buildGridUrl,
  buildNewUrl,
  buildSlotUrl,
  buildToteUrl,
  historyDepth,
  isReservedPosition,
  navState,
  parseRoute,
  parseToteId,
} from "../routes";

describe("parseRoute", () => {
  it("parses a numeric tote id to a Number", () => {
    expect(parseRoute("?tote=42")).toEqual({ view: "tote", toteId: 42 });
  });

  it("keeps unsafe integers and non-numeric ids as strings", () => {
    expect(parseRoute("?tote=99999999999999999999")).toEqual({
      view: "tote",
      toteId: "99999999999999999999",
    });
    expect(parseRoute("?tote=abc-1")).toEqual({ view: "tote", toteId: "abc-1" });
  });

  it("parses slots and rejects reserved positions", () => {
    expect(parseRoute("?slot=B3")).toEqual({ view: "slot", position: "B3" });
    expect(parseRoute("?slot=__config__")).toEqual({ view: "grid" });
    expect(parseRoute("?tote=__config__")).toEqual({ view: "grid" });
  });

  it("falls back to grid with known params and ignores unknown ones", () => {
    expect(parseRoute("")).toEqual({ view: "grid" });
    expect(parseRoute(undefined)).toEqual({ view: "grid" });
    expect(parseRoute("?foo=bar&utm=1")).toEqual({ view: "grid" });
    expect(parseRoute("?wall=left&q=tarp&mode=search&foo=1")).toEqual({
      view: "grid",
      wall: "left",
      q: "tarp",
      mode: "search",
    });
    expect(parseRoute("?tote=&slot=")).toEqual({ view: "grid" });
  });

  it("prefers tote over slot", () => {
    expect(parseRoute("?slot=A1&tote=7")).toEqual({ view: "tote", toteId: 7 });
  });
});

describe("build urls", () => {
  it("builds tote and slot urls, trimming trailing slashes", () => {
    expect(buildToteUrl("https://x.app", 12)).toBe("https://x.app/?tote=12");
    expect(buildToteUrl("https://x.app/", "12")).toBe("https://x.app/?tote=12");
    expect(buildSlotUrl("https://x.app", "B3")).toBe("https://x.app/?slot=B3");
  });

  it("round-trips ids and positions", () => {
    for (const id of [
      1,
      31,
      Number.MAX_SAFE_INTEGER,
      "99999999999999999999",
      "u-1",
    ]) {
      const url = new URL(buildToteUrl("https://x.app", id));
      expect(parseRoute(url.search)).toEqual({ view: "tote", toteId: id });
    }
    for (const position of ["A1", "LW7", "RW2C", "odd & pos"]) {
      const url = new URL(buildSlotUrl("https://x.app", position));
      expect(parseRoute(url.search)).toEqual({ view: "slot", position });
    }
  });
});

describe("helpers", () => {
  it("parseToteId and isReservedPosition", () => {
    expect(parseToteId("007")).toBe(7);
    expect(parseToteId(" ")).toBeNull();
    expect(parseToteId(null)).toBeNull();
    expect(isReservedPosition("__config__")).toBe(true);
    expect(isReservedPosition("A1")).toBe(false);
  });
});

describe("edit and new routes", () => {
  it("parses ?edit and ?new and rejects reserved or empty values", () => {
    expect(parseRoute("?edit=5")).toEqual({ view: "edit", toteId: 5 });
    expect(parseRoute("?new=B3")).toEqual({ view: "new", position: "B3" });
    expect(parseRoute("?new=__config__")).toEqual({ view: "grid" });
    expect(parseRoute("?edit=__removed_items__")).toEqual({ view: "grid" });
    expect(parseRoute("?new=&edit=")).toEqual({ view: "grid" });
  });

  it("lets ?tote win over ?edit, ?edit over ?new, ?new over ?slot", () => {
    expect(parseRoute("?edit=1&tote=2")).toEqual({ view: "tote", toteId: 2 });
    expect(parseRoute("?new=A1&edit=3")).toEqual({ view: "edit", toteId: 3 });
    expect(parseRoute("?slot=A1&new=B2")).toEqual({ view: "new", position: "B2" });
  });

  it("round-trips edit and new urls", () => {
    const edit = new URL(buildEditUrl("https://x.app", "u-1"));
    expect(parseRoute(edit.search)).toEqual({ view: "edit", toteId: "u-1" });
    expect(buildEditUrl("", 7)).toBe("/?edit=7");
    const fresh = new URL(buildNewUrl("https://x.app", "RW2C"));
    expect(parseRoute(fresh.search)).toEqual({ view: "new", position: "RW2C" });
    expect(buildNewUrl("", "B3")).toBe("/?new=B3");
  });
});

describe("buildGridUrl", () => {
  it("leaves defaults out", () => {
    expect(buildGridUrl()).toBe("/");
    expect(buildGridUrl({ wall: "front", q: "", mode: "garage" })).toBe("/");
  });

  it("round-trips wall, q and mode", () => {
    const url = buildGridUrl({ wall: "left", q: "blue tarp & rope", mode: "list" });
    const route = parseRoute(url.slice(1));
    expect(route).toEqual({
      view: "grid",
      wall: "left",
      q: "blue tarp & rope",
      mode: "list",
    });
  });
});

describe("history depth", () => {
  it("reads back what navState wrote and ignores foreign state", () => {
    expect(historyDepth(navState(0))).toBe(0);
    expect(historyDepth(navState(3))).toBe(3);
    expect(historyDepth(null)).toBeNull();
    expect(historyDepth({ depth: 2 })).toBeNull();
    expect(historyDepth({ ...navState(1), depth: -1 })).toBeNull();
  });
});
