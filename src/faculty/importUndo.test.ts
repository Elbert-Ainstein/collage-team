// Undoing a class-list import on Roster & teams.
//
// An import does four things — adds students, fills in addresses, corrects
// names, seats everyone — and Undo puts back each one only while it is still
// as the import left it. The roster half is the dangerous half: removing a row
// removes the student, so a row goes only if nobody has signed in as them and
// they have handed in nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";

const moveStudents = vi.fn(async () => undefined);
const renameTeam = vi.fn(async () => undefined);
const deleteTeam = vi.fn(async () => undefined);
const setStudentEmail = vi.fn(async () => undefined);
const setStudentName = vi.fn(async () => undefined);
vi.mock("@/checkins/data", () => ({
  moveStudents,
  renameTeam,
  deleteTeam,
  setStudentEmail,
  setStudentName,
  countOneTeamResults: vi.fn(async () => 0),
  countOneTeamMarks: vi.fn(async () => 0),
}));
vi.mock("@/checkins/resources", () => ({ countResourcesForTeams: vi.fn(async () => 0) }));
const removeStudentWithStorage = vi.fn(async () => undefined);
vi.mock("@/checkins/purge", () => ({ removeStudentWithStorage }));
const countWorkForStudent = vi.fn(async () => 0);
vi.mock("@/faculty/facultyData", () => ({ countWorkForStudent }));

const { importRecord, importUndoText, planImportUndo, undoImport } = await import("./importUndo");

function student(id: string, name: string, email: string | null, userId: string | null = null): Student {
  return { id, user_id: userId, course_id: "c1", name, email, avatar_tint: null, position: 0, created_at: "" };
}
function team(id: string, name: string, members: Student[]): TeamWithMembers {
  return { id, team_set_id: "set", name, position: 0, created_at: "", members };
}

// Before: Ada on Team 1 with no address; Bob on Team 1, spelled "Bob Smyth".
const ada = student("ada", "Ada Lovelace", null);
const bob = student("bob", "Bob Smyth", "bob@x.edu");
const before = [team("t1", "Team 1", [ada, bob])];
// The import added Mary, gave Ada her address, corrected Bob to "Bob Smith",
// made Team 2, and moved Ada and Mary onto it. Bob was "placed" on Team 1, where he already was.
const mary = student("mary", "Mary Jackson", "mary@x.edu");
const record = importRecord({
  before,
  added: [mary],
  emails: [{ student: ada, email: "ada@x.edu" }],
  names: [{ student: bob, to: "Bob Smith" }],
  teams: {
    placed: [
      { studentId: "ada", to: "t2" },
      { studentId: "mary", to: "t2" },
      { studentId: "bob", to: "t1" },
    ],
    created: [{ teamId: "t2", name: "Team 2" }],
    renamed: [],
  },
});

// After the import, as the screen sees it once refreshed.
const adaAfter = { ...ada, email: "ada@x.edu" };
const bobAfter = { ...bob, name: "Bob Smith" };
const rosterAfter = [adaAfter, bobAfter, mary];
const teamsAfter = [team("t1", "Team 1", [bobAfter]), team("t2", "Team 2", [adaAfter, mary])];

beforeEach(() => vi.clearAllMocks());

describe("importRecord", () => {
  it("records where each student was, and leaves out a placement that changed nothing", () => {
    expect(record.teams.moved).toEqual([
      { studentId: "ada", from: ["t1"], to: "t2" },
      { studentId: "mary", from: [], to: "t2" },
    ]);
    expect(record.added).toEqual([{ studentId: "mary", name: "Mary Jackson" }]);
    expect(record.emails).toEqual([{ studentId: "ada", from: null, to: "ada@x.edu" }]);
    expect(record.names).toEqual([{ studentId: "bob", from: "Bob Smyth", to: "Bob Smith" }]);
  });
});

describe("planImportUndo", () => {
  it("plans to put everything back while it is still as the import left it", () => {
    const p = planImportUndo(record, rosterAfter, teamsAfter);
    expect(p.remove).toEqual([mary]);
    expect(p.emailsBack).toEqual([{ student: adaAfter, to: null }]);
    expect(p.namesBack).toEqual([{ student: bobAfter, to: "Bob Smyth" }]);
    expect(p.teams.restore.map((r) => r.student.id)).toEqual(["ada", "mary"]);
    expect(p.teams.remove).toEqual([{ teamId: "t2", name: "Team 2" }]);
    expect(p.notes).toEqual([]);
  });

  it("keeps a student who has signed in since, and their address", () => {
    const claimed = { ...mary, user_id: "u-mary" };
    const adaClaimed = { ...adaAfter, user_id: "u-ada" };
    const p = planImportUndo(record, [adaClaimed, bobAfter, claimed], teamsAfter);
    expect(p.remove).toEqual([]);
    expect(p.emailsBack).toEqual([]);
    expect(p.notes.join(" ")).toMatch(/Mary Jackson has signed in since/);
    expect(p.notes.join(" ")).toMatch(/Ada Lovelace's address stays/);
  });

  it("keeps an added student who has been put on a team by hand since", () => {
    const moved = [team("t1", "Team 1", [bobAfter, mary]), team("t2", "Team 2", [adaAfter])];
    const p = planImportUndo(record, rosterAfter, moved);
    expect(p.remove).toEqual([]);
  });

  it("leaves an address or a name that has been edited since", () => {
    const edited = [{ ...adaAfter, email: "lovelace@x.edu" }, { ...bobAfter, name: "Robert Smith" }, mary];
    const p = planImportUndo(record, edited, teamsAfter);
    expect(p.emailsBack).toEqual([]);
    expect(p.namesBack).toEqual([]);
    expect(p.notes).toHaveLength(2);
  });
});

describe("undoImport", () => {
  it("seats, names, addresses, then removes the student it added", async () => {
    const out = await undoImport(record, rosterAfter, teamsAfter);
    expect(moveStudents).toHaveBeenCalledWith(["ada"], "t1", ["t1", "t2"]);
    expect(moveStudents).toHaveBeenCalledWith(["mary"], null, ["t1", "t2"]);
    expect(deleteTeam).toHaveBeenCalledWith("t2");
    expect(setStudentName).toHaveBeenCalledWith("bob", "Bob Smyth");
    expect(setStudentEmail).toHaveBeenCalledWith("ada", null);
    expect(removeStudentWithStorage).toHaveBeenCalledWith("mary");
    expect(importUndoText(out)).toBe(
      "Import undone — removed 1 student it added, moved 1 student back, removed 1 team it made, " +
        "put back 1 name, cleared 1 address it filled in.",
    );
  });

  // Whole or not at all, per student: one who stays on the roster keeps their
  // team too — and so their team is not empty, and stays.
  it("keeps an added student who has handed in work since — on the roster AND on their team", async () => {
    countWorkForStudent.mockResolvedValueOnce(2);
    const out = await undoImport(record, rosterAfter, teamsAfter);
    expect(removeStudentWithStorage).not.toHaveBeenCalled();
    expect(moveStudents).not.toHaveBeenCalledWith(["mary"], null, expect.anything());
    expect(deleteTeam).not.toHaveBeenCalled();
    expect(out.notes.join(" ")).toMatch(/Mary Jackson has handed in work/);
    // Ada still goes back.
    expect(moveStudents).toHaveBeenCalledWith(["ada"], "t1", ["t1", "t2"]);
  });

  it("treats work that cannot be counted as work", async () => {
    countWorkForStudent.mockRejectedValueOnce(new Error("offline"));
    const out = await undoImport(record, rosterAfter, teamsAfter);
    expect(removeStudentWithStorage).not.toHaveBeenCalled();
    expect(out.removed).toBe(0);
    expect(out.notes.join(" ")).toMatch(/could not be checked/);
  });
});
