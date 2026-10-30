// Trying the questions again once the session has closed: each one is shown
// without its answer, checked on this device when they ask, and then shows the
// answer and why. Nothing is saved, so nothing reaches the gradebook.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLiveModel } from "@/live/model";
import type { LiveSnapshot } from "@/live/types";

vi.mock("@/live/figure", () => ({ Figure: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { Practice } = await import("./Practice");

const model = () =>
  buildLiveModel({
    snapshot: {
      state: {
        activity_id: "a", phase: "closed", lock_rule: "any", show_answers: "close", grading: "both",
        team_started_at: null, closed_at: null, scored_at: null, updated_at: "",
      },
      questions: [
        { id: "q1", activity_id: "a", position: 0, kind: "mc", stem: "Which?", options: ["one", "two", "three"], unit: null, figure_path: null, created_at: "" },
        { id: "q2", activity_id: "a", position: 1, kind: "number", stem: "How fast?", options: [], unit: "m/s", figure_path: null, created_at: "" },
      ],
      keys: [
        { question_id: "q1", activity_id: "a", correct_option: 1, answer: null, tolerance: null, accept: [] },
        { question_id: "q2", activity_id: "a", correct_option: null, answer: 9.8, tolerance: 0.2, accept: [] },
      ],
      responses: [], votes: [], locks: [], attempts: [], teamSetup: true, leaderVotes: [], setups: [], absences: [], roster: [],
      explanations: [{ question_id: "q1", activity_id: "a", body: "Two is the one." }],
    } as LiveSnapshot,
    students: [],
    teams: [],
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
const choice = (text: string) =>
  [...host.querySelectorAll<HTMLElement>(".lq-choice")].find((c) => c.textContent?.includes(text))!;
const type = (value: string) =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("Practice", () => {
  it("keeps the answer and the explanation back until they check", async () => {
    await show(<Practice m={model()} onDone={() => {}} />);
    expect(host.textContent).toContain("Which?");
    expect(host.textContent).not.toContain("Answer");
    expect(host.textContent).not.toContain("Two is the one.");
    expect(button("Check")!.disabled).toBe(true);
  });

  it("says when they have it right, and why", async () => {
    await show(<Practice m={model()} onDone={() => {}} />);
    await act(async () => choice("two").click());
    await press("Check");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Right");
    expect(choice("two").classList).toContain("right");
    expect(host.textContent).toContain("Two is the one.");
  });

  it("shows the right answer beside a wrong one", async () => {
    await show(<Practice m={model()} onDone={() => {}} />);
    await act(async () => choice("three").click());
    await press("Check");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Not right");
    expect(choice("three").classList).toContain("wrong");
    expect(choice("two").textContent).toContain("Answer");
  });

  it("checks a typed answer, and Done on the last goes back", async () => {
    const onDone = vi.fn();
    await show(<Practice m={model()} onDone={onDone} />);
    await act(async () => choice("two").click());
    await press("Check");
    await press("Next");
    expect(host.textContent).toContain("How fast?");
    await type("9.7");
    await press("Check");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Right");
    await press("Done");
    expect(onDone).toHaveBeenCalled();
  });

  it("can try a question again after checking it", async () => {
    await show(<Practice m={model()} onDone={() => {}} />);
    await act(async () => choice("three").click());
    await press("Check");
    await press("Try again");
    expect(button("Check")!.disabled).toBe(true);
    expect(host.textContent).not.toContain("Answer");
  });
});
