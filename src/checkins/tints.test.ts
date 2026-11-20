import { describe, expect, it } from "vitest";
import { LEGACY_TINTS, TINTS, paletteTint, tintFor } from "./tints";

describe("avatar tints", () => {
  it("hands every name a colour from the palette, the same one every time", () => {
    for (const name of ["Ada Lovelace", "Ben Okafor", "Cy Ng", ""]) {
      expect(TINTS).toContain(tintFor(name));
      expect(tintFor(name)).toBe(tintFor(name));
    }
  });

  it("keeps the old name-to-slot assignment, so nobody's face changes hue family", () => {
    // Same hash, same slot: a student who was the first legacy colour is the first new one.
    for (const name of ["Ada Lovelace", "Ben Okafor", "Cy Ng", "Di Ott", "Eli Park"]) {
      const slot = TINTS.indexOf(tintFor(name));
      expect(paletteTint(LEGACY_TINTS[slot])).toBe(TINTS[slot]);
    }
  });

  it("repaints a tint saved before the palette changed", () => {
    // avatar_tint is stored on the row, so existing students still carry the old hex.
    LEGACY_TINTS.forEach((old, i) => {
      expect(paletteTint(old)).toBe(TINTS[i]);
      expect(paletteTint(old.toUpperCase())).toBe(TINTS[i]);
    });
  });

  it("leaves a tint it does not recognise alone", () => {
    expect(paletteTint("#123456")).toBe("#123456");
    expect(paletteTint(TINTS[3])).toBe(TINTS[3]);
  });

  it("is a six-digit hex, because the student stack appends an alpha byte to it", () => {
    for (const t of TINTS) expect(t).toMatch(/^#[0-9a-f]{6}$/);
  });
});
