import { describe, expect, it } from "vitest";
import { getFinal, submitFinal } from "@/services/teamStageService";
import { RuleViolation } from "@/services/errors";
import { activityById, useStore } from "@/store";
import { BRIDGE_ACTIVITY, MAYA, LIAM } from "@/seed";

const ACT = BRIDGE_ACTIVITY.id;

describe("§11 — private individual finals", () => {
  it("lets a student read their OWN final", () => {
    submitFinal(MAYA.id, ACT, "My private revised answer.");
    expect(getFinal(MAYA.id, MAYA.id, ACT).text).toContain("private revised");
  });

  it("NEVER lets a student read a teammate's final (403)", () => {
    submitFinal(LIAM.id, ACT, "Liam's private answer.");
    expect(() => getFinal(MAYA.id, LIAM.id, ACT)).toThrowError(RuleViolation);
    try {
      getFinal(MAYA.id, LIAM.id, ACT);
    } catch (e) {
      expect((e as RuleViolation).code).toBe("PRIVATE_FINAL");
      expect((e as RuleViolation).status).toBe(403);
    }
  });

  it("still hides a teammate's final when finals are released but grade is NOT released", () => {
    // Flip the release flag on but do not release any grade.
    useStore.getState()._updateActivity(ACT, {
      individualSettings: { ...activityById(useStore.getState(), ACT)!.individualSettings, releaseFinalsAfterGrading: true },
    });
    submitFinal(LIAM.id, ACT, "Liam's private answer.");
    expect(() => getFinal(MAYA.id, LIAM.id, ACT)).toThrowError(/private/i);
  });

  it("enforces the one-submission lock on finals (409)", () => {
    submitFinal(MAYA.id, ACT, "first");
    expect(() => submitFinal(MAYA.id, ACT, "second")).toThrowError(/only.*one/i);
  });
});
