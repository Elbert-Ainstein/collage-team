// The finish button on the grading page.
//
// For the instructor on a combo it reads out of the week's total (Kelly's 30:
// 20 of its own plus the completions), not the combo's own points, and asks before releasing while a completion in the week is still
// unmarked. For a TF it does not release at all: it sends the mark to the
// instructor (0038), and says so.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";

const ladder = [
  { id: "ri1", activity_id: "act1", row_index: 0, description: "Full marks", deduction: 0, is_custom: true, question_label: "Mark-up" },
  { id: "ri2", activity_id: "act1", row_index: 1, description: "Missing markup", deduction: 2, is_custom: true, question_label: "Mark-up" },
];
const releaseMark = vi.fn(async () => undefined);
const sendForReview = vi.fn(async () => undefined);
const setActivityPoints = vi.fn(async () => undefined);
const onChanged = vi.fn();
const onError = vi.fn();

vi.mock("@/checkins/data", () => ({ openResultsFor: vi.fn(async () => 0) }));
vi.mock("./facultyData", () => ({
  addRubricItem: vi.fn(async () => undefined),
  clearMark: vi.fn(async () => undefined),
  ensureRubric: vi.fn(async () => ladder),
  listMarks: vi.fn(async () => []),
  releaseMany: vi.fn(async () => ({ released: 0, failed: [] })),
  releaseMark: (...a: unknown[]) => releaseMark(...(a as [])),
  seedComboIfBlank: vi.fn(async () => false),
  sendForReview: (...a: unknown[]) => sendForReview(...(a as [])),
  sendManyForReview: vi.fn(async () => ({ sent: 0, failed: [] })),
  setActivityPoints: (...a: unknown[]) => setActivityPoints(...(a as [])),
  setFeedback: vi.fn(async () => undefined),
  setMark: vi.fn(async () => undefined),
  updateRubricItem: vi.fn(async () => undefined),
}));
vi.mock("./SubmissionPages", () => ({ SubmissionPages: () => <div>PAGES</div> }));
vi.mock("./ActivityTeamPanel", () => ({ ActivityTeamPanel: () => <div>TEAM PANEL</div> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { GradingScreen } = await import("./GradingScreen");

const combo = {
  id: "act1", course_id: "c1", week: 10, title: "Week 10 Combo", type: "combo",
  stage: 2, position: 1, resubmit_mode: "team", completion: false,
  question_count: 1, points_total: 2, points_per_question: 2,
} as unknown as Activity;
const tutorial = {
  id: "tut", course_id: "c1", week: 10, title: "Tutorial", type: "challenge",
  stage: 2, position: 0, completion: true, question_count: 1, points_total: 5,
} as unknown as Activity;

function facultyData(owner: boolean, tutorialStatus = "submitted"): FacultyData {
  return {
    course: { id: "c1", name: "AP 50", code: "AP50" },
    weeks: [],
    roster: [{ id: "s1", name: "Caleb Han", avatar_tint: null, course_id: "c1", position: 0 }],
    activities: [combo, tutorial],
    questions: [{ id: "q1", activity_id: "act1", label: "Mark-up", position: 0, points: 2 }],
    checkIns: [
      { id: "ci-i", activity_id: "act1", kind: "individual", label: "Individual" },
      { id: "ci-t", activity_id: "tut", kind: "individual", label: "Individual", max_points: null },
    ],
    results: [
      { id: "r1", check_in_id: "ci-i", student_id: "s1", team_id: null, status: "submitted" },
      { id: "r2", check_in_id: "ci-t", student_id: "s1", team_id: null, status: tutorialStatus, is_ci: true, ci_met: true },
    ],
    teams: [],
    tfs: [],
    stats: new Map(),
    can: { isOwner: owner, author: owner, grade: true, rubric: true, release: owner, runCheckIns: true, manageRoster: owner, manageTFs: owner },
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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text))!;

// The only question is already open, so its ladder is on screen.
async function markFull() {
  await act(async () => button("Full marks").click());
}

describe("the finish button on a combo", () => {
  it("reads out of the week's total, and asks before releasing while the tutorial is unmarked", async () => {
    await mount(facultyData(true));
    await markFull();
    const btn = button("Release 2 / 7 pts");
    expect(btn).toBeDefined();
    expect(btn.disabled).toBe(false);

    await act(async () => btn.click());
    expect(releaseMark).not.toHaveBeenCalled();
    const dialog = host.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Tutorial completion");
    expect(dialog?.textContent).toContain("2 / 7 pts");

    await act(async () => button("Release anyway").click());
    expect(releaseMark).toHaveBeenCalledWith("r1", false, true);
    expect(onChanged).toHaveBeenCalled();
  });

  it("Cancel keeps the grade unreleased", async () => {
    await mount(facultyData(true));
    await markFull();
    await act(async () => button("Release 2 / 7 pts").click());
    await act(async () => button("Cancel").click());
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(releaseMark).not.toHaveBeenCalled();
  });

  it("releases straight away once the week is fully marked", async () => {
    await mount(facultyData(true, "scored"));
    await markFull();
    // The released tutorial adds its 5.
    await act(async () => button("Release 7 / 7 pts").click());
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(releaseMark).toHaveBeenCalledWith("r1", false, true);
  });
});

describe("a combo priced at the week", () => {
  it("says the 30 was typed on the combo, and what to set it to", async () => {
    const data = facultyData(true);
    // Questions add to 2, the tutorial adds 5, and somebody typed 7 on the combo.
    await mount({
      ...data,
      activities: [{ ...combo, points_total: 7, points_per_question: 7 }, tutorial],
    } as FacultyData);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("set to 7 pts but its questions add up to 2 pts");
    expect(alert?.textContent).toContain("every score reads 5 too high");

    // One press sets it, and the parent re-reads.
    await act(async () => button("Set this combo to 2 pts").click());
    expect(setActivityPoints).toHaveBeenCalledWith("act1", 2);
    expect(onChanged).toHaveBeenCalled();
  });

  it("a TF is told to ask, and gets no button", async () => {
    const data = facultyData(false);
    await mount({
      ...data,
      activities: [{ ...combo, points_total: 7, points_per_question: 7 }, tutorial],
    } as FacultyData);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Ask the instructor to set it to 2 pts",
    );
    expect(button("Set this combo")).toBeUndefined();
  });

  it("says nothing when the combo is priced at its own questions", async () => {
    await mount(facultyData(true));
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("opening from the Review tab", () => {
  it("lands on the team half when the row was a team's, and stays there", async () => {
    const data = facultyData(true);
    const both = {
      ...data,
      activities: [{ ...combo, type: "challenge", completion: false }, tutorial],
      checkIns: [
        ...data.checkIns,
        { id: "ci-team", activity_id: "act1", kind: "team", label: "Team" },
      ],
      teams: [{ id: "t1", name: "Team 1", members: [] }],
      results: [
        ...data.results,
        { id: "r9", check_in_id: "ci-team", student_id: null, team_id: "t1", status: "needs_review", score: 1 },
      ],
    } as unknown as FacultyData;
    await act(async () => {
      root.render(
        <GradingScreen
          data={both}
          activity={both.activities[0]}
          focus={{ subjectId: "t1", kind: "team" }}
          onBack={() => undefined}
          onOpenCheckIn={() => undefined}
          onChanged={onChanged}
          onError={onError}
        />,
      );
    });
    // The team half is the check-in panel, and the toggle stays on it after
    // the mount effect that used to reset it.
    const teamToggle = [...host.querySelectorAll<HTMLButtonElement>(".fv-seg button")].find(
      (b) => b.textContent === "Team",
    )!;
    expect(teamToggle.className).toContain("on");
    expect(host.textContent).toContain("TEAM PANEL");
  });
});

describe("a TF's finish button", () => {
  it("sends for review instead of releasing, and never asks the combo question", async () => {
    await mount(facultyData(false));
    await markFull();
    const btn = button("Send 2 / 7 pts for review");
    expect(btn).toBeDefined();
    await act(async () => btn.click());
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(releaseMark).not.toHaveBeenCalled();
    expect(sendForReview).toHaveBeenCalledWith("r1", false, true);
    expect(onChanged).toHaveBeenCalled();
  });

  it("reads Sent for review once it has gone, and is done", async () => {
    const data = facultyData(false);
    await mount({
      ...data,
      results: data.results.map((r) => (r.id === "r1" ? { ...r, status: "needs_review", score: 2 } : r)),
    } as FacultyData);
    expect(host.textContent).toContain("Sent for review");
    expect(button("Sent for review").disabled).toBe(true);
    expect(host.textContent).toContain("Send for review");
  });

  it("keeps the completion answer on the radios after sending it", async () => {
    const data = facultyData(false);
    const tut = {
      ...data,
      activities: [tutorial, combo],
      results: data.results.map((r) =>
        r.id === "r2" ? { ...r, status: "needs_review", is_ci: true, ci_met: false } : r,
      ),
    } as FacultyData;
    await mount(tut);
    const notComplete = host.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]');
    expect(notComplete?.textContent).toContain("Not complete");
    expect(button("Send again").disabled).toBe(false);
  });

  it("cannot touch a released row", async () => {
    const data = facultyData(false);
    await mount({
      ...data,
      results: data.results.map((r) => (r.id === "r1" ? { ...r, status: "scored", score: 2 } : r)),
    } as FacultyData);
    const btn = button("Released");
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("Released by the instructor");
  });
});
