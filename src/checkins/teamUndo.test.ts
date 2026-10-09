// Undoing an applied draft: put back exactly what it changed, and nothing it
// did not. Everything here is checked against the class as it is NOW, because
// between Apply and Undo she may have moved people by hand — and an undo that
// dragged them back over her own later change would be a second surprise.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ada, alan, grace, kj, roster, team, team1, team2 } from "@/faculty/assistant/fixtures";

const moveStudents = vi.fn(async () => undefined);
const renameTeam = vi.fn(async () => undefined);
const deleteTeam = vi.fn(async () => undefined);
const countOneTeamResults = vi.fn(async () => 0);
const countOneTeamMarks = vi.fn(async (_teamId: string) => 0);
const deleteTeamSet = vi.fn(async () => undefined);
const setCurrentTeamSet = vi.fn(async () => undefined);
vi.mock("./data", () => ({
  moveStudents,
  renameTeam,
  deleteTeam,
  deleteTeamSet,
  setCurrentTeamSet,
  countOneTeamResults,
  countOneTeamMarks,
}));
const countResourcesForTeams = vi.fn(async () => 0);
vi.mock("./resources", () => ({ countResourcesForTeams }));

const {
  applyTeamUndo: applyUndo,
  planTeamUndo: planUndo,
  teamUndoText: undoText,
  undoNewSet,
} = await import("./teamUndo");

// After a draft that moved Alan from Team 1 to Team 2, put Katherine (no team
// before) on a new team Helix, and renamed Team 1 to Vesicle.
const helixAfter = team("tm-helix", "Helix", 2, [kj]);
const team1After = { ...team1, name: "Vesicle", members: [ada] };
const team2After = { ...team2, members: [grace, alan] };
const teamsAfter = [team1After, team2After, helixAfter];
const record = {
  moved: [
    { studentId: alan.id, from: [team1.id], to: team2.id },
    { studentId: kj.id, from: [], to: helixAfter.id },
  ],
  created: [{ teamId: helixAfter.id, name: "Helix" }],
  renamed: [{ teamId: team1.id, from: "Team 1", to: "Vesicle" }],
};

beforeEach(() => vi.clearAllMocks());

describe("planUndo", () => {
  it("puts everyone back, renames back, and removes the team it made", () => {
    const p = planUndo(record, roster, teamsAfter);
    expect(p.restore).toEqual([
      { student: alan, to: [team1.id] },
      { student: kj, to: [] },
    ]);
    expect(p.renameBack).toEqual([{ teamId: team1.id, to: "Team 1" }]);
    expect(p.remove).toEqual([{ teamId: helixAfter.id, name: "Helix" }]);
    expect(p.stayed).toEqual([]);
    expect(p.kept).toEqual([]);
  });

  it("leaves a student she has moved since where she put them", () => {
    const moved = [team1After, { ...team2After, members: [grace] }, { ...helixAfter, members: [kj, alan] }];
    const p = planUndo(record, roster, moved);
    expect(p.restore.map((r) => r.student.name)).toEqual(["Katherine Johnson"]);
    expect(p.stayed).toEqual([{ name: "Alan Turing", why: "has been moved since" }]);
    // Alan is on Helix now, by her hand — so Helix is not empty and stays.
    expect(p.remove).toEqual([]);
    expect(p.kept[0].name).toBe("Helix");
  });

  it("skips a student no longer on the roster", () => {
    const p = planUndo(record, [ada, alan, grace], teamsAfter);
    expect(p.stayed).toEqual([{ name: "a student", why: "is no longer on the roster" }]);
  });

  it("leaves a team renamed again since with the name she gave it", () => {
    const p = planUndo(record, roster, [{ ...team1After, name: "Ribosome" }, team2After, helixAfter]);
    expect(p.renameBack).toEqual([]);
    expect(p.kept).toEqual([{ name: "Ribosome", why: "has been renamed again since, so it keeps that name" }]);
  });
});

describe("applyUndo", () => {
  const ids = [team1.id, team2.id, helixAfter.id];

  it("moves everyone back, clearing them out of every team, then removes the empty new team", async () => {
    const out = await applyUndo(planUndo(record, roster, teamsAfter));
    expect(moveStudents).toHaveBeenCalledWith([alan.id], team1.id, ids);
    // On no team before: taken off every team in the set, put on none.
    expect(moveStudents).toHaveBeenCalledWith([kj.id], null, ids);
    expect(renameTeam).toHaveBeenCalledWith(team1.id, "Team 1");
    expect(deleteTeam).toHaveBeenCalledWith(helixAfter.id);
    expect(deleteTeam.mock.invocationCallOrder[0]).toBeGreaterThan(moveStudents.mock.invocationCallOrder[1]);
    expect(out).toEqual({ restored: 2, renamedBack: 1, removed: 1, notes: [] });
    expect(undoText(out)).toBe("Undone — moved 2 students back, renamed 1 team back, removed 1 team it made.");
  });

  it("keeps a new team that has a score, a mark or a photo on it now", async () => {
    for (const counter of [countOneTeamResults, countOneTeamMarks, countResourcesForTeams]) {
      vi.clearAllMocks();
      counter.mockResolvedValueOnce(1);
      const out = await applyUndo(planUndo(record, roster, teamsAfter));
      expect(deleteTeam).not.toHaveBeenCalled();
      expect(out.removed).toBe(0);
      expect(out.notes.join(" ")).toMatch(/Helix.*left in place/);
    }
  });

  it("keeps the team when its work cannot be counted, rather than guessing there is none", async () => {
    countOneTeamMarks.mockRejectedValueOnce(new Error("offline"));
    const out = await applyUndo(planUndo(record, roster, teamsAfter));
    expect(deleteTeam).not.toHaveBeenCalled();
    expect(out.notes.join(" ")).toMatch(/Helix/);
  });
});

describe("planUndo — a second press after an undo that failed part-way", () => {
  it("passes over what is already back, rather than calling it moved since", () => {
    // Alan made it back to Team 1 and the name came back; Katherine did not.
    const half = [{ ...team1, members: [ada, alan] }, { ...team2, members: [grace] }, helixAfter];
    const p = planUndo(record, roster, half);
    expect(p.restore.map((r) => r.student.name)).toEqual(["Katherine Johnson"]);
    expect(p.stayed).toEqual([]);
    expect(p.renameBack).toEqual([]);
    expect(p.kept).toEqual([]);
    expect(p.remove).toEqual([{ teamId: helixAfter.id, name: "Helix" }]);
  });
});


describe("undoNewSet", () => {
  const madeSet = {
    moved: [],
    created: [
      { teamId: "n1", name: "Team 1" },
      { teamId: "n2", name: "Team 2" },
    ],
    renamed: [],
    newSet: { courseId: "c1", setId: "set-new", name: "New Set", previousSetId: "set-old" },
  };

  it("moves the class back onto its old set, then removes the new one", async () => {
    const out = await undoNewSet(madeSet);
    expect(setCurrentTeamSet).toHaveBeenCalledWith("c1", "set-old");
    expect(deleteTeamSet).toHaveBeenCalledWith("set-new");
    expect(out).toMatchObject({ switchedBack: true, removed: 2, notes: [] });
  });

  it("keeps the new set, out of use, once anything has been recorded on it", async () => {
    countOneTeamMarks.mockImplementation(async (id: string) => (id === "n2" ? 1 : 0));
    const out = await undoNewSet(madeSet);
    expect(setCurrentTeamSet).toHaveBeenCalledWith("c1", "set-old");
    expect(deleteTeamSet).not.toHaveBeenCalled();
    expect(out.notes[0]).toMatch(/recorded on Team 2/);
  });
});
