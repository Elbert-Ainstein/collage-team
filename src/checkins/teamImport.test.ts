// Two questions, both of which are wrong silently.
//
// Who a row is about: a wrong answer puts a student on a team they were never
// on, and nothing on the screen looks broken — Kelly finds out in the room,
// when a group of four is a group of three and somebody is standing up.
//
// What happens to everyone the file does not settle: the rule is that they stay
// where they are, and the failure it guards against is a file exported before
// the last three students joined by class code quietly emptying their team.
//
// The third thing pinned here is that this import never deletes a team. Teams
// carry the whiteboard photos and the team recordings, storage does not cascade
// (see purge.ts), and an import that dropped teams to rebuild them would take a
// term of them with no warning at all.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedStudent } from "./rosterImport";
import type { Student, Team, TeamSet, TeamWithMembers } from "./types";

const createTeam = vi.fn(
  async (teamSetId: string, name: string, position: number): Promise<Team> => ({
    id: `new:${name}`,
    team_set_id: teamSetId,
    name,
    position,
    created_at: "",
  }),
);
const createTeamSet = vi.fn(
  async (input: { courseId: string; activityId?: string | null }): Promise<TeamSet> => ({
    id: "set:made",
    course_id: input.courseId,
    activity_id: input.activityId ?? null,
    name: null,
    team_size: null,
    locked: false,
    created_at: "",
  }),
);
const listTeamSets = vi.fn(async (): Promise<TeamSet[]> => []);
const moveStudents = vi.fn(async () => undefined);

vi.mock("./data", () => ({ createTeam, createTeamSet, listTeamSets, moveStudents }));

const { applyTeamPlan, hasTeamNumbers, missReason, planTeamImport } = await import("./teamImport");

let position = 0;
function student(id: string, name: string, email: string | null): Student {
  return {
    id,
    user_id: null,
    course_id: "c1",
    name,
    email,
    avatar_tint: null,
    position: position++,
    created_at: "",
  };
}

function team(id: string, name: string, pos: number, members: Student[]): TeamWithMembers {
  return { id, team_set_id: "ts1", name, position: pos, created_at: "", members };
}

/** Omitting `team` gives a row from a file with no team column at all. */
function row(name: string, email?: string, team?: number | null): ParsedStudent {
  const base: ParsedStudent = email ? { name, email } : { name };
  return team === undefined ? base : { ...base, team };
}

const ADA = student("s1", "Ada Lovelace", "ada@x.edu");
const GRACE = student("s2", "Grace Hopper", "grace@x.edu");
const ALAN = student("s3", "Alan Turing", null);
const KATH = student("s4", "Katherine Johnson", "kj@x.edu");
const ROSTER = [ADA, GRACE, ALAN, KATH];

const plan = (rows: ParsedStudent[], teams: TeamWithMembers[] = [], roster = ROSTER) =>
  planTeamImport({ roster, rows, teams });

const numbered = (p: ReturnType<typeof plan>, n: number) => {
  const t = p.teams.find((x) => x.number === n);
  if (!t) throw new Error(`no planned team ${n}`);
  return t;
};

beforeEach(() => {
  createTeam.mockClear();
  createTeamSet.mockClear();
  moveStudents.mockClear();
  listTeamSets.mockClear();
  listTeamSets.mockImplementation(async () => []);
});

describe("which student a row is about", () => {
  it("matches on the address when the file spells the name differently", () => {
    const p = plan([row("A. Lovelace", "ada@x.edu", 1)]);
    expect(p.placements).toEqual([{ student: ADA, team: 1, by: "email" }]);
  });

  it("matches on the name when the file has no addresses at all", () => {
    // Kelly's own spreadsheet is the case: names and a team number, nothing else.
    const p = plan([row("Alan Turing", undefined, 2)]);
    expect(p.placements).toEqual([{ student: ALAN, team: 2, by: "name" }]);
  });

  it("lets the address win when the name in the file belongs to somebody else", () => {
    const p = plan([row("Grace Hopper", "ada@x.edu", 1)]);
    expect(p.placements.map((x) => x.student.id)).toEqual(["s1"]);
  });

  it("ignores case and surrounding space on both", () => {
    const p = plan([row("  ada lovelace ", "ADA@X.EDU", 1)]);
    expect(p.placements.map((x) => x.student.id)).toEqual(["s1"]);
  });

  it("refuses a name two students share, and says who both are", () => {
    const one = student("s5", "Alex Chen", null);
    const two = student("s6", "Alex Chen", "alex.chen@x.edu");
    const p = plan([row("Alex Chen", undefined, 1)], [], [...ROSTER, one, two]);

    expect(p.placements).toEqual([]);
    expect(p.unplaced).toHaveLength(1);
    expect(p.unplaced[0].why).toBe("ambiguous");
    expect(missReason(p.unplaced[0])).toContain("alex.chen@x.edu");
    expect(missReason(p.unplaced[0])).toContain("no address");
  });

  it("places the one the address identifies when two share a name", () => {
    const one = student("s5", "Alex Chen", null);
    const two = student("s6", "Alex Chen", "alex.chen@x.edu");
    const p = plan([row("Alex Chen", "alex.chen@x.edu", 1)], [], [...ROSTER, one, two]);

    expect(p.placements.map((x) => x.student.id)).toEqual(["s6"]);
    expect(p.unplaced).toEqual([]);
  });

  it("gives one student to one team when the file lists them twice", () => {
    // Which team wins would otherwise be whichever row the matcher reached
    // last, which is the same file importing differently on different days.
    const p = plan([row("Ada Lovelace", "ada@x.edu", 1), row("Ada Lovelace", undefined, 2)]);

    expect(p.placements).toEqual([{ student: ADA, team: 1, by: "email" }]);
    expect(p.unplaced[0].why).toBe("already-matched");
    expect(missReason(p.unplaced[0])).toContain("Ada Lovelace");
  });

  it("creates nobody for a row that matches nobody", () => {
    const p = plan([row("Adah Lovelace", "adah@x.edu", 1), row("Grace Hopper", "grace@x.edu", 1)]);

    expect(p.placements.map((x) => x.student.id)).toEqual(["s2"]);
    expect(p.unplaced[0].why).toBe("not-on-roster");
    expect(missReason(p.unplaced[0])).toContain("Add them above");
    // Nothing invented: every name in the plan is a roster row.
    const inTeams = p.teams.flatMap((t) => t.members.map((m) => m.id));
    expect(inTeams.every((id) => ROSTER.some((s) => s.id === id))).toBe(true);
  });

  it("says nothing about an unmatched row that was not asking for a team", () => {
    // The roster import already reports this one. Saying it twice on one screen
    // reads as two problems.
    const p = plan([row("Adah Lovelace", "adah@x.edu", null), row("Ada Lovelace", "ada@x.edu", 1)]);
    expect(p.unplaced).toEqual([]);
  });
});

describe("students the file does not settle", () => {
  const T1 = team("t1", "Team 1", 0, [ADA, GRACE]);
  const T2 = team("t2", "Team 2", 1, [ALAN, KATH]);

  it("leaves a student the file never mentions on the team they are on", () => {
    const p = plan([row("Ada Lovelace", "ada@x.edu", 2)], [T1, T2]);

    expect(numbered(p, 2).members.map((m) => m.id)).toEqual(["s1", "s3", "s4"]);
    const left = p.teams.find((t) => t.existingId === "t1");
    expect(left?.members.map((m) => m.id)).toEqual(["s2"]);
    expect(p.notInFile.map((s) => s.id)).toEqual(["s2", "s3", "s4"]);
  });

  it("leaves a student whose team cell is blank where they are", () => {
    const p = plan([row("Grace Hopper", "grace@x.edu", null)], [T1, T2]);

    expect(p.placements).toEqual([]);
    expect(p.noNumber).toHaveLength(1);
    // Mentioned, so not "missing from the file" — but not moved either.
    expect(p.notInFile.map((s) => s.id)).not.toContain("s2");
    expect(p.teams.find((t) => t.existingId === "t1")?.members.map((m) => m.id)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("takes nobody off a team, whoever the file leaves out", () => {
    const p = plan([row("Ada Lovelace", "ada@x.edu", 2)], [T1, T2]);

    const placed = p.teams.flatMap((t) => t.members.map((m) => m.id)).sort();
    expect(placed).toEqual(["s1", "s2", "s3", "s4"]);
  });
});

describe("the teams that are already there", () => {
  it("finds the team whose name says the number, and keeps its name", () => {
    const teams = [team("t1", "Team 1", 0, []), team("t2", "Team 2", 1, [])];
    const p = plan([row("Ada Lovelace", "ada@x.edu", 2)], teams);

    expect(numbered(p, 2).existingId).toBe("t2");
    expect(numbered(p, 2).name).toBe("Team 2");
  });

  it("matches teams with no number in their name in the order they sit in", () => {
    // What auto-forming produces — Team Helix, Team Ribosome — and what a
    // rename produces. The number identifies the team; the name is hers.
    const teams = [team("t1", "The Quarks", 0, [ADA]), team("t2", "The Leptons", 1, [GRACE])];
    const p = plan(
      [row("Ada Lovelace", "ada@x.edu", 2), row("Grace Hopper", "grace@x.edu", 1)],
      teams,
    );

    expect(numbered(p, 1).existingId).toBe("t1");
    // The file's NUMBER names the team. A team called The Quarks that the
    // spreadsheet says is 1 becomes Team 1, so the two can never disagree about
    // the same group of people — and re-importing the file lands identically
    // however it was renamed in between.
    expect(numbered(p, 1).name).toBe("Team 1");
    expect(numbered(p, 1).currentName).toBe("The Quarks");
    expect(numbered(p, 1).members.map((m) => m.id)).toEqual(["s2"]);
    expect(numbered(p, 2).name).toBe("Team 2");
    expect(numbered(p, 2).members.map((m) => m.id)).toEqual(["s1"]);
  });

  it("never rebinds a team whose name says a different number", () => {
    const teams = [team("t9", "Team 9", 0, [ADA])];
    const p = plan([row("Ada Lovelace", "ada@x.edu", 1)], teams);

    expect(numbered(p, 1).existingId).toBeNull();
    expect(numbered(p, 1).name).toBe("Team 1");
    expect(p.teams.find((t) => t.existingId === "t9")?.number).toBeNull();
  });

  it("calls a team it has to invent Team N", () => {
    const p = plan([row("Ada Lovelace", "ada@x.edu", 3)]);
    expect(numbered(p, 3)).toMatchObject({ name: "Team 3", existingId: null });
  });

  it("marks a team the file empties, and keeps it", () => {
    const teams = [team("t1", "Team 1", 0, [ADA]), team("t2", "Team 2", 1, [GRACE])];
    const p = plan(
      [row("Ada Lovelace", "ada@x.edu", 2), row("Grace Hopper", "grace@x.edu", 2)],
      teams,
    );

    const one = p.teams.find((t) => t.existingId === "t1");
    expect(one?.emptied).toBe(true);
    expect(one?.members).toEqual([]);
    // Still in the plan, so the write still knows to move people out of it.
    expect(p.teams.map((t) => t.existingId)).toContain("t1");
  });

  it("does not call an already-empty team newly emptied", () => {
    const p = plan([row("Ada Lovelace", "ada@x.edu", 1)], [team("t7", "Team 7", 0, [])]);
    expect(p.teams.find((t) => t.existingId === "t7")?.emptied).toBe(false);
  });
});

describe("writing it", () => {
  it("creates only the teams that have none, and never deletes one", async () => {
    const teams = [team("t1", "Team 1", 0, [ADA]), team("t2", "Team 2", 1, [GRACE])];
    const p = plan(
      [row("Ada Lovelace", "ada@x.edu", 1), row("Grace Hopper", "grace@x.edu", 3)],
      teams,
    );
    const out = await applyTeamPlan("c1", p);

    expect(out).toEqual({ setId: "ts1", created: 1, renamed: 0, moved: 2 });
    expect(createTeam.mock.calls).toEqual([["ts1", "Team 3", 2]]);
    expect(createTeamSet).not.toHaveBeenCalled();
  });

  it("clears members out of teams the file never mentions", async () => {
    // The load-bearing argument. Team 2 is not in the file, so if its id is
    // missing from the list moveStudents deletes across, Grace stays on Team 2
    // AND lands on Team 3 — and gets checked in twice, on two teams.
    const teams = [team("t1", "Team 1", 0, [ADA]), team("t2", "Team 2", 1, [GRACE])];
    const p = plan([row("Grace Hopper", "grace@x.edu", 3)], teams);
    await applyTeamPlan("c1", p);

    expect(moveStudents.mock.calls).toEqual([[["s2"], "new:Team 3", ["t1", "t2", "new:Team 3"]]]);
  });

  it("makes a course-wide set when the course has none", async () => {
    const p = plan([row("Ada Lovelace", "ada@x.edu", 1)]);
    const out = await applyTeamPlan("c1", p);

    expect(createTeamSet).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "c1", activityId: null }),
    );
    expect(out.setId).toBe("set:made");
    expect(createTeam).toHaveBeenCalledWith("set:made", "Team 1", 0);
  });

  it("writes into the course-wide set the roster screen reads teams from", async () => {
    const set = (id: string, activityId: string | null): TeamSet => ({
      id,
      course_id: "c1",
      activity_id: activityId,
      name: null,
      team_size: null,
      locked: false,
      created_at: "",
    });
    listTeamSets.mockImplementation(async () => [set("week-3", "a1"), set("whole", null)]);

    const out = await applyTeamPlan("c1", plan([row("Ada Lovelace", "ada@x.edu", 1)]));
    expect(out.setId).toBe("whole");
  });

  it("writes nothing at all when the file matched nobody", async () => {
    // Otherwise a file with every name misspelled leaves a new empty team set
    // behind as the only trace of an import that did nothing.
    const out = await applyTeamPlan("c1", plan([row("Nobody At All", "nobody@x.edu", 4)]));

    expect(out).toEqual({ setId: null, created: 0, renamed: 0, moved: 0 });
    expect(createTeamSet).not.toHaveBeenCalled();
    expect(createTeam).not.toHaveBeenCalled();
    expect(moveStudents).not.toHaveBeenCalled();
  });
});

describe("hasTeamNumbers", () => {
  it("is false for the roster files this app has always taken", () => {
    expect(hasTeamNumbers([row("Ada Lovelace", "ada@x.edu")])).toBe(false);
  });

  it("is false when the column is there but every cell is blank", () => {
    expect(hasTeamNumbers([row("Ada Lovelace", "ada@x.edu", null)])).toBe(false);
  });

  it("is true as soon as one row carries a number", () => {
    expect(hasTeamNumbers([row("Ada", undefined, null), row("Grace", undefined, 2)])).toBe(true);
  });
});
