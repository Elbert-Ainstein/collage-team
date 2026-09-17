// A released combo grade comes with its rubric: which ladder row each question
// got, in the instructor's words, with the points beside it. Before release —
// or on a completion — there is no card at all.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment, Enrolment } from "@/checkins/studentData";
import type { Activity, CheckIn, CheckInResult } from "@/checkins/types";

const listMyRubric = vi.fn(async () => [
  { id: "i-steps", activity_id: "combo", row_index: 0, description: "Major steps missing", deduction: 2, is_custom: false, question_label: "1", created_at: "" },
  { id: "i-units", activity_id: "combo", row_index: 1, description: "Missed the units", deduction: 1, is_custom: false, question_label: "2", created_at: "" },
]);
const listMyMarks = vi.fn(async () => [
  { id: "m1", result_id: "r1", question_index: 0, question_id: "q1", rubric_item_id: "i-steps", created_at: "" },
]);

vi.mock("@/checkins/studentData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listMyQuestions: vi.fn(async () => [
    { id: "q1", activity_id: "combo", label: "1", position: 0, created_at: "", points: 3 },
    { id: "q2", activity_id: "combo", label: "2", position: 1, created_at: "", points: 2 },
  ]),
  listMyRubric: (...args: unknown[]) => listMyRubric(...(args as [])),
  listMyMarks: (...args: unknown[]) => listMyMarks(...(args as [])),
  ensureTeamResult: vi.fn(async () => null),
}));
vi.mock("@/checkins/tutorial", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMyMarks: vi.fn(async () => []),
}));
vi.mock("@/checkins/resources", () => ({
  listTeamResources: vi.fn(async () => []),
  resourceUrls: vi.fn(async () => ({ urls: {}, signedAt: 0 })),
}));
vi.mock("./Recorder", () => ({ Recorder: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { Assignments } = await import("./Assignments");

const combo = {
  id: "combo",
  course_id: "c1",
  week: 3,
  title: "Week 3 Combo",
  type: "combo",
  stage: 2,
  position: 1,
  completion: false,
  question_count: 2,
  points_total: 5,
} as unknown as Activity;

function assignment(myResult: CheckInResult | null): Assignment {
  return {
    activity: combo,
    indivCheckIn: { id: "ci1", activity_id: "combo", kind: "individual" } as CheckIn,
    teamCheckIn: null,
    myResult,
    teamResult: null,
    status: myResult?.status === "scored" ? "Graded" : "Turned in",
    grade: myResult?.status === "scored" ? "3 / 5 pts" : "—",
    teamGrade: "—",
    submitted: null,
  } as Assignment;
}

const released = { id: "r1", status: "scored", is_ci: false, score: 3 } as CheckInResult;
const waiting = { id: "r1", status: "needs_review", is_ci: false, score: 3 } as CheckInResult;

const enrolment = {
  student: { id: "s1", name: "Ada Lovelace" },
  course: { id: "c1", name: "AP 50" },
  team: null,
  teammates: [],
} as unknown as Enrolment;

let host: HTMLDivElement;
let root: Root;

async function show(a: Assignment): Promise<void> {
  await act(async () => {
    root.render(
      <Assignments
        enrolment={enrolment}
        assignments={[a]}
        selId={a.activity.id}
        tab="indiv"
        onSelect={() => undefined}
        onBack={() => undefined}
        onTabChange={() => undefined}
        onOpenWork={() => undefined}
        onOpenSubmit={() => undefined}
        onOpenResources={() => undefined}
      />,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the graded-rubric card", () => {
  it("shows each question's picked criterion and points once the grade is released", async () => {
    await show(assignment(released));
    expect(host.textContent).toContain("How it was graded");
    expect(host.textContent).toContain("Q1");
    expect(host.textContent).toContain("Major steps missing");
    expect(host.textContent).toContain("1 / 3");
    // The unmarked question is full marks, said in words, not left blank.
    expect(host.textContent).toContain("Nothing taken off");
    expect(host.textContent).toContain("2 / 2");
  });

  it("shows nothing before release — the marks are not the student's to read yet", async () => {
    await show(assignment(waiting));
    expect(host.textContent).not.toContain("How it was graded");
    expect(listMyMarks).not.toHaveBeenCalled();
  });

  it("shows nothing when there are no marks behind the grade", async () => {
    listMyMarks.mockResolvedValueOnce([]);
    await show(assignment(released));
    expect(host.textContent).not.toContain("How it was graded");
  });
});
