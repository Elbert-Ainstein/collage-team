// The Gradescope-shaped graded view: the student's pages beside the rubric,
// each question opening into its full ladder with the marker's pick flagged.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment } from "@/checkins/studentData";
import type { Activity, CheckIn, CheckInResult } from "@/checkins/types";

vi.mock("@/checkins/studentData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listMyQuestions: vi.fn(async () => [
    { id: "q1", activity_id: "combo", label: "Problem 1: At Home Effort", position: 0, created_at: "", points: 3 },
    { id: "q2", activity_id: "combo", label: "Problem 1: Mark-up", position: 1, created_at: "", points: 2 },
  ]),
  listMyRubric: vi.fn(async () => [
    { id: "i-full", activity_id: "combo", row_index: 0, description: "All steps and explanations are well done", deduction: 0, is_custom: false, question_label: "Problem 1: At Home Effort", created_at: "" },
    { id: "i-steps", activity_id: "combo", row_index: 1, description: "Major steps missing", deduction: 2, is_custom: false, question_label: "Problem 1: At Home Effort", created_at: "" },
    { id: "i-mark", activity_id: "combo", row_index: 0, description: "Does not address mistakes", deduction: 1, is_custom: false, question_label: "Problem 1: Mark-up", created_at: "" },
  ]),
  listMyMarks: vi.fn(async () => [
    { id: "m1", result_id: "r1", question_index: 0, question_id: "q1", rubric_item_id: "i-steps", created_at: "" },
  ]),
}));

const getSubmissionFile = vi.fn(async () => ({ id: "f1", path: "c1/combo/r1.pdf", page_count: 2 }));
vi.mock("@/checkins/submissions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSubmissionFile: (...a: unknown[]) => getSubmissionFile(...(a as [])),
  listSubmissionPages: vi.fn(async () => [{ question_id: "q1", page: 2 }]),
  submissionUrl: vi.fn(async () => "blob:whatever"),
}));
vi.mock("./pdfPages", () => ({
  renderPdfPages: vi.fn(async () => ({
    pages: ["data:image/jpeg;base64,a", "data:image/jpeg;base64,b"],
    pageCount: 2,
  })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { GradedView } = await import("./GradedView");

const combo = {
  id: "combo",
  course_id: "c1",
  week: 11,
  title: "comb",
  type: "combo",
  stage: 2,
  position: 1,
  completion: false,
  question_count: 2,
  points_total: 5,
} as unknown as Activity;

const released = { id: "r1", status: "scored", is_ci: false, score: 2, feedback: "Nice work" } as CheckInResult;

const assignment = {
  activity: combo,
  indivCheckIn: { id: "ci1", activity_id: "combo", kind: "individual" } as CheckIn,
  teamCheckIn: null,
  myResult: released,
  teamResult: null,
  status: "Graded",
  grade: "2 / 5 pts",
  teamGrade: "—",
  submitted: null,
} as Assignment;

let host: HTMLDivElement;
let root: Root;

async function show(): Promise<void> {
  await act(async () => {
    root.render(<GradedView assignment={assignment} onBack={() => undefined} />);
  });
  // The loads resolve on the next microtasks; one more turn settles state.
  await act(async () => Promise.resolve());
}

const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text))!;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("GradedView", () => {
  it("shows the total, the note, every page, and one row per question", async () => {
    await show();
    expect(host.textContent).toContain("Your graded work");
    expect(host.textContent).toContain("2 / 5 pts");
    expect(host.textContent).toContain("Nice work");
    expect(host.querySelectorAll(".sv-gpage").length).toBe(2);
    expect(host.textContent).toContain("Problem 1: At Home Effort");
    expect(host.textContent).toContain("1 / 3");
    // Unmarked question: full marks, ✓ on the closed row.
    expect(host.textContent).toContain("Problem 1: Mark-up");
    expect(host.textContent).toContain("2 / 2");
    // No hand-in controls on a graded view.
    expect(host.textContent).not.toContain("Upload");
    expect(host.textContent).not.toContain("Submit assignment");
  });

  it("the first question's ladder starts open, with the marker's pick flagged", async () => {
    await show();
    const picked = host.querySelector(".sv-grung.picked");
    expect(picked?.textContent).toContain("Major steps missing");
    expect(picked?.textContent).toContain("+1");
    // The rung NOT picked is there too — the ladder, not just the pick.
    expect(host.textContent).toContain("All steps and explanations are well done");
    // And the pages this student filed under it.
    expect(host.textContent).toContain("Your pages: p2");
  });

  it("a question opens on press, one at a time, and the open one closes", async () => {
    await show();
    await act(async () => button("Problem 1: Mark-up").click());
    // Switched: Mark-up's ladder is on screen, At Home Effort's is not.
    expect(host.textContent).toContain("Does not address mistakes");
    expect(host.textContent).not.toContain("Major steps missing");
    await act(async () => button("Problem 1: Mark-up").click());
    expect(host.textContent).not.toContain("Does not address mistakes");
  });

  it("says so when the PDF is missing, rather than spinning", async () => {
    getSubmissionFile.mockResolvedValueOnce(null as never);
    await show();
    expect(host.textContent).toContain("No PDF was handed in");
  });
});
