// After the session closes: the answer, theirs, and why — with the team's
// half left out when the instructor released the answers without team mode
// (0053).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { buildLiveModel } from "@/live/model";
import type { LiveSnapshot } from "@/live/types";

vi.mock("@/live/figure", () => ({ Figure: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { Results } = await import("./Results");

const ANA = { id: "s1", name: "Ana Lee", avatar_tint: null } as unknown as Student;
const TEAM = { id: "t1", name: "Team Helix", members: [ANA] } as unknown as TeamWithMembers;

const model = (teamSkipped: boolean | undefined) =>
  buildLiveModel({
    snapshot: {
      state: {
        activity_id: "a", phase: "closed", lock_rule: "any", show_answers: "close", grading: "both",
        team_started_at: null, closed_at: null, scored_at: null, updated_at: "",
        ...(teamSkipped === undefined ? {} : { team_skipped: teamSkipped }),
      },
      questions: [
        { id: "q1", activity_id: "a", position: 0, kind: "mc", stem: "Which?", options: ["one", "two"], unit: null, figure_path: null, created_at: "" },
        { id: "q2", activity_id: "a", position: 1, kind: "mc", stem: "And this?", options: ["three", "four"], unit: null, figure_path: null, created_at: "" },
      ],
      keys: [
        { question_id: "q1", activity_id: "a", correct_option: 1, answer: null, tolerance: null, accept: [] },
        { question_id: "q2", activity_id: "a", correct_option: 0, answer: null, tolerance: null, accept: [] },
      ],
      responses: [
        { question_id: "q1", activity_id: "a", student_id: "s1", answer: "B", correct: null, updated_at: "" },
        { question_id: "q2", activity_id: "a", student_id: "s1", answer: "B", correct: null, updated_at: "" },
      ],
      votes: [],
      locks: [],
      attempts: [],
      teamSetup: true,
      leaderVotes: [],
      setups: [],
      absences: [],
      roster: [],
      explanations: [{ question_id: "q1", activity_id: "a", body: "Two is the one." }],
    } as LiveSnapshot,
    students: [ANA],
    teams: [TEAM],
    now: 0,
  });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = (node: React.ReactNode) => act(async () => root.render(node));

describe("results, released without team mode", () => {
  it("shows their own score, each answer and why — and nothing of the team", async () => {
    await show(<Results m={model(true)} team={TEAM} meId="s1" />);
    expect(host.querySelector(".lq-stat.own")?.textContent).toContain("1/2");
    expect(host.querySelector(".lq-stat.team")).toBeNull();
    expect(host.textContent).not.toContain("Team");
    expect(host.textContent).not.toContain("You had it");
    expect(host.querySelectorAll(".lq-sresanswer")).toHaveLength(2);
    expect(host.querySelector(".lq-swhy")?.textContent).toContain("Two is the one.");
  });

  it("still shows the team when team mode ran", async () => {
    await show(<Results m={model(false)} team={TEAM} meId="s1" />);
    expect(host.querySelector(".lq-stat.team")?.textContent).toContain("Team Helix");
  });

  it("shows the team on a database without 0053", async () => {
    await show(<Results m={model(undefined)} team={TEAM} meId="s1" />);
    expect(host.querySelector(".lq-stat.team")).not.toBeNull();
  });
});
