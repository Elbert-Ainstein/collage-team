// Amplify's individual half is answered on Amplify.
//
// Nothing is handed in here for it: students answer on the other platform and
// the instructor marks from the report there. What is pinned here is that the
// half still EXISTS — the check-in, the mark, the grade, the export — and that
// an empty row stops being read as a missed deadline, which is what it was
// read as before: "Late", in amber, for a hand-in that was never theirs.

import { describe, expect, it } from "vitest";
import { statusOf, statusOfElsewhere } from "./studentData";
import { INDIV_ELSEWHERE, SCOPE_OF } from "./types";
import type { CheckInResult } from "./types";

const result = (status: CheckInResult["status"]): CheckInResult =>
  ({ id: "r1", status }) as CheckInResult;

/** Past its stage: what makes an empty row "Late" everywhere else. */
const OVERDUE = 2;
const OPEN = 0;

describe("which types are answered elsewhere", () => {
  it("is Amplify, and only Amplify", () => {
    expect(INDIV_ELSEWHERE.amplify).toBe("Amplify");
    expect(INDIV_ELSEWHERE.challenge).toBeNull();
    expect(INDIV_ELSEWHERE.combo).toBeNull();
    expect(INDIV_ELSEWHERE.skills).toBeNull();
  });

  it("leaves the activity's scope alone — the half still exists", () => {
    // The mark is still recorded here, so removing the upload button must not
    // remove the half it belongs to.
    expect(SCOPE_OF.amplify).toBe("both");
  });
});

describe("the status of a half nobody hands in", () => {
  it("does not accuse a student of being late", () => {
    expect(statusOf(null, OVERDUE)).toBe("Late");
    expect(statusOfElsewhere(null, OVERDUE)).toBe("Answered elsewhere");
  });

  it("says the same before the deadline, where the old word was 'Not started'", () => {
    expect(statusOf(null, OPEN)).toBe("Not started");
    expect(statusOfElsewhere(null, OPEN)).toBe("Answered elsewhere");
  });

  it("treats an empty row the same as no row — that is the normal state", () => {
    expect(statusOfElsewhere(result("none"), OVERDUE)).toBe("Answered elsewhere");
    expect(statusOfElsewhere(result("draft"), OVERDUE)).toBe("Answered elsewhere");
  });

  it("reports the mark exactly as everywhere else once it is made", () => {
    expect(statusOfElsewhere(result("scored"), OVERDUE)).toBe("Graded");
    expect(statusOfElsewhere(result("excused"), OVERDUE)).toBe("Excused");
    // Not reachable on Amplify today, but the rule is "only the empty states
    // are rewritten" and that is worth pinning rather than assuming.
    expect(statusOfElsewhere(result("submitted"), OVERDUE)).toBe("Turned in");
  });
});
