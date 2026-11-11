import { describe, expect, it } from "vitest";
import { DEFAULT_DIMENSIONS, DIMENSIONS, anchorFor, isDimension } from "./dimensions";

describe("dimensions", () => {
  it("asks every dimension by default, each once", () => {
    expect([...DEFAULT_DIMENSIONS].sort()).toEqual(Object.keys(DIMENSIONS).sort());
  });

  it("keys each entry by its own key", () => {
    for (const [k, d] of Object.entries(DIMENSIONS)) expect(d.key).toBe(k);
  });

  it("has an anchor at 1, 3 and 5 and none in between", () => {
    const [low, mid, high] = DIMENSIONS.quality.anchors;
    expect(anchorFor("quality", 1)).toBe(low);
    expect(anchorFor("quality", 3)).toBe(mid);
    expect(anchorFor("quality", 5)).toBe(high);
    expect(anchorFor("quality", 2)).toBeNull();
    expect(anchorFor("quality", 4)).toBeNull();
  });

  it("keeps every anchor to one short line", () => {
    for (const d of Object.values(DIMENSIONS)) {
      for (const a of d.anchors) expect(a.length).toBeLessThanOrEqual(50);
    }
  });

  it("knows its own keys and nothing else", () => {
    expect(isDimension("on_track")).toBe(true);
    expect(isDimension("toString")).toBe(false);
    expect(isDimension("leadership")).toBe(false);
    expect(isDimension(3)).toBe(false);
  });
});
