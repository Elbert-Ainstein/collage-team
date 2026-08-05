// A draft result row means "nothing has been handed in".
//
// Draft rows are created by opening a screen, not by doing work: MyWork makes
// one so a PDF has something to hang off, and the team half makes one so the
// recorder does. That makes "is there a row" a question about attention rather
// than about work, and every status read has to agree — otherwise merely
// looking at an overdue activity clears its Late badge, which is the one moment
// the badge exists for.

import { describe, expect, it } from "vitest";
import { statusOf } from "./studentData";
import type { CheckInResult, ResultStatus } from "./types";

function result(status: ResultStatus): CheckInResult {
  return {
    id: "r1",
    check_in_id: "ci1",
    subject_type: "student",
    student_id: "s1",
    team_id: null,
    status,
    score: null,
    is_ci: false,
    text: null,
    files: [],
    transcription: null,
    transcription_state: "none",
    flagged: false,
    submitted_at: null,
    feedback: null,
    updated_at: "2026-08-05T00:00:00Z",
  };
}

/** Stage 2 is past the point where missing work counts as overdue. */
const OVERDUE = 2;
const OPEN = 1;

describe("statusOf", () => {
  it("treats a draft exactly like no row at all", () => {
    for (const stage of [OPEN, OVERDUE]) {
      expect(statusOf(result("draft"), stage)).toBe(statusOf(null, stage));
      expect(statusOf(result("draft"), stage)).toBe(statusOf(result("none"), stage));
    }
  });

  it("keeps Late on overdue work that has only been looked at", () => {
    // The regression this guards: a draft fell through to the default arm and
    // came back "Not started", so opening the recorder on an overdue team
    // activity silently un-flagged it.
    expect(statusOf(result("draft"), OVERDUE)).toBe("Late");
    expect(statusOf(result("draft"), OPEN)).toBe("Not started");
  });

  it("still reports real states", () => {
    expect(statusOf(result("submitted"), OVERDUE)).toBe("Turned in");
    expect(statusOf(result("needs_review"), OVERDUE)).toBe("Turned in");
    expect(statusOf(result("scored"), OVERDUE)).toBe("Graded");
    expect(statusOf(result("discussing"), OVERDUE)).toBe("Discussing");
    expect(statusOf(result("excused"), OVERDUE)).toBe("Excused");
  });
});
