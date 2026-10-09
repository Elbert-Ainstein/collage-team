// A drafted seating, checked against the class as it is NOW and turned into the
// writes Apply would make. The model's refs are only trusted once they are found
// here; anything it invented is a problem that keeps Apply shut, and a draft
// that cannot be applied whole is not applied in part.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SeatProposal } from "@/assistant/types";
import { ada, alan, grace, kj, roster, team1, team2, teams } from "./fixtures";

const createTeam = vi.fn(async (_set: string, name: string, position: number) => ({
  id: `new-${name}`,
  team_set_id: "set1",
  name,
  position,
  created_at: "",
}));
const renameTeam = vi.fn(async () => undefined);
const moveStudents = vi.fn(async () => undefined);
const createTeamSet = vi.fn(async () => ({ id: "set-made" }));
const listTeamSets = vi.fn(async () => [] as { id: string; activity_id: string | null }[]);

const setCurrentTeamSet = vi.fn(async () => undefined);

vi.mock("@/checkins/data", async (importOriginal) => {
  const { currentSetOf, freshSetName } = await importOriginal<typeof import("@/checkins/data")>();
  return {
    createTeam,
    renameTeam,
    moveStudents,
    createTeamSet,
    listTeamSets,
    setCurrentTeamSet,
    currentSetIdOf: vi.fn(async () => null),
    currentSetOf,
    freshSetName,
  };
});

const { applyNewSet, applySeating, planSeating } = await import("./seating");

const refs = {
  students: new Map([
    ["s1", ada.id],
    ["s2", alan.id],
    ["s3", grace.id],
    ["s4", kj.id],
  ]),
  teams: new Map([
    ["t1", team1.id],
    ["t2", team2.id],
  ]),
};

function proposal(over: Partial<SeatProposal>): SeatProposal {
  return { kind: "seat", summary: "A change.", moves: [], renames: [], unresolved: [], ...over };
}

const move = (student: string, toTeam: string | null, toNewTeam: string | null = null) => ({
  student,
  toTeam,
  toNewTeam,
});

describe("planSeating", () => {
  it("moves a student between existing teams", () => {
    const s = planSeating(proposal({ moves: [move("s2", "t2")] }), refs, roster, teams);
    expect(s.problems).toEqual([]);
    expect(s.changes).toEqual([{ student: alan, from: "Team 1", fromIds: [team1.id], to: "Team 2", toNew: false }]);
    expect(s.groups).toEqual([{ teamId: team2.id, name: "Team 2", studentIds: [alan.id] }]);
    expect(s.after).toEqual([
      { name: "Team 1", count: 1, isNew: false },
      { name: "Team 2", count: 2, isNew: false },
    ]);
    expect(s.teamIds).toEqual([team1.id, team2.id]);
  });

  it("starts a new team for a name, once however many join it", () => {
    const s = planSeating(
      proposal({ moves: [move("s4", null, "Helix"), move("s3", null, "helix ")] }),
      refs,
      roster,
      teams,
    );
    expect(s.problems).toEqual([]);
    expect(s.newTeams).toEqual(["Helix"]);
    expect(s.groups).toEqual([{ teamId: null, name: "Helix", studentIds: [kj.id, grace.id] }]);
    expect(s.changes.map((c) => [c.student.name, c.from, c.to, c.toNew])).toEqual([
      ["Katherine Johnson", null, "Helix", true],
      ["Grace Hopper", "Team 2", "Helix", true],
    ]);
    expect(s.emptied).toEqual(["Team 2"]);
  });

  it("lands a 'new' team on the existing one of the same name instead of making a twin", () => {
    const s = planSeating(proposal({ moves: [move("s4", null, "team 2")] }), refs, roster, teams);
    expect(s.newTeams).toEqual([]);
    expect(s.groups).toEqual([{ teamId: team2.id, name: "Team 2", studentIds: [kj.id] }]);
  });

  it("leaves out a student who is already where the draft puts them", () => {
    const s = planSeating(proposal({ moves: [move("s1", "t1"), move("s2", "t2")] }), refs, roster, teams);
    expect(s.changes.map((c) => c.student.name)).toEqual(["Alan Turing"]);
  });

  it("renames, and shows the new name on the moves into that team", () => {
    const s = planSeating(
      proposal({ moves: [move("s4", "t2")], renames: [{ team: "t2", name: "Ribosome" }] }),
      refs,
      roster,
      teams,
    );
    expect(s.renames).toEqual([{ teamId: team2.id, from: "Team 2", to: "Ribosome" }]);
    expect(s.changes[0].to).toBe("Ribosome");
  });

  it("drops a rename to the name the team already has", () => {
    const s = planSeating(proposal({ renames: [{ team: "t1", name: "Team 1" }] }), refs, roster, teams);
    expect(s.renames).toEqual([]);
  });

  it("refuses a ref the class does not have", () => {
    const s = planSeating(proposal({ moves: [move("s9", "t1"), move("s1", "t7")] }), refs, roster, teams);
    expect(s.problems).toHaveLength(2);
    expect(s.problems.join(" ")).toMatch(/s9/);
    expect(s.problems.join(" ")).toMatch(/t7/);
  });

  it("refuses a student a ref names who has since left the roster", () => {
    const s = planSeating(proposal({ moves: [move("s4", "t1")] }), refs, [ada, alan, grace], teams);
    expect(s.problems.join(" ")).toMatch(/no longer on the roster/);
  });

  it("says each problem once, however many moves share it", () => {
    const s = planSeating(proposal({ moves: [move("s1", "t9"), move("s2", "t9"), move("s3", "t9")] }), refs, roster, teams);
    expect(s.problems).toHaveLength(1);
  });

  it("refuses one student on two teams", () => {
    const s = planSeating(proposal({ moves: [move("s4", "t1"), move("s4", "t2")] }), refs, roster, teams);
    expect(s.problems.join(" ")).toMatch(/Katherine Johnson.*two teams/);
  });

  it("refuses two teams ending up with one name", () => {
    const s = planSeating(proposal({ renames: [{ team: "t1", name: "Team 2" }] }), refs, roster, teams);
    expect(s.problems.join(" ")).toMatch(/Team 2/);
  });

  it("does not blame the draft for two teams that already shared a name", () => {
    const twin = { ...team2, id: "tm-twin", name: "Team 1", position: 2, members: [] };
    const s = planSeating(proposal({ moves: [move("s3", "t1")] }), refs, roster, [...teams, twin]);
    expect(s.problems).toEqual([]);
  });

  it("passes the unresolved entries through for the preview", () => {
    const unresolved = [{ entry: "Jon", reason: "Two Jons." }];
    expect(planSeating(proposal({ unresolved }), refs, roster, teams).unresolved).toEqual(unresolved);
  });
});

describe("applySeating", () => {
  beforeEach(() => {
    createTeam.mockClear();
    renameTeam.mockClear();
    moveStudents.mockClear();
    createTeamSet.mockClear();
  });

  it("renames, creates, then moves — clearing each student out of every team in the set", async () => {
    const s = planSeating(
      proposal({
        moves: [move("s2", "t2"), move("s4", null, "Helix")],
        renames: [{ team: "t1", name: "Vesicle" }],
      }),
      refs,
      roster,
      teams,
    );
    const out = await applySeating("c1", s);
    expect(out).toMatchObject({ moved: 2, created: 1, renamed: 1 });
    // What Undo needs: where each student was, where they went, what was made and renamed.
    expect(out.record).toEqual({
      moved: [
        { studentId: alan.id, from: [team1.id], to: team2.id },
        { studentId: kj.id, from: [], to: "new-Helix" },
      ],
      created: [{ teamId: "new-Helix", name: "Helix" }],
      renamed: [{ teamId: team1.id, from: "Team 1", to: "Vesicle" }],
    });
    expect(renameTeam).toHaveBeenCalledWith(team1.id, "Vesicle");
    expect(createTeam).toHaveBeenCalledWith("set1", "Helix", 2);
    const all = [team1.id, team2.id, "new-Helix"];
    expect(moveStudents).toHaveBeenCalledWith([alan.id], team2.id, all);
    expect(moveStudents).toHaveBeenCalledWith([kj.id], "new-Helix", all);
    // Every team is created before anyone moves.
    expect(createTeam.mock.invocationCallOrder[0]).toBeLessThan(moveStudents.mock.invocationCallOrder[0]);
  });

  it("makes a course-wide team set when the course has none yet", async () => {
    const s = planSeating(proposal({ moves: [move("s1", null, "Team 1")] }), refs, roster, []);
    await applySeating("c1", s);
    expect(createTeamSet).toHaveBeenCalledWith(expect.objectContaining({ courseId: "c1", activityId: null }));
    expect(createTeam).toHaveBeenCalledWith("set-made", "Team 1", 0);
  });

  it("writes nothing for a draft with problems", async () => {
    const s = planSeating(proposal({ moves: [move("s9", "t1")] }), refs, roster, teams);
    await expect(applySeating("c1", s)).rejects.toThrow();
    expect(moveStudents).not.toHaveBeenCalled();
    expect(renameTeam).not.toHaveBeenCalled();
  });
});

// "Make new teams" lands in a new set the class is moved onto; the set in use
// is not touched, so what is recorded on it stays with the people on it.
describe("applyNewSet", () => {
  beforeEach(() => {
    createTeam.mockClear();
    moveStudents.mockClear();
    createTeamSet.mockClear();
    setCurrentTeamSet.mockClear();
    listTeamSets.mockResolvedValue([]);
  });

  it("makes a set called New Set, fills it, and only then moves the class onto it", async () => {
    const order: string[] = [];
    createTeam.mockImplementation(async (_set: string, name: string, position: number) => {
      order.push(`team ${name}`);
      return { id: `new-${name}`, team_set_id: "set-made", name, position, created_at: "" };
    });
    setCurrentTeamSet.mockImplementation(async () => {
      order.push("current");
    });
    const out = await applyNewSet("c1", {
      size: 2,
      previousSetId: "set1",
      groups: [
        { name: "Team 1", studentIds: [ada.id, kj.id] },
        { name: "Team 2", studentIds: [alan.id, grace.id] },
      ],
    });
    expect(createTeamSet).toHaveBeenCalledWith({ courseId: "c1", activityId: null, name: "New Set", teamSize: 2 });
    // Into the new teams only: nobody is taken off their team in the old set.
    expect(moveStudents).toHaveBeenCalledWith([ada.id, kj.id], "new-Team 1", []);
    expect(moveStudents).toHaveBeenCalledWith([alan.id, grace.id], "new-Team 2", []);
    expect(order).toEqual(["team Team 1", "team Team 2", "current"]);
    expect(setCurrentTeamSet).toHaveBeenCalledWith("c1", "set-made");
    expect(out.record.newSet).toEqual({ courseId: "c1", setId: "set-made", name: "New Set", previousSetId: "set1" });
    expect(out.record.moved).toEqual([]);
  });

  it("does not make a second set called New Set", async () => {
    listTeamSets.mockResolvedValue([{ id: "x", activity_id: null, name: "New Set" } as never]);
    const out = await applyNewSet("c1", { size: 4, previousSetId: null, groups: [] });
    expect(out.setName).toBe("New Set 2");
  });
});
