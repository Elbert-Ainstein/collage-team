import { describe, expect, it } from "vitest";
import {
  approveAndRelease,
  getReleasedGradeForStudent,
  getSuggestion,
  gradebookCell,
  suggestGrade,
} from "@/services/gradingService";
import { submitCollective, confirmParticipation, editCollectiveText } from "@/services/teamStageService";
import { submitPrep } from "@/services/responseService";
import { BRIDGE_ACTIVITY, SEED_TEAM_3, MAYA, LIAM, PRIYA, SAM } from "@/seed";

const ACT = BRIDGE_ACTIVITY.id;
const TEAM = SEED_TEAM_3.id;

function submitTeam() {
  editCollectiveText(TEAM, ACT, MAYA.id, "Team 3 recommends a suspension bridge; T_max ≈ 1180 kN.");
  [MAYA, LIAM, PRIYA, SAM].forEach((m) => confirmParticipation(TEAM, ACT, m.id, true));
  submitCollective(TEAM, ACT, MAYA.id);
}

describe("§11 — AI grading proposes, instructor approves", () => {
  it("persists an AI suggestion (17/20) with evidence + confidence, but never auto-releases it", async () => {
    submitTeam();
    const suggestion = await suggestGrade(ACT, TEAM, "COLLECTIVE");
    expect(suggestion.total).toBe(17);
    for (const id of ["r-choice", "r-reasoning", "r-calc", "r-units", "r-tradeoff"]) {
      expect(suggestion.byCriterion[id].evidence).toBeTruthy();
      expect(["High", "Medium"]).toContain(suggestion.byCriterion[id].confidence);
    }
    expect(getSuggestion(ACT, TEAM)).toBeTruthy();
    // Nothing released → students see nothing.
    expect(getReleasedGradeForStudent(ACT, MAYA.id)).toBeUndefined();
  });

  it("releases the approved grade to every team member only after the instructor acts", async () => {
    submitTeam();
    await suggestGrade(ACT, TEAM, "COLLECTIVE");
    approveAndRelease(ACT, TEAM, "COLLECTIVE", { "r-choice": 4, "r-reasoning": 5, "r-calc": 5, "r-units": 2, "r-tradeoff": 1 }, {});
    // Shared team grade visible to all four members.
    for (const m of [MAYA, LIAM, PRIYA, SAM]) {
      expect(getReleasedGradeForStudent(ACT, m.id)?.total).toBe(17);
    }
  });

  it("keeps completeness credit independent of the correctness grade", async () => {
    submitPrep(MAYA.id, ACT, { 1: "Beam", 2: "wrong reasoning", 3: "0", 5: "n/a" }, {
      filename: "c.jpg", imageUrl: "", ocrText: "x", ocrConfirmed: true, flaggedSymbols: [],
    });
    submitTeam();
    await suggestGrade(ACT, TEAM, "COLLECTIVE");
    approveAndRelease(ACT, TEAM, "COLLECTIVE", { "r-choice": 0, "r-reasoning": 0, "r-calc": 0, "r-units": 0, "r-tradeoff": 0 }, {});
    const cell = gradebookCell(ACT, MAYA.id);
    // Full prep completeness credit despite a 0/20 correctness grade.
    expect(cell.prepEarned).toBe(cell.prepMax);
    expect(cell.submissionScore).toBe(0);
  });
});
