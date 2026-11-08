import { describe, expect, it } from "vitest";
import {
  buildSlotUrl,
  buildToteUrl,
  isReservedPosition,
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
