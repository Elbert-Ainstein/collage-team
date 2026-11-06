// Select all that apply (0056) on the student's three screens: ticking boxes
// before class, the team ticking the same boxes in class — each tick the
// vote (0057) — and the review after, option by option.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { buildLiveModel } from "@/live/model";
import type { LiveAttempt, LiveLock, LiveSnapshot } from "@/live/types";
import type { AnswerSaver } from "./useAnswerSaver";

const castVote = vi.fn(async () => {});
vi.mock("@/live/data", () => ({
  castVote: (...a: unknown[]) => castVote(...(a as [])),
  lockTeamAnswer: vi.fn(async () => ({})),
  moveTeamOn: vi.fn(async () => ({})),
}));
vi.mock("@/live/figure", () => ({ Figure: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { OnYourOwn } = await import("./OnYourOwn");
const { TeamQuestion } = await import("./TeamVote");
const { ReviewQuestion } = await import("./ReviewQuestion");

const T0 = Date.parse("2026-10-27T10:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const student = (id: string, name: string) => ({ id, name, avatar_tint: null }) as unknown as Student;
const team = { id: "t1", name: "Team 1", members: [student("s1", "Ana Lee"), student("s2", "Bo Ng")] } as unknown as TeamWithMembers;

const question = {
  id: "q1",
  activity_id: "a",
  position: 0,
  kind: "multi" as const,
  stem: "Which forces act on the book?",
  options: ["Gravity", "Normal", "Friction", "Tension"],
  unit: null,
  figure_path: null,
  created_at: "",
};

function model(over: Partial<LiveSnapshot> = {}, phase: "individual" | "team" | "closed" = "team") {
  const snap: LiveSnapshot = {
    state: {
      activity_id: "a",
      phase,
      lock_rule: "any",
      show_answers: "close",
      grading: "both",
      team_started_at: phase === "individual" ? null : iso(0),
      closed_at: null,
      scored_at: null,
      updated_at: iso(0),
    },
    questions: [question],
    keys: [{ question_id: "q1", activity_id: "a", correct_option: null, correct_options: [0, 1], answer: null, tolerance: null, accept: [] }],
    responses: [
      { question_id: "q1", activity_id: "a", student_id: "s1", answer: "AC", correct: null, updated_at: "" },
      { question_id: "q1", activity_id: "a", student_id: "s2", answer: "AB", correct: null, updated_at: "" },
    ],
    votes: [],
    locks: [],
    attempts: [],
    teamSetup: false,
    leaderVotes: [],
    setups: [],
    absences: [],
    roster: [],
    explanations: [],
    ...over,
  };
  return buildLiveModel({ snapshot: snap, students: team.members, teams: [team], now: T0 + 60_000 });
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  castVote.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = (node: React.ReactNode) => act(async () => root.render(node));
const boxes = (within: ParentNode = host) => [...within.querySelectorAll<HTMLButtonElement>("[role=checkbox]")];
const box = (text: string, within: ParentNode = host) => boxes(within).find((b) => b.textContent?.includes(text))!;
const tick = (text: string, within: ParentNode = host) => act(async () => box(text, within).click());

describe("before class", () => {
  it("ticks boxes and saves the set as one answer, letters in order", async () => {
    const save = vi.fn();
    const saver: AnswerSaver = { answers: {}, state: {}, save };
    await show(<OnYourOwn m={model({}, "individual")} saver={saver} cursor={0} onCursor={() => {}} activityId="a" />);
    expect(boxes()).toHaveLength(4);
    // The rule is said above the boxes, and the count follows the ticks.
    expect(host.querySelector(".lq-multitag")?.textContent).toContain("Select all that apply");
    expect(host.querySelector(".lq-multicount")?.textContent).toBe("Pick one or more");
    await tick("Friction");
    expect(save).toHaveBeenLastCalledWith("q1", "C", true);
    await tick("Gravity");
    expect(save).toHaveBeenLastCalledWith("q1", "AC", true);
    expect(box("Gravity").getAttribute("aria-checked")).toBe("true");
    expect(box("Normal").getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector(".lq-multicount")?.textContent).toBe("2 selected");
    expect(box("Gravity").querySelector(".lq-checkbox")?.className).toContain("on");
    expect(box("Normal").querySelector(".lq-checkbox")?.className).not.toContain("on");
  });

  it("shows the saved set ticked, and unticking the last box saves nothing", async () => {
    const save = vi.fn();
    const saver: AnswerSaver = { answers: { q1: "B" }, state: {}, save };
    await show(<OnYourOwn m={model({}, "individual")} saver={saver} cursor={0} onCursor={() => {}} activityId="a" />);
    expect(box("Normal").getAttribute("aria-checked")).toBe("true");
    await tick("Normal");
    expect(save).not.toHaveBeenCalled();
    expect(box("Normal").getAttribute("aria-checked")).toBe("false");
    // The tag above the boxes is the whole instruction: no line under them (0057).
    expect(host.querySelector(".lq-numhint")).toBeNull();
  });
});

describe("in class", () => {
  const tried: LiveAttempt = {
    question_id: "q1",
    activity_id: "a",
    team_id: "t1",
    attempt: 1,
    answer: "AC",
    correct: false,
    locked_by: "s1",
    locked_at: iso(10),
  };
  const voterIds = (b: HTMLElement) => [...b.querySelectorAll<HTMLElement>(".lq-voterpop .lq-av")].length;
  const foot = () => host.querySelector("footer")!;

  it("has the same boxes as before class, and each tick is the team vote", async () => {
    const bo = { question_id: "q1", activity_id: "a", team_id: "t1", student_id: "s2", answer: "AB", updated_at: "" };
    await show(<TeamQuestion m={model({ votes: [bo] })} team={team} q={0} onError={() => {}} onTried={() => {}} />);
    // No combinations to propose, no table of sets: the options, as checkboxes.
    expect(host.querySelector(".lq-propose")).toBeNull();
    expect(host.querySelector(".lq-choices[role=radiogroup]")).toBeNull();
    expect(boxes()).toHaveLength(4);
    expect(host.querySelector(".lq-multitag")?.textContent).toContain("Select all that apply");
    // Bo's set shows on the options it has.
    expect(voterIds(box("Gravity"))).toBe(1);
    expect(voterIds(box("Normal"))).toBe(1);
    expect(voterIds(box("Friction"))).toBe(0);
    expect(foot().textContent).toContain("Bo on A, B · 1 undecided");
    expect(foot().textContent).toContain("Tick all that apply");

    await tick("Friction");
    expect(castVote).toHaveBeenLastCalledWith("q1", "C");
    await tick("Gravity");
    expect(castVote).toHaveBeenLastCalledWith("q1", "AC");
    expect(box("Gravity").getAttribute("aria-checked")).toBe("true");
    expect(box("Normal").getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector(".lq-multicount")?.textContent).toBe("2 selected");
    // Mine is on Gravity now too, and the bar names my set.
    expect(voterIds(box("Gravity"))).toBe(2);
    expect(foot().textContent).toContain("Submit A, C");
  });

  it("lists what the team has tried, and won't vote a tried set again", async () => {
    await show(<TeamQuestion m={model({ attempts: [tried] })} team={team} q={0} onError={() => {}} onTried={() => {}} />);
    const triedRows = [...host.querySelectorAll<HTMLElement>(".lq-tried .lq-choice")];
    expect(triedRows.map((r) => r.querySelector(".lq-choicel")?.textContent)).toEqual(["AC"]);
    expect(triedRows[0].className).toContain("wrong");
    expect(triedRows[0].textContent).toContain("Gravity · Friction");

    await tick("Gravity");
    expect(castVote).toHaveBeenLastCalledWith("q1", "A");
    await tick("Friction");
    // A, C has been tried: the boxes show it, the line says so, and A still stands as my vote.
    expect(castVote).toHaveBeenCalledTimes(1);
    expect(box("Friction").getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector('[role="status"].lq-numhint')?.textContent).toContain("Your team already tried A, C");
    expect(foot().textContent).toContain("Submit A");
    await tick("Tension");
    expect(castVote).toHaveBeenLastCalledWith("q1", "ACD");
    expect(host.querySelector('[role="status"].lq-numhint')?.textContent).toBe("");
    expect(foot().textContent).toContain("Submit A, C, D");
  });

  it("shows the team's answer in the boxes once it's done", async () => {
    const got: LiveAttempt = { ...tried, attempt: 2, answer: "AB", correct: true, locked_at: iso(20) };
    const lock: LiveLock = { question_id: "q1", activity_id: "a", team_id: "t1", answer: "AB", correct: true, locked_by: "s1", locked_at: iso(20) };
    await show(<TeamQuestion m={model({ attempts: [tried, got], locks: [lock] })} team={team} q={0} onError={() => {}} onTried={() => {}} onNext={() => {}} />);
    expect(boxes()).toHaveLength(0);
    const row = (text: string) => [...host.querySelectorAll<HTMLElement>(".lq-choices.multi .lq-choice")].find((c) => c.textContent?.includes(text))!;
    expect(row("Gravity").className).toContain("right");
    expect(row("Gravity").querySelector(".lq-checkbox")?.className).toContain("on");
    expect(row("Gravity").textContent).toContain("Team");
    expect(row("Tension").className).not.toMatch(/right|wrong/);
    expect(row("Tension").querySelector(".lq-checkbox")?.className).not.toContain("on");
    const triedRows = [...host.querySelectorAll<HTMLElement>(".lq-tried .lq-choice")];
    expect(triedRows.map((r) => r.className.includes("right"))).toEqual([false, true]);
    expect(foot().textContent).toContain("Correct!");
    expect(foot().textContent).toContain("You submitted A, B · +0.5 points");
  });
});

describe("after class", () => {
  it("reads the review option by option: right ones green, a wrong tick red, a missed one named", async () => {
    await show(<ReviewQuestion m={model({}, "closed")} team={null} meId="s1" q={0} onGo={() => {}} onDone={() => {}} />);
    const choice = (text: string) => [...host.querySelectorAll<HTMLElement>(".lq-choice")].find((c) => c.textContent?.includes(text))!;
    // Ana ticked A and C; the key is A and B.
    expect(choice("Gravity").className).toContain("right");
    expect(choice("Gravity").textContent).toContain("You");
    expect(choice("Normal").className).toContain("right");
    expect(choice("Normal").querySelector(".lq-choicetag")?.textContent).toBe("Answer");
    expect(choice("Friction").className).toContain("wrong");
    expect(choice("Friction").textContent).toContain("You");
    expect(choice("Tension").className).not.toMatch(/right|wrong/);
    // All or nothing: the question itself is not right.
    expect(host.querySelector(".lq-spip")?.className).toContain("wrong");
  });
});
