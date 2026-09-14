// A combo nobody has set up yet, opened straight from grading.
//
// The standard combo rubric was written onto a blank combo only when its
// Rubric page was opened, or when an activity was CHANGED to a combo. A new
// activity is a combo from the start, so a marker who went straight to grading
// found one 0-point question with nothing under it — and no way to select a
// thing. The grader now writes the rubric in on the same rule the builder does.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";

const seeded = [
  {
    id: "ri1",
    activity_id: "act1",
    row_index: 0,
    description: "Missing markup",
    deduction: 2,
    is_custom: true,
    question_label: "Challenge Problem 1: Mark-up",
  },
];
const ensureRubric = vi.fn(async () => [] as typeof seeded);
const seedComboIfBlank = vi.fn(async () => false);
const onChanged = vi.fn();
const onError = vi.fn();

vi.mock("@/checkins/data", () => ({ openResultsFor: vi.fn(async () => 0) }));
vi.mock("./facultyData", () => ({
  addRubricItem: vi.fn(async () => undefined),
  clearMark: vi.fn(async () => undefined),
  ensureRubric: (...a: unknown[]) => ensureRubric(...(a as [])),
  listMarks: vi.fn(async () => []),
  releaseMany: vi.fn(async () => ({ released: 0, failed: 0 })),
  releaseMark: vi.fn(async () => undefined),
  seedComboIfBlank: (...a: unknown[]) => seedComboIfBlank(...(a as [])),
  setFeedback: vi.fn(async () => undefined),
  setMark: vi.fn(async () => undefined),
  updateRubricItem: vi.fn(async () => undefined),
}));
vi.mock("./SubmissionPages", () => ({ SubmissionPages: () => <div>PAGES VIEWER</div> }));
vi.mock("./ActivityTeamPanel", () => ({ ActivityTeamPanel: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { GradingScreen } = await import("./GradingScreen");

const blankCombo = {
  id: "act1",
  course_id: "c1",
  week: 10,
  title: "Untitled activity",
  type: "combo",
  stage: 2,
  position: 0,
  resubmit_mode: "team",
  completion: false,
  question_count: 0,
  points_total: 0,
  points_per_question: 0,
} as unknown as Activity;

function facultyData(author: boolean): FacultyData {
  return {
    course: { id: "c1", name: "AP 50", code: "AP50" },
    weeks: [],
    roster: [{ id: "s1", name: "Caleb Han", avatar_tint: null, course_id: "c1", position: 0 }],
    activities: [blankCombo],
    questions: [],
    checkIns: [{ id: "ci-i", activity_id: "act1", kind: "individual", label: "Individual" }],
    results: [
      { id: "r1", check_in_id: "ci-i", student_id: "s1", team_id: null, status: "submitted" },
    ],
    teams: [],
    tfs: [],
    stats: new Map(),
    can: { isOwner: author, author, grade: true, runCheckIns: true, manageRoster: true, manageTFs: true },
  } as unknown as FacultyData;
}

let host: HTMLDivElement;
let root: Root;

async function mount(data: FacultyData): Promise<void> {
  await act(async () => {
    root.render(
      <GradingScreen
        data={data}
        activity={data.activities[0]}
        onBack={() => undefined}
        onOpenCheckIn={() => undefined}
        onChanged={onChanged}
        onError={onError}
      />,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureRubric.mockResolvedValue([]);
  seedComboIfBlank.mockResolvedValue(false);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("grading a combo nobody has set up", () => {
  it("writes the standard rubric in, then reads it back and refreshes", async () => {
    ensureRubric.mockResolvedValueOnce([]).mockResolvedValueOnce(seeded);
    seedComboIfBlank.mockResolvedValueOnce(true);

    await mount(facultyData(true));

    expect(seedComboIfBlank).toHaveBeenCalledWith(blankCombo, true);
    expect(ensureRubric).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    // The parent's refetch lands: the seeded questions and the 20 arrive, and
    // the ladder that was read back is filed under them.
    const data = facultyData(true);
    const refreshed = {
      ...data,
      activities: [{ ...blankCombo, points_total: 20, question_count: 6 }],
      questions: [
        { id: "q1", activity_id: "act1", label: "Challenge Problem 1: At Home Effort", position: 0, points: 3 },
        { id: "q2", activity_id: "act1", label: "Challenge Problem 1: Mark-up", position: 1, points: 2 },
      ],
    } as unknown as FacultyData;
    await mount(refreshed);

    expect(ensureRubric).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Challenge Problem 1: Mark-up");
    expect(host.textContent).toContain("0 / 20 pts");
    await act(async () => {
      host.querySelectorAll("button").forEach((b) => {
        if (b.textContent?.includes("Question Challenge Problem 1: Mark-up")) b.click();
      });
    });
    expect(host.textContent).toContain("Missing markup");

    // The rows are an accordion: the open question folds on a second click
    // and unfolds on the next, and stays current throughout.
    const row = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Question Challenge Problem 1: Mark-up"),
    )!;
    expect(row.getAttribute("aria-expanded")).toBe("true");
    await act(async () => row.click());
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("Missing markup");
    await act(async () => row.click());
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("Missing markup");
    // Read as what it awards, the way the rubric was written: "Missing
    // markup" is stored as a deduction of 2 on a 2-point question, and a
    // marker should see the +0 Kelly wrote, not the −2 the database holds.
    expect(host.textContent).toContain("+ 0 pts");
    expect(host.textContent).not.toContain("− 2");
    // Unmarked, the question has no score yet — not full marks.
    expect(host.textContent).toContain("— / 2 pts");
  });

  it("leaves a rubric that is already written alone", async () => {
    ensureRubric.mockResolvedValue(seeded);

    await mount(facultyData(true));

    expect(seedComboIfBlank).not.toHaveBeenCalled();
    expect(ensureRubric).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when there was nothing to seed", async () => {
    await mount(facultyData(false));

    expect(seedComboIfBlank).toHaveBeenCalledWith(blankCombo, false);
    expect(ensureRubric).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
