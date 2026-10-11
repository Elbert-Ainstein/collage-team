import { describe, expect, it } from "vitest";
import { currentSetOf } from "./data";
import {
  allTeamsOf,
  frozenAt,
  frozenTeams,
  offerResync,
  RESYNC_WINDOW_MS,
  rosterDrift,
  teamIdsOf,
  teamsForActivity,
  type ActivityRoster,
} from "./rosters";
import type { Student, Team, TeamSet, TeamWithMembers } from "./types";

const student = (n: number): Student => ({
  id: `s${n}`,
  course_id: "c",
  name: `S${n}`,
  email: null,
  avatar_tint: null,
  position: n,
  created_at: "",
});
const team = (id: string, position: number, set = "set1"): Team => ({
  id,
  team_set_id: set,
  name: `Team ${position + 1}`,
  position,
  created_at: "",
});
const withMembers = (t: Team, ids: number[]): TeamWithMembers => ({ ...t, members: ids.map(student) });
const row = (activity: string, teamId: string, n: number, at = "2026-09-01T10:00:00Z"): ActivityRoster => ({
  activity_id: activity,
  team_id: teamId,
  student_id: `s${n}`,
  frozen_at: at,
});

const roster = [1, 2, 3, 4, 5, 6].map(student);
const t1 = team("t1", 0);
const t2 = team("t2", 1);

describe("frozenTeams", () => {
  it("groups each activity's rows into its own teams, members in roster order", () => {
    const rows = [
      row("w1", "t2", 4), row("w1", "t1", 2), row("w1", "t1", 1), row("w1", "t2", 3),
      row("w2", "t1", 3), row("w2", "t2", 1),
    ];
    const out = frozenTeams(rows, [t1, t2], roster);
    expect(out.get("w1")?.map((t) => [t.id, t.members.map((m) => m.id)])).toEqual([
      ["t1", ["s1", "s2"]],
      ["t2", ["s3", "s4"]],
    ]);
    expect(out.get("w2")?.map((t) => [t.id, t.members.map((m) => m.id)])).toEqual([
      ["t1", ["s3"]],
      ["t2", ["s1"]],
    ]);
    expect(out.has("w3")).toBe(false);
  });

  it("keeps a team it cannot name, rather than hiding its marks", () => {
    const out = frozenTeams([row("w1", "gone", 1)], [], roster);
    expect(out.get("w1")?.[0]).toMatchObject({ id: "gone", name: "Team" });
  });

  it("drops a student who has left the roster but keeps their team", () => {
    const out = frozenTeams([row("w1", "t1", 99), row("w1", "t1", 1)], [t1], roster);
    expect(out.get("w1")?.[0].members.map((m) => m.id)).toEqual(["s1"]);
  });
});

describe("teamsForActivity", () => {
  const today = [withMembers(t1, [5, 6])];
  it("is the frozen teams when there are any", () => {
    const frozen = new Map([["w1", [withMembers(t1, [1, 2])]]]);
    expect(teamsForActivity(frozen, "w1", today)[0].members.map((m) => m.id)).toEqual(["s1", "s2"]);
  });
  it("is today's teams for an activity nothing has been recorded on", () => {
    const frozen = new Map([["w1", [withMembers(t1, [1, 2])]]]);
    expect(teamsForActivity(frozen, "w9", today)).toBe(today);
    expect(teamsForActivity(undefined, "w1", today)).toBe(today);
  });
});

describe("allTeamsOf", () => {
  it("is today's teams, then each earlier team once", () => {
    const old = team("old", 0, "set0");
    const frozen = new Map([
      ["w1", [withMembers(old, [1])]],
      ["w2", [withMembers(old, [1]), withMembers(t1, [2])]],
    ]);
    expect(allTeamsOf({ frozenTeams: frozen, teams: [withMembers(t1, [5])] }).map((t) => t.id)).toEqual([
      "t1",
      "old",
    ]);
  });
});

describe("rosterDrift", () => {
  it("names who moved between the same team rows", () => {
    const frozen = [withMembers(t1, [1, 2]), withMembers(t2, [3, 4])];
    const today = [withMembers(t1, [1, 3]), withMembers(t2, [2, 4])];
    const d = rosterDrift(frozen, today);
    expect(d.sameTeams).toBe(true);
    expect(d.moved.map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  it("counts a late arrival and a leaver as moved", () => {
    const d = rosterDrift([withMembers(t1, [1, 2])], [withMembers(t1, [1, 5])]);
    expect(d.moved.map((s) => s.id)).toEqual(["s2", "s5"]);
  });

  it("says when today's teams are a different set altogether", () => {
    const d = rosterDrift([withMembers(t1, [1])], [withMembers(team("n1", 0, "set2"), [1])]);
    expect(d.sameTeams).toBe(false);
  });

  it("finds nothing when nothing moved", () => {
    const teams = [withMembers(t1, [1, 2])];
    expect(rosterDrift(teams, teams).moved).toEqual([]);
  });
});

describe("offerResync", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  it("offers today's teams during the session", () => {
    expect(offerResync("2026-10-09T10:00:00Z", now)).toBe(true);
  });
  it("never offers them on an old sheet — that would hand last week's marks to this week's teams", () => {
    expect(offerResync(new Date(now.getTime() - RESYNC_WINDOW_MS - 1).toISOString(), now)).toBe(false);
    expect(offerResync("2026-10-02T10:00:00Z", now)).toBe(false);
  });
  it("has nothing to offer on a sheet that is not frozen", () => {
    expect(offerResync(null, now)).toBe(false);
    expect(offerResync("not a date", now)).toBe(false);
  });
});

describe("frozenAt and teamIdsOf", () => {
  it("is the earliest freeze for that activity only", () => {
    const rows = [row("w1", "t1", 1, "2026-09-02T00:00:00Z"), row("w1", "t1", 2, "2026-09-01T00:00:00Z"), row("w2", "t1", 1, "2026-08-01T00:00:00Z")];
    expect(frozenAt(rows, "w1")).toBe("2026-09-01T00:00:00Z");
    expect(frozenAt(rows, "w3")).toBeNull();
  });
  it("maps each student to their team", () => {
    expect([...teamIdsOf([withMembers(t1, [1]), withMembers(t2, [2])])]).toEqual([
      ["s1", "t1"],
      ["s2", "t2"],
    ]);
  });
});

describe("currentSetOf", () => {
  const set = (id: string, activity: string | null): TeamSet => ({
    id,
    course_id: "c",
    activity_id: activity,
    name: null,
    team_size: 4,
    locked: false,
    created_at: "",
  });
  // listTeamSets order: oldest first.
  const sets = [set("act", "a1"), set("first", null), set("second", null)];

  it("is the set the course names", () => {
    expect(currentSetOf({ current_team_set_id: "second" }, sets)?.id).toBe("second");
  });
  it("falls back to the pick the app always made: the first whole-session set", () => {
    expect(currentSetOf({ current_team_set_id: null }, sets)?.id).toBe("first");
    expect(currentSetOf({}, sets)?.id).toBe("first");
  });
  it("falls back when the named set has been deleted", () => {
    expect(currentSetOf({ current_team_set_id: "deleted" }, sets)?.id).toBe("first");
  });
  it("is the newest set when none is whole-session, and null when there are none", () => {
    expect(currentSetOf({}, [set("a", "x"), set("b", "y")])?.id).toBe("b");
    expect(currentSetOf({}, [])).toBeNull();
  });
});
