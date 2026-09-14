// Where you are, on the URL: /ck?s=<screen>&a=<activity>&c=<course>.
//
// The activity is written for the screens that SHOW one — the full screens and
// an open Check-in sheet — and dropped everywhere else. A reload mid-tutorial
// reads it back and lands on the same sheet; a copied Teams link does not
// promise an activity nobody was looking at.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseClient", () => ({ isSupabaseConfigured: false, supabase: null }));

const { readWhere, writeWhere } = await import("./FacultyApp");

const query = () => Object.fromEntries(new URLSearchParams(window.location.search));

describe("where on the URL", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/ck");
  });

  it("an open check-in sheet is on the URL, and reads back", () => {
    writeWhere({ screen: "checkin", selId: "a1", courseId: null }, "replace");
    expect(query()).toEqual({ s: "checkin", a: "a1" });
    expect(readWhere()).toEqual({ screen: "checkin", selId: "a1", courseId: null });
  });

  it("the check-in picker carries no activity", () => {
    writeWhere({ screen: "checkin", selId: "a1", courseId: null }, "replace");
    writeWhere({ screen: "checkin", selId: null, courseId: null }, "replace");
    expect(query()).toEqual({ s: "checkin" });
  });

  it("screens that do not show an activity drop it", () => {
    writeWhere({ screen: "teams", selId: "a1", courseId: "c1" }, "replace");
    expect(query()).toEqual({ s: "teams", c: "c1" });
    writeWhere({ screen: "activities", selId: "a1", courseId: null }, "replace");
    expect(query()).toEqual({});
  });

  it("the full screens keep theirs", () => {
    writeWhere({ screen: "grade", selId: "a1", courseId: null }, "replace");
    expect(query()).toEqual({ s: "grade", a: "a1" });
  });
});
