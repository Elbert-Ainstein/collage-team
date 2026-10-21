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
};

describe("teamCsv", () => {
  it("defuses formulas but leaves numbers as numbers", () => {
    const csv = teamCsv(buildLiveModel({ snapshot: snap, students: team.members, teams: [team], now: 0 }));
    const row = csv.split("\n")[1];
    expect(row.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(row).toContain('"Zoë, A; Bo"');
    expect(row.endsWith(",-9.8")).toBe(true);
  });
});
