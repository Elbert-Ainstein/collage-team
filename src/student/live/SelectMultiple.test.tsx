// Select all that apply (0056) on the student's three screens: ticking boxes
// before class, the team proposing a combination in class, and the review
// after, option by option.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { buildLiveModel } from "@/live/model";
import type { LiveAttempt, LiveSnapshot } from "@/live/types";
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
    expect(host.textContent).toContain("Pick at least one");
  });
});

describe("in class", () => {
  it("puts each member's set on the table, by its letters and its options", async () => {
    await show(<TeamQuestion m={model()} team={team} q={0} onError={() => {}} onTried={() => {}} />);
    const choices = [...host.querySelectorAll<HTMLButtonElement>(".lq-choices[role=radiogroup] .lq-choice")];
    expect(choices.map((c) => c.querySelector(".lq-choicel")?.textContent)).toEqual(["AC", "AB"]);
    expect(choices.map((c) => c.querySelector(".lq-choicet")?.textContent)).toEqual(["Gravity · Friction", "Gravity · Normal"]);
    await act(async () => choices[1].click());
    expect(castVote).toHaveBeenCalledWith("q1", "AB");
    expect(host.querySelector("footer")?.textContent).toContain("Submit A, B");
  });

  it("proposes a combination nobody has put forward, and not one the team has tried", async () => {
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
    await show(<TeamQuestion m={model({ attempts: [tried] })} team={team} q={0} onError={() => {}} onTried={() => {}} />);
    const form = host.querySelector(".lq-propose.multi")!;
    const propose = () => form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    expect(propose().disabled).toBe(true);
    await tick("Gravity", form);
    await tick("Friction", form);
    expect(propose().textContent).toBe("Tried");
    expect(propose().disabled).toBe(true);
    await tick("Tension", form);
    expect(propose().textContent).toBe("Propose A, C, D");
    await act(async () => propose().click());
    expect(castVote).toHaveBeenCalledWith("q1", "ACD");
    // Proposed: the boxes clear for the next one.
    expect(boxes(form).every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
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
