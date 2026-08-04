import { describe, expect, it } from "vitest";
import { isOpenToStudents } from "@/checkins/studentData";
import { HIDDEN_INSTANT, isHiddenInstant, type Activity } from "@/checkins/types";

const at = (opens_at: string | null) => ({ opens_at } as Activity);
const now = new Date("2026-03-10T12:00:00.000Z");

describe("what a student may see", () => {
  it("shows an activity with no opening time — NULL means visible", () => {
    // Every activity authored before scheduling existed has NULL. Reading it
    // as 'hidden' would empty a live course's assignment list.
    expect(isOpenToStudents(at(null), now)).toBe(true);
  });

  it("shows one whose time has passed", () => {
    expect(isOpenToStudents(at("2026-03-10T09:00:00.000Z"), now)).toBe(true);
  });

  it("hides one scheduled for later", () => {
    expect(isOpenToStudents(at("2026-03-11T09:00:00.000Z"), now)).toBe(false);
  });

  it("treats the exact instant as open", () => {
    expect(isOpenToStudents(at("2026-03-10T12:00:00.000Z"), now)).toBe(true);
  });

  it("shows one whose stamp is unreadable rather than hiding work over a bad row", () => {
    expect(isOpenToStudents(at("not a date"), now)).toBe(true);
    expect(isOpenToStudents(at(""), now)).toBe(true);
  });

  it("does not consult `posted` — that is a faculty-side flag", () => {
    const hidden = { opens_at: null, posted: false } as unknown as Activity;
    expect(isOpenToStudents(hidden, now)).toBe(true);
  });

  // The visibility switch has two positions and one column to write them in.
  describe("the switched-off sentinel", () => {
    it("hides an activity switched off", () => {
      expect(isOpenToStudents(at(HIDDEN_INSTANT), now)).toBe(false);
    });

    it("stays hidden however far the clock is wound forward", () => {
      // The point of an instant that never arrives: no clock reaches it, so
      // "off" cannot decay into "on" while nobody is looking.
      expect(isOpenToStudents(at(HIDDEN_INSTANT), new Date("3000-01-01T00:00:00.000Z"))).toBe(false);
    });

    it("recognises the sentinel so nothing prints it as a date", () => {
      expect(isHiddenInstant(HIDDEN_INSTANT)).toBe(true);
      // A round trip through Postgres may render it differently but equally.
      expect(isHiddenInstant("9999-12-31T00:00:00+00:00")).toBe(true);
    });

    it("does not mistake a real schedule, or no schedule, for the sentinel", () => {
      expect(isHiddenInstant("2026-03-11T09:00:00.000Z")).toBe(false);
      expect(isHiddenInstant(null)).toBe(false);
      expect(isHiddenInstant("not a date")).toBe(false);
    });
  });
});
