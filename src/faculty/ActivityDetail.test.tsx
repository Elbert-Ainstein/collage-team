// A name on the activity page opens that student's work.
//
// The piles on the right were a read-only list: to reach one student's
// submission, faculty pressed Grade now and stepped through the roster until
// they found them. Now a row on Released, Sent for review or To grade hands
// its student to onGrade, and the grading page lands there. Not submitted
// has nothing behind it, so its rows stay plain text; a TF who cannot grade
// gets plain text everywhere.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";

vi.mock("@/checkins/data", () => ({
  deleteActivity: vi.fn(async () => undefined),
  tintFor: () => null,
  updateActivity: vi.fn(async () => undefined),
}));
vi.mock("@/checkins/audio", () => ({ deleteActivityRecordings: vi.fn(async () => undefined) }));
vi.mock("@/checkins/purge", () => ({ purgeActivityStorage: vi.fn(async () => undefined) }));
vi.mock("./useSignedActivityFiles", () => ({
  useSignedActivityFiles: () => ({ urls: new Map(), refresh: vi.fn() }),
}));
vi.mock("./FacultyApp", () => ({
  linkToActivity: () => "https://example.test/a",
}));
vi.mock("./ActivityTeamPanel", () => ({ ActivityTeamPanel: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ActivityDetail } = await import("./ActivityDetail");

const combo = {
  id: "combo", course_id: "c1", week: 1, title: "Combo 1", type: "combo",
  stage: 2, position: 0, completion: false, question_count: 6, points_total: 20,
  files: [], visible_to_students: true,
} as unknown as Activity;

function data(over: Partial<FacultyData> = {}): FacultyData {
  return {
    activities: [combo],
    weeks: [],
    roster: [
      { id: "s1", name: "Ada Lovelace", avatar_tint: null },
      { id: "s2", name: "Ben Bo", avatar_tint: null },
      { id: "s3", name: "Cy Ng", avatar_tint: null },
      { id: "s4", name: "Di Ott", avatar_tint: null },
    ],
    teams: [],
    questions: [],
    checkIns: [{ id: "ci", activity_id: "combo", kind: "individual", max_points: 20 }],
    results: [
      { id: "r1", check_in_id: "ci", student_id: "s1", team_id: null, status: "scored", score: 18, is_ci: false, submitted_at: "2026-09-13T10:00:00Z" },
      { id: "r2", check_in_id: "ci", student_id: "s2", team_id: null, status: "needs_review", score: 14, is_ci: false, submitted_at: "2026-09-13T10:00:00Z" },
      { id: "r3", check_in_id: "ci", student_id: "s3", team_id: null, status: "submitted", score: null, is_ci: false, submitted_at: "2026-09-13T10:00:00Z" },
    ],
    stats: new Map(),
    can: { grade: true, author: true, rubric: true, release: true, runCheckIns: true },
    ...over,
  } as unknown as FacultyData;
}

let host: HTMLDivElement;
let root: Root;
const onGrade = vi.fn();

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

async function mount(d: FacultyData = data()) {
  await act(async () => {
    root.render(
      <ActivityDetail
        data={d}
        activity={combo}
        onBack={vi.fn()}
        onRubric={vi.fn()}
        onGrade={onGrade}
        onCheckIn={vi.fn()}
        onDuplicate={vi.fn()}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />,
    );
  });
}

const rowFor = (name: string) =>
  [...host.querySelectorAll<HTMLElement>(".fv-person")].find((el) => el.textContent?.includes(name))!;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
};

describe("opening one student's work from the activity page", () => {
  it("a released, in-review or to-grade row opens that student on the grading page", async () => {
    await mount();
    for (const [name, id] of [["Ada", "s1"], ["Ben", "s2"], ["Cy", "s3"]] as const) {
      const row = rowFor(name);
      expect(row.tagName).toBe("BUTTON");
      await click(row);
      expect(onGrade).toHaveBeenLastCalledWith({ subjectId: id, kind: "individual" });
    }
  });

  it("a not-submitted row has nothing to open", async () => {
    await mount();
    // That pile starts folded.
    await click([...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Not submitted"))!);
    expect(rowFor("Di").tagName).toBe("DIV");
  });

  it("Grade now still opens at the top, with no focus", async () => {
    await mount();
    const btn = [...host.querySelectorAll("button")].find((b) => b.textContent === "Grade now")!;
    await click(btn);
    expect(onGrade).toHaveBeenLastCalledWith();
  });

  it("a TF who cannot grade gets plain rows", async () => {
    await mount(data({ can: { grade: false, author: false, rubric: false, release: false, runCheckIns: true } } as Partial<FacultyData>));
    expect(rowFor("Ada").tagName).toBe("DIV");
    expect(rowFor("Cy").tagName).toBe("DIV");
  });
});
