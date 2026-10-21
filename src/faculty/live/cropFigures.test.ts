import { describe, expect, it } from "vitest";
import { cropRect } from "./cropFigures";

describe("cropRect", () => {
  it("turns a fractional box into pixels, with a little margin", () => {
    const r = cropRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, 1000, 2000)!;
    expect(r.x).toBe(85);
    expect(r.y).toBe(370);
    expect(r.w).toBe(530);
    expect(r.h).toBe(560);
  });

  it("stays on the page", () => {
    const r = cropRect({ x: 0.9, y: 0.9, w: 0.3, h: 0.3 }, 1000, 1000)!;
    expect(r.x + r.w).toBeLessThanOrEqual(1000);
    expect(r.y + r.h).toBeLessThanOrEqual(1000);
  });

  it("refuses a sliver", () => {
    expect(cropRect({ x: 0.5, y: 0.5, w: 0, h: 0 }, 400, 400)).toBeNull();
  });
});
