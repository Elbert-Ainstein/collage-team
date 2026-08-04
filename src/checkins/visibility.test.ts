import { describe, expect, it } from "vitest";
import { isOpenToStudents } from "@/checkins/studentData";
import type { Activity } from "@/checkins/types";

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
});
