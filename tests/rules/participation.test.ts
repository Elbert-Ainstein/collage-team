import { describe, expect, it } from "vitest";
import {
  allConfirmed,
  confirmParticipation,
  editCollectiveText,
  submitCollective,
} from "@/services/teamStageService";
import { RuleViolation } from "@/services/errors";
import { BRIDGE_ACTIVITY, SEED_TEAM_3, MAYA, LIAM, PRIYA, SAM } from "@/seed";

const ACT = BRIDGE_ACTIVITY.id;
const TEAM = SEED_TEAM_3.id;

describe("§11 — participation confirmation gates team submit", () => {
  it("refuses team submit until EVERY member confirms (409)", () => {
    editCollectiveText(TEAM, ACT, MAYA.id, "Our shared answer: suspension bridge.");
    confirmParticipation(TEAM, ACT, MAYA.id, true);
    confirmParticipation(TEAM, ACT, LIAM.id, true);
    confirmParticipation(TEAM, ACT, PRIYA.id, true);
    // Sam has not confirmed yet.
    expect(allConfirmed(TEAM, ACT)).toBe(false);
    expect(() => submitCollective(TEAM, ACT, MAYA.id)).toThrowError(RuleViolation);
    try {
      submitCollective(TEAM, ACT, MAYA.id);
    } catch (e) {
      expect((e as RuleViolation).code).toBe("PARTICIPATION_INCOMPLETE");
      expect((e as RuleViolation).status).toBe(409);
    }
  });

  it("allows one member to submit for the team once all confirm, then locks it", () => {
    editCollectiveText(TEAM, ACT, MAYA.id, "Our shared answer.");
    [MAYA, LIAM, PRIYA, SAM].forEach((m) => confirmParticipation(TEAM, ACT, m.id, true));
    expect(allConfirmed(TEAM, ACT)).toBe(true);
    const submitted = submitCollective(TEAM, ACT, MAYA.id);
    expect(submitted.locked).toBe(true);
    expect(submitted.submittedBy).toBe(MAYA.id);
    // A second submit is refused (already locked).
    expect(() => submitCollective(TEAM, ACT, MAYA.id)).toThrowError(/locked/i);
  });

  it("un-confirming a member re-blocks submit", () => {
    [MAYA, LIAM, PRIYA, SAM].forEach((m) => confirmParticipation(TEAM, ACT, m.id, true));
    confirmParticipation(TEAM, ACT, SAM.id, false);
    expect(allConfirmed(TEAM, ACT)).toBe(false);
  });
});
