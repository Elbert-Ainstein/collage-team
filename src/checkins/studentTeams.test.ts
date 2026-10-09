// A student who has been on more than one team (0045).
//
// After Kelly re-formed the class, a student was on a team in each set — and
// the student app took whichever membership row came back first, so they could
// land on last month's team. And an earlier week's team work was looked up
// against today's team, which had none of it. These pin both: today's team is
// the one in the class's current set, and each activity's team half is the
// team the student was on when it was recorded.

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Rows each table answers with. Filters are not modelled; each test sets only what it reads. */
let tables: Record<string, unknown[]> = {};
/** selectAll pages until a page comes back empty; answer each table's first page only. */
let paged = new Set<string>();

function client() {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from(table: string) {
      const answer = () => ({ data: tables[table] ?? [], error: null });
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

const { getEnrolment, listAssignments } = await import("./studentData");

const me = { id: "s1", course_id: "c1", name: "Ada", user_id: "u1", position: 1, email: null, avatar_tint: null, created_at: "" };
const course = { id: "c1", name: "AP 50", current_team_set_id: "setNew" };
const team = (id: string, set: string) => ({ id, team_set_id: set, name: id, position: 0, created_at: "" });

beforeEach(() => {
  paged = new Set();
  tables = {
    students: [me],
    courses: [course],
    team_members: [
      { team_id: "tOld", student_id: "s1" },
      { team_id: "tNew", student_id: "s1" },
    ],
    teams: [team("tOld", "setOld"), team("tNew", "setNew")],
    team_sets: [
      { id: "setOld", course_id: "c1", activity_id: null, created_at: "2026-09-01" },
      { id: "setNew", course_id: "c1", activity_id: null, created_at: "2026-10-01" },
    ],
  };
});

describe("the student's team", () => {
  it("is the one in the class's current set, whatever order the rows come back in", async () => {
    expect((await getEnrolment())?.team?.id).toBe("tNew");
    tables.teams = [team("tNew", "setNew"), team("tOld", "setOld")];
    expect((await getEnrolment())?.team?.id).toBe("tNew");
  });

  it("is no team when they are not on one in the current set yet", async () => {
    tables.team_members = [{ team_id: "tOld", student_id: "s1" }];
    tables.teams = [team("tOld", "setOld")];
    expect((await getEnrolment())?.team).toBeNull();
  });
});

describe("each activity's team half", () => {
  it("reads the team they were on when it was recorded, and today's team otherwise", async () => {
    const enrolment = { student: me, course, team: team("tNew", "setNew"), teammates: [] } as never;
    tables.activities = [
      { id: "a1", course_id: "c1", week: 1, title: "Week 1", type: "challenge", stage: 4, opens_at: null },
      { id: "a2", course_id: "c1", week: 2, title: "Week 2", type: "challenge", stage: 1, opens_at: null },
    ];
    tables.check_ins = [
      { id: "c1", activity_id: "a1", kind: "team", scale: "points", max_points: 10 },
      { id: "c2", activity_id: "a2", kind: "team", scale: "points", max_points: 10 },
    ];
    tables.check_in_results = [
      // Week 1 was handed in by the old team, and the new team has nothing for it.
      { id: "r1", check_in_id: "c1", subject_type: "team", team_id: "tOld", status: "scored", score: 9 },
      { id: "r2", check_in_id: "c2", subject_type: "team", team_id: "tNew", status: "submitted" },
    ];
    tables.activity_rosters = [{ activity_id: "a1", team_id: "tOld", student_id: "s1", frozen_at: "2026-09-08" }];
    tables.hand_in_reopens = [];

    const list = await listAssignments(enrolment);
    const week = (id: string) => list.find((a) => a.activity.id === id)!;
    expect(week("a1").teamId).toBe("tOld");
    expect(week("a1").teamResult?.id).toBe("r1");
    expect(week("a2").teamId).toBe("tNew");
    expect(week("a2").teamResult?.id).toBe("r2");
  });
});
