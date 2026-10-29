// A student their team's leader ticked absent for a live session (0051) gets
// none of the team's points for it. The team's row is the team's — everyone
// else on it still reads the team's number — so the zero is decided here, on
// the student's own list, from their own tutorial_absences row (0031).

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Rows each table answers with. Filters are not modelled; each test sets only what it reads. */
let tables: Record<string, unknown[]> = {};
/** Tables whose read fails, as a dropped connection or a policy would. */
let failing = new Set<string>();
/** selectAll pages until a page comes back empty; answer each table's first page only. */
let paged = new Set<string>();

function client() {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from(table: string) {
      const answer = () =>
        failing.has(table)
          ? { data: null, error: { message: "network down", code: "" } }
          : { data: tables[table] ?? [], error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        range: async () => {
          if (paged.has(table)) return { data: [], error: null };
          paged.add(table);
          return answer();
        },
        then: <T>(resolve: (v: ReturnType<typeof answer>) => T) => Promise.resolve(answer()).then(resolve),
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabaseClient", () => ({
  requireSupabase: () => client(),
  isSupabaseConfigured: true,
}));

const { listAssignments } = await import("./studentData");

const me = { id: "s1", course_id: "c1", name: "Ada", user_id: "u1", position: 1, email: null, avatar_tint: null, created_at: "" };
const course = { id: "c1", name: "AP 50", current_team_set_id: "set1" };
const team = { id: "t1", team_set_id: "set1", name: "Team 1", position: 0, created_at: "" };
const enrolment = { student: me, course, team, teammates: [] } as never;

beforeEach(() => {
  paged = new Set();
  failing = new Set();
  tables = {
    activities: [
      { id: "live1", course_id: "c1", week: 2, title: "Live", type: "live", stage: 4, opens_at: null },
      { id: "ch1", course_id: "c1", week: 1, title: "Challenge", type: "challenge", stage: 4, opens_at: null },
    ],
    check_ins: [
      { id: "ci-live", activity_id: "live1", kind: "team", scale: "points", max_points: 10 },
      { id: "ci-ch", activity_id: "ch1", kind: "team", scale: "points", max_points: 10 },
    ],
    check_in_results: [
      { id: "r-live", check_in_id: "ci-live", subject_type: "team", team_id: "t1", status: "scored", score: 8, is_ci: false },
      { id: "r-ch", check_in_id: "ci-ch", subject_type: "team", team_id: "t1", status: "scored", score: 7, is_ci: false },
    ],
    activity_rosters: [{ activity_id: "live1", team_id: "t1", student_id: "s1", frozen_at: "2026-10-01" }],
    hand_in_reopens: [],
    live_state: [],
    tutorial_absences: [],
  };
});

const find = async (id: string) => (await listAssignments(enrolment)).find((a) => a.activity.id === id)!;

describe("the team half of a live activity", () => {
  it("is the team's number for a student who was there", async () => {
    const a = await find("live1");
    expect(a.teamAbsent).toBeFalsy();
    expect(a.teamGrade).toBe("8 / 10");
  });

  it("is 0 for a student marked absent, while the team's row stays the team's", async () => {
    tables.tutorial_absences = [{ activity_id: "live1", team_id: "t1", student_id: "s1" }];
    const a = await find("live1");
    expect(a.teamAbsent).toBe(true);
    expect(a.teamGrade).toBe("0 / 10 · absent");
    expect(a.teamResult?.id).toBe("r-live");
  });

  it("says nothing before the session is scored, absent or not", async () => {
    tables.tutorial_absences = [{ activity_id: "live1", team_id: "t1", student_id: "s1" }];
    tables.check_in_results = [];
    const a = await find("live1");
    expect(a.teamAbsent).toBe(true);
    expect(a.teamGrade).toBe("—");
  });

  it("leaves other activities' team halves alone, absence rows or not", async () => {
    tables.tutorial_absences = [{ activity_id: "ch1", team_id: "t1", student_id: "s1" }];
    const a = await find("ch1");
    expect(a.teamAbsent).toBeFalsy();
    expect(a.teamGrade).toBe("7 / 10");
  });

  it("falls back to the team's number when the absence read fails, rather than losing the list", async () => {
    tables.tutorial_absences = [{ activity_id: "live1", team_id: "t1", student_id: "s1" }];
    failing = new Set(["tutorial_absences"]);
    const a = await find("live1");
    expect(a.teamAbsent).toBeFalsy();
    expect(a.teamGrade).toBe("8 / 10");
  });
});
