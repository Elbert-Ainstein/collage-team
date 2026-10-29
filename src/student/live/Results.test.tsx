// After the session closes: a summary, then each question the way it was
// answered — every choice, theirs, the right one, and why. The team's half is
// left out when the instructor released the answers without team mode (0053).

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

/** Q1 she got right (B), Q2 she didn't (B, not A), Q3 she typed 9 for 9.8 ± 0.2. */
const model = (teamSkipped: boolean | undefined, answers: Record<string, string> = { q1: "B", q2: "B", q3: "9" }) =>
  buildLiveModel({
    snapshot: {
      state: {
        activity_id: "a", phase: "closed", lock_rule: "any", show_answers: "close", grading: "both",
        team_started_at: null, closed_at: null, scored_at: null, updated_at: "",
        ...(teamSkipped === undefined ? {} : { team_skipped: teamSkipped }),
      },
      questions: [
        { id: "q1", activity_id: "a", position: 0, kind: "mc", stem: "Which?", options: ["one", "two", "three"], unit: null, figure_path: null, created_at: "" },
        { id: "q2", activity_id: "a", position: 1, kind: "mc", stem: "And this?", options: ["four", "five"], unit: null, figure_path: null, created_at: "" },
        { id: "q3", activity_id: "a", position: 2, kind: "number", stem: "How fast?", options: [], unit: "m/s", figure_path: null, created_at: "" },
      ],
      keys: [
        { question_id: "q1", activity_id: "a", correct_option: 1, answer: null, tolerance: null, accept: [] },
        { question_id: "q2", activity_id: "a", correct_option: 0, answer: null, tolerance: null, accept: [] },
        { question_id: "q3", activity_id: "a", correct_option: null, answer: 9.8, tolerance: 0.2, accept: [] },
      ],
      responses: Object.entries(answers).map(([q, answer]) => ({
        question_id: q, activity_id: "a", student_id: "s1", answer, correct: null, updated_at: "",
      })),
      votes: [],
      locks: [],
      attempts: [],
      teamSetup: true,
      leaderVotes: [],
      setups: [],
      absences: [],
      roster: [],
      explanations: [{ question_id: "q2", activity_id: "a", body: "Four is the one." }],
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
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim().startsWith(label));
const press = (label: string) => act(async () => button(label)!.click());
const choices = () => [...host.querySelectorAll<HTMLElement>(".lq-choice")];
const choice = (text: string) => choices().find((c) => c.textContent?.includes(text))!;

describe("the summary", () => {
  it("shows their score and every question with their answer", async () => {
    await show(<Results m={model(true)} team={TEAM} meId="s1" />);
    expect(host.querySelector(".lq-stat.own")?.textContent).toContain("1/3");
    const rows = host.querySelectorAll(".lq-reviewrow");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector(".lq-pick.right")).not.toBeNull();
    expect(rows[1].querySelector(".lq-pick.wrong")).not.toBeNull();
  });

  it("opens a question from its row", async () => {
    await show(<Results m={model(true)} team={TEAM} meId="s1" />);
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".lq-reviewrow")[1].click());
    expect(host.querySelector(".lq-sq")?.textContent).toBe("Question 2 of 3");
  });
});

describe("going through it, a question at a time", () => {
  it("shows every choice, theirs right in green", async () => {
    await show(<Results m={model(true)} team={TEAM} meId="s1" />);
    await press("Review answers");
    expect(host.querySelector(".lq-sq")?.textContent).toBe("Question 1 of 3");
    expect(choices().map((c) => c.querySelector(".lq-choicet")?.textContent)).toEqual(["one", "two", "three"]);
    expect(choice("two").className).toContain("right");
    expect(choice("two").textContent).toContain("You");
    expect(choice("one").className).not.toMatch(/right|wrong/);
  });

  it("shows theirs in red beside the right one, then why", async () => {
    await show(<Results m={model(true)} team={TEAM} meId="s1" />);
    await press("Review answers");
    await press("Next");
    expect(choice("five").className).toContain("wrong");
    expect(choice("five").textContent).toContain("You");
    expect(choice("four").className).toContain("right");
    expect(choice("four").textContent).not.toContain("You");
    expect(choice("four").querySelector(".lq-choicetag")?.textContent).toBe("Answer");
    const why = host.querySelector(".lq-swhy")!;
    expect(why.textContent).toContain("Four is the one.");
    // Why comes after the choices.
    expect(choice("five").compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows a typed answer beside the right one", async () => {
    await show(<Results m={model(true)} team={TEAM} meId="s1" />);
    await press("Review answers");
    await press("Next");
    await press("Next");
    expect(choice("You").className).toContain("wrong");
    expect(choice("You").textContent).toContain("9 m/s");
    expect(choice("Answer").className).toContain("right");
    expect(choice("Answer").textContent).toContain("9.8 m/s");
  });

  it("shows the answer as written when theirs counted but was written another way", async () => {
    await show(<Results m={model(true, { q1: "B", q2: "A", q3: "9.81" })} team={TEAM} meId="s1" />);
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".lq-reviewrow")[2].click());
    expect(choice("You").className).toContain("right");
    expect(choice("Answer").textContent).toContain("9.8 m/s");
  });

  it("doesn't repeat the answer when theirs is it", async () => {
    await show(<Results m={model(true, { q1: "B", q2: "A", q3: "9.8" })} team={TEAM} meId="s1" />);
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".lq-reviewrow")[2].click());
    expect(choices()).toHaveLength(1);
  });

  it("says so when they didn't answer", async () => {
    await show(<Results m={model(true, { q2: "A", q3: "9.8" })} team={TEAM} meId="s1" />);
    await press("Review answers");
    expect(host.textContent).toContain("You didn’t answer this one");
    expect(choice("two").className).toContain("right");
  });

  it("moves with the numbers along the top, and Done goes back to the summary", async () => {
    await show(<Results m={model(true)} team={TEAM} meId="s1" />);
    await press("Review answers");
    const pips = host.querySelectorAll<HTMLButtonElement>(".lq-spip");
    expect(pips[0].className).toContain("right");
    expect(pips[1].className).toContain("wrong");
    await act(async () => pips[2].click());
    expect(host.querySelector(".lq-sq")?.textContent).toBe("Question 3 of 3");
    await press("Done");
    expect(host.querySelectorAll(".lq-reviewrow")).toHaveLength(3);
  });

  it("goes back from the first question to the summary", async () => {
    await show(<Results m={model(true)} team={TEAM} meId="s1" />);
    await press("Review answers");
    await press("Back");
    expect(host.querySelectorAll(".lq-reviewrow")).toHaveLength(3);
  });
});

describe("the team's half", () => {
  it("is left out when the answers were released without team mode", async () => {
    await show(<Results m={model(true)} team={TEAM} meId="s1" />);
    expect(host.querySelector(".lq-stat.team")).toBeNull();
    await press("Review answers");
    expect(host.textContent).not.toContain("Team");
  });

  it("shows when team mode ran", async () => {
    await show(<Results m={model(false)} team={TEAM} meId="s1" />);
    expect(host.querySelector(".lq-stat.team")?.textContent).toContain("Team Helix");
    await press("Review answers");
    expect(host.querySelector(".lq-steamline")?.textContent).toContain("Team");
  });

  it("shows on a database without 0053", async () => {
    await show(<Results m={model(undefined)} team={TEAM} meId="s1" />);
    expect(host.querySelector(".lq-stat.team")).not.toBeNull();
  });
});
