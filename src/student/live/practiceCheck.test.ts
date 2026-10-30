// Practice after the session closes: an answer is checked against the key on
// this device. An expression counts in any equivalent form, as it does when
// the session is scored.

import { describe, expect, it } from "vitest";
import { buildLiveModel } from "@/live/model";
import type { LiveSnapshot } from "@/live/types";
import { practiceRight } from "./practiceCheck";

const model = (keys = true) =>
  buildLiveModel({
    snapshot: {
      state: {
        activity_id: "a", phase: "closed", lock_rule: "any", show_answers: "close", grading: "both",
        team_started_at: null, closed_at: null, scored_at: null, updated_at: "",
      },
      questions: [
        { id: "q1", activity_id: "a", position: 0, kind: "mc", stem: "Which?", options: ["one", "two"], unit: null, figure_path: null, created_at: "" },
        { id: "q2", activity_id: "a", position: 1, kind: "number", stem: "How fast?", options: [], unit: "m/s", figure_path: null, created_at: "" },
        { id: "q3", activity_id: "a", position: 2, kind: "expression", stem: "The force?", options: [], unit: null, figure_path: null, created_at: "" },
      ],
      keys: keys
        ? [
            { question_id: "q1", activity_id: "a", correct_option: 1, answer: null, tolerance: null, accept: [] },
            { question_id: "q2", activity_id: "a", correct_option: null, answer: 9.8, tolerance: 0.2, accept: [] },
            { question_id: "q3", activity_id: "a", correct_option: null, answer: null, tolerance: null, accept: ["F/2"] },
          ]
        : [],
      responses: [], votes: [], locks: [], attempts: [], teamSetup: true, leaderVotes: [], setups: [], absences: [], roster: [], explanations: [],
    } as LiveSnapshot,
    students: [],
    teams: [],
    now: 0,
  });

describe("practiceRight", () => {
  it("marks a choice against the key", async () => {
    expect(await practiceRight(model(), 0, "B")).toBe(true);
    expect(await practiceRight(model(), 0, "A")).toBe(false);
  });

  it("allows a number its tolerance", async () => {
    expect(await practiceRight(model(), 1, "9.7")).toBe(true);
    expect(await practiceRight(model(), 1, "9")).toBe(false);
  });

  it("takes an expression in any equivalent form", async () => {
    expect(await practiceRight(model(), 2, "F/2")).toBe(true);
    expect(await practiceRight(model(), 2, "0.5*F")).toBe(true);
    expect(await practiceRight(model(), 2, "2*F")).toBe(false);
  });

  it("says nothing when there's no key to check against", async () => {
    expect(await practiceRight(model(false), 0, "B")).toBeNull();
  });
});
