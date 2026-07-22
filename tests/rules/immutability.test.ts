import { describe, expect, it } from "vitest";
import {
  editOriginal,
  getOriginal,
  saveDraftPrep,
  submitPrep,
  hasSubmittedPrep,
} from "@/services/responseService";
import { RuleViolation } from "@/services/errors";
import { BRIDGE_ACTIVITY, MAYA } from "@/seed";

const ACT = BRIDGE_ACTIVITY.id;

const completeAnswers = {
  1: "Suspension",
  2: "Suspension routes the deck load through the main cables to the towers.",
  3: "1180",
  5: "Cost vs. constructability over a deep gorge.",
};

const upload = {
  filename: "calc_bridge_load.jpg",
  imageUrl: "",
  ocrText: "T_max ~ 1180 kN",
  ocrConfirmed: true,
  flaggedSymbols: [],
};

describe("§11 — immutable originals", () => {
  it("locks the original at submit and records submittedAt", () => {
    const r = submitPrep(MAYA.id, ACT, completeAnswers, upload);
    expect(r.locked).toBe(true);
    expect(r.submittedAt).toBeTruthy();
    expect(hasSubmittedPrep(MAYA.id, ACT)).toBe(true);
  });

  it("rejects editing a locked original with a 409", () => {
    submitPrep(MAYA.id, ACT, completeAnswers, upload);
    expect(() => editOriginal(MAYA.id, ACT, { ...completeAnswers, 1: "Arch" })).toThrowError(RuleViolation);
    try {
      editOriginal(MAYA.id, ACT, { ...completeAnswers, 1: "Arch" });
    } catch (e) {
      expect((e as RuleViolation).code).toBe("IMMUTABLE_ORIGINAL");
      expect((e as RuleViolation).status).toBe(409);
    }
    // Original value is untouched.
    expect(getOriginal(MAYA.id, ACT)?.answers[1]).toBe("Suspension");
  });

  it("rejects re-submitting an already-submitted prep with a 409", () => {
    submitPrep(MAYA.id, ACT, completeAnswers, upload);
    expect(() => submitPrep(MAYA.id, ACT, completeAnswers, upload)).toThrowError(/already been submitted/i);
  });

  it("allows editing a DRAFT (pre-submit) freely", () => {
    saveDraftPrep(MAYA.id, ACT, { 1: "Arch" });
    const updated = editOriginal(MAYA.id, ACT, { 1: "Suspension" });
    expect(updated.answers[1]).toBe("Suspension");
    expect(updated.locked).toBe(false);
  });
});

describe("§11 — prep validation (completeness, not correctness)", () => {
  it("blocks submit when a required question is unattempted", () => {
    expect(() => submitPrep(MAYA.id, ACT, { 1: "Suspension" }, upload)).toThrowError(/incomplete/i);
  });

  it("blocks submit when required upload/OCR is missing", () => {
    expect(() => submitPrep(MAYA.id, ACT, completeAnswers, undefined)).toThrowError(/incomplete/i);
  });

  it("accepts an incorrect-but-complete answer (correctness is never checked)", () => {
    const wrongButComplete = { ...completeAnswers, 1: "Beam", 3: "99999" };
    const r = submitPrep(MAYA.id, ACT, wrongButComplete, upload);
    expect(r.status).toBe("complete");
  });
});
