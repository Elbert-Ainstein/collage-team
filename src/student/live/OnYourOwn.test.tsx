// Before class, the end of it: Submit, then a page that says they're done.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLiveModel } from "@/live/model";
import type { LiveSnapshot } from "@/live/types";
import type { AnswerSaver } from "./useAnswerSaver";

vi.mock("@/live/figure", () => ({ Figure: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { OnYourOwn } = await import("./OnYourOwn");

const m = buildLiveModel({
  snapshot: {
    state: { activity_id: "a", phase: "individual", lock_rule: "any", show_answers: "close", grading: "both", team_started_at: null, closed_at: null, scored_at: null, updated_at: "" },
    questions: [
      { id: "q1", activity_id: "a", position: 0, kind: "mc", stem: "Which?", options: ["one", "two"], unit: null, figure_path: null, created_at: "" },
      { id: "q2", activity_id: "a", position: 1, kind: "number", stem: "How far?", options: [], unit: "m", figure_path: null, created_at: "" },
    ],
    keys: [],
    responses: [],
    votes: [],
    locks: [],
    attempts: [],
    teamSetup: false,
    leaderVotes: [],
    setups: [],
    absences: [],
    roster: [],
    explanations: [],
  } as LiveSnapshot,
  students: [],
  teams: [],
  now: 0,
});
const saver = (answers: Record<string, string>): AnswerSaver => ({ answers, state: {}, save: vi.fn() });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = (node: React.ReactNode) => act(async () => root.render(node));
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));

describe("the end of before class", () => {
  it("submits, then says so on a page of its own", async () => {
    await show(<OnYourOwn m={m} saver={saver({ q1: "A", q2: "5" })} cursor={2} onCursor={() => {}} activityId="a" />);
    expect(host.querySelector(".lq-h2")?.textContent).toBe("Ready to submit");
    await act(async () => button("Submit")!.click());
    expect(host.querySelector(".lq-h2")?.textContent).toBe("You’ve submitted");
    expect(host.textContent).toContain("2 of 2 answered");
    await act(async () => button("Review answers")!.click());
    expect(host.querySelectorAll(".lq-reviewrow")).toHaveLength(2);
  });

  it("is still the submitted page when they come back", async () => {
    window.localStorage.setItem("lq-submitted-a", "1");
    await show(<OnYourOwn m={m} saver={saver({ q1: "A", q2: "5" })} cursor={2} onCursor={() => {}} activityId="a" />);
    expect(host.querySelector(".lq-h2")?.textContent).toBe("You’ve submitted");
  });

  it("can't submit with a question left", async () => {
    await show(<OnYourOwn m={m} saver={saver({ q1: "A" })} cursor={2} onCursor={() => {}} activityId="a" />);
    expect(button("Submit")!.disabled).toBe(true);
    expect(host.textContent).toContain("Answer Q2 to submit");
  });
});

// A tab opened before a new kind of question shipped. Before 0056 the page
// gave anything that wasn't multiple choice a text box, so a select-multiple
// question got one, and every answer typed into it was refused: "That answer
// can't be used". A kind this build doesn't know asks for a reload instead.
describe("a kind of question this page doesn't know", () => {
  const later = buildLiveModel({
    snapshot: {
      state: { activity_id: "a", phase: "individual", lock_rule: "any", show_answers: "close", grading: "both", team_started_at: null, closed_at: null, scored_at: null, updated_at: "" },
      questions: [
        // Cast: a kind from a build newer than this one.
        { id: "q9", activity_id: "a", position: 0, kind: "ranking" as LiveSnapshot["questions"][number]["kind"], stem: "Order them", options: ["x", "y"], unit: null, figure_path: null, created_at: "" },
      ],
      keys: [],
      responses: [],
      votes: [],
      locks: [],
      attempts: [],
      teamSetup: false,
      leaderVotes: [],
      setups: [],
      absences: [],
      roster: [],
      explanations: [],
    } as LiveSnapshot,
    students: [],
    teams: [],
    now: 0,
  });

  it("asks for a reload rather than giving a text box that can't be saved", async () => {
    const s = saver({});
    await show(<OnYourOwn m={later} saver={s} cursor={0} onCursor={() => {}} activityId="a" />);
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toContain("This question needs the latest version of Collage");
    expect(button("Reload")).toBeDefined();
    expect(s.save).not.toHaveBeenCalled();
  });
});
