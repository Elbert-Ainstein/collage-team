import { describe, expect, it } from "vitest";
import { buildLiveModel } from "@/live/model";
import type { LiveSnapshot } from "@/live/types";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { teamCsv } from "./exportCsv";

const s = (id: string, name: string) => ({ id, name }) as unknown as Student;
const team = { id: "t", name: "=HYPERLINK(\"x\")", members: [s("a", "Zoë, A"), s("b", "Bo")] } as unknown as TeamWithMembers;
const snap: LiveSnapshot = {
  state: { activity_id: "x", phase: "closed", lock_rule: "any", show_answers: "close", grading: "both", team_started_at: null, closed_at: null, scored_at: null, updated_at: "" },
  questions: [{ id: "q", activity_id: "x", position: 0, kind: "number", stem: "", options: [], unit: null, figure_path: null, created_at: "" }],
  keys: [{ question_id: "q", activity_id: "x", correct_option: null, answer: -9.8, tolerance: 0, accept: [] }],
  responses: [],
  votes: [],
  locks: [{ question_id: "q", activity_id: "x", team_id: "t", answer: "-9.8", correct: null, locked_by: "a", locked_at: "" }],
  attempts: [],
  teamSetup: false,
  leaderVotes: [],
  setups: [],
  absences: [],
  roster: [],
  explanations: [],
};

describe("teamCsv", () => {
  it("defuses formulas but leaves numbers as numbers", () => {
    const csv = teamCsv(buildLiveModel({ snapshot: snap, students: team.members, teams: [team], now: 0 }));
    const row = csv.split("\n")[1];
    expect(row.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(row).toContain('"Zoë, A; Bo"');
    expect(row.endsWith(",-9.8")).toBe(true);
  });

  it("scores by the try each question was got on, and lists the tries", () => {
    const at = (attempt: number, answer: string, correct: boolean) =>
      ({ question_id: "q", activity_id: "x", team_id: "t", attempt, answer, correct, locked_by: "a", locked_at: "" });
    const m = buildLiveModel({
      snapshot: { ...snap, attempts: [at(1, "-9.7", false), at(2, "-9.8", true)] },
      students: team.members,
      teams: [team],
      now: 0,
    });
    const row = teamCsv(m).split("\n")[1].split(",");
    // A trail isn't a plain number, so a leading minus is defused like any other.
    expect(row.slice(-4)).toEqual(["0.5", "1", "", "'-9.7 → -9.8"]);
  });

  it("names who was absent, beside the members", () => {
    const m = buildLiveModel({
      snapshot: { ...snap, absences: [{ activity_id: "x", team_id: "t", student_id: "b", source: "roll" }] },
      students: team.members,
      teams: [team],
      now: 0,
    });
    const [head, row] = teamCsv(m).split("\n");
    expect(head.split(",").slice(0, 4)).toEqual(["Team", "Members", "Absent", "Score"]);
    expect(row).toContain('"Zoë, A; Bo",Bo,');
  });
});
