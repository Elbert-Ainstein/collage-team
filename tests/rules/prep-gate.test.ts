import { describe, expect, it } from "vitest";
import {
  canAccessTeamStage,
  getTeammateOriginals,
  submitPrep,
} from "@/services/responseService";
import { RuleViolation } from "@/services/errors";
import { BRIDGE_ACTIVITY, MAYA } from "@/seed";

const ACT = BRIDGE_ACTIVITY.id;
const answers = {
  1: "Suspension",
  2: "Cables carry the deck load to the towers.",
  3: "1180",
  5: "Cost vs. constructability.",
};
const upload = { filename: "c.jpg", imageUrl: "", ocrText: "x", ocrConfirmed: true, flaggedSymbols: [] };

describe("§4/§11 — prep gate", () => {
  it("denies team-stage access before prep is submitted", () => {
    expect(canAccessTeamStage(MAYA.id, ACT)).toBe(false);
    expect(() => getTeammateOriginals(MAYA.id, ACT)).toThrowError(RuleViolation);
    try {
      getTeammateOriginals(MAYA.id, ACT);
    } catch (e) {
      expect((e as RuleViolation).code).toBe("PREP_GATE");
      expect((e as RuleViolation).status).toBe(403);
    }
  });

  it("grants access once prep is submitted, exposing teammates' locked originals only", () => {
    submitPrep(MAYA.id, ACT, answers, upload);
    expect(canAccessTeamStage(MAYA.id, ACT)).toBe(true);
    const originals = getTeammateOriginals(MAYA.id, ACT);
    // Team 3 = Maya + Liam + Priya + Sam; all four have submitted originals now.
    expect(originals.length).toBe(4);
    expect(originals.every((r) => r.locked && r.submittedAt)).toBe(true);
  });
});
