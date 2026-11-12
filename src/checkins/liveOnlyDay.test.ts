import { describe, expect, it } from "vitest";
import { liveOnly, liveOnlyActive } from "@/checkins/liveOnlyDay";

const UNTIL = "2026-11-13T05:00:00-06:00";
const during = new Date("2026-11-12T15:00:00-06:00");
const after = new Date("2026-11-13T05:00:00-06:00");

const act = (id: string, type: string) => ({ id, type });

describe("the live-only day", () => {
  it("is on until the end instant and off from it", () => {
    expect(liveOnlyActive(during, UNTIL)).toBe(true);
    expect(liveOnlyActive(after, UNTIL)).toBe(false);
  });

  it("is off when the end can't be read, rather than hiding work over a typo", () => {
    expect(liveOnlyActive(during, "not a date")).toBe(false);
  });

  it("shows a course running a live activity only its live activities", () => {
    const list = [act("a", "challenge"), act("b", "live"), act("c", "skills"), act("d", "live")];
    expect(liveOnly(list, during, UNTIL).map((a) => a.id)).toEqual(["b", "d"]);
  });

  it("leaves a course with no live activity alone", () => {
    const list = [act("a", "challenge"), act("c", "skills")];
    expect(liveOnly(list, during, UNTIL).map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("shows everything again once the day is over", () => {
    const list = [act("a", "challenge"), act("b", "live")];
    expect(liveOnly(list, after, UNTIL).map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("does not change the list it was given", () => {
    const list = [act("a", "challenge"), act("b", "live")];
    const copy = list.map((a) => ({ ...a }));
    liveOnly(list, during, UNTIL);
    expect(list).toEqual(copy);
  });
});
