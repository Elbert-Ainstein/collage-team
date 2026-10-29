// The explanation box under a question in the builder: typing, generating
// (which replaces what's there), and a failure said in a line.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankQuestion, type DraftQuestion } from "./draft";

const explainQuestion = vi.fn<(...a: unknown[]) => Promise<string>>();
vi.mock("./explainClient", async (orig) => ({
  ...(await orig<typeof import("./explainClient")>()),
  explainQuestion: (...a: unknown[]) => explainQuestion(...a),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ExplanationField } = await import("./ExplanationField");

const q = (over: Partial<DraftQuestion> = {}): DraftQuestion => ({
  ...blankQuestion(),
  stem: "Which way?",
  options: ["Up", "Down"],
  correct: 1,
  explanation: "Old text",
  ...over,
});

let host: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const onPatch = vi.fn();

function render(question: DraftQuestion) {
  act(() => root.render(<ExplanationField q={question} n={2} activityId="a1" onChange={onChange} onPatch={onPatch} />));
}
const button = () => host.querySelector<HTMLButtonElement>(".lq-explainfoot button")!;
const box = () => host.querySelector<HTMLTextAreaElement>("textarea")!;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("ExplanationField", () => {
  it("shows the saved explanation under its label", () => {
    render(q());
    expect(host.textContent).toContain("Explanation");
    expect(box().value).toBe("Old text");
    expect(box().getAttribute("aria-label")).toBe("Question 2 explanation");
  });

  it("can't generate until the question and its answer are there", () => {
    render(q({ stem: "" }));
    expect(button().disabled).toBe(true);
    render(q({ correct: null }));
    expect(button().disabled).toBe(true);
    render(q());
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe("Generate explanation");
  });

  it("fills the box with what comes back, busy while it's writing", async () => {
    let finish: (s: string) => void = () => {};
    explainQuestion.mockReturnValue(new Promise((r) => (finish = r)));
    render(q());
    act(() => button().click());
    expect(button().textContent).toBe("Writing…");
    expect(button().disabled).toBe(true);
    expect(explainQuestion.mock.calls[0][0]).toBe("a1");
    await act(async () => finish("New text"));
    expect(onPatch).toHaveBeenCalledWith("New text");
    expect(button().textContent).toBe("Generate explanation");
  });

  it("says why when nothing comes back, and leaves the box alone", async () => {
    explainQuestion.mockRejectedValue(new Error("The assistant is busy right now. Try again in a minute."));
    render(q());
    await act(async () => button().click());
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/busy/);
    expect(onPatch).not.toHaveBeenCalled();
  });
});
