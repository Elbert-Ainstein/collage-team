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
// Who a hand-in was reopened for (0044). `reopens` is what the database holds.
const reopens = { value: [] as string[] };
const reopenHandIn = vi.fn(async () => undefined);
const closeHandIn = vi.fn(async () => undefined);
vi.mock("./facultyData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listReopens: vi.fn(async () => reopens.value),
  reopenHandIn,
  closeHandIn,
}));

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

async function mount(d: FacultyData = data(), activity: Activity = combo) {
  await act(async () => {
    root.render(
      <ActivityDetail
        data={d}
        activity={activity}
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

// What the activity is out of used to live only in the editor, which a TF who
// cannot author never opens. It is a fact about the assignment, not a setting,
// so the read-only header states it for everyone.
describe("what the activity is out of, on the read-only header", () => {
  const tf = () =>
    data({ can: { grade: false, author: false, rubric: false, release: false, runCheckIns: true } } as Partial<FacultyData>);
  const headerLine = () => host.querySelector("h1.fv-display")?.nextElementSibling?.textContent ?? "";

  it("a TF sees the total under the title", async () => {
    await mount(tf());
    expect(headerLine()).toContain("out of 20 pts");
  });

  it("a completion activity says so instead of a number", async () => {
    const d = tf();
    d.activities = [{ ...combo, completion: true } as Activity];
    await act(async () => {
      root.render(
        <ActivityDetail
          data={d}
          activity={d.activities[0]}
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
    expect(headerLine()).toContain("Marked for completion");
    expect(headerLine()).not.toContain("out of");
  });
});

// A student's hand-in closes at the deadline (0044). The instructor reopens it
// for one student at a time from the Not submitted pile, and closes it again
// from the Reopened pile — which lists every reopen that stands, including a
// student who has since handed in and left Not submitted.
describe("reopening a hand-in for one student", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const dueIn = (ms: number) =>
    ({ ...combo, due_at: new Date(Date.now() + ms).toISOString() }) as Activity;
  const owner = () =>
    data({ can: { isOwner: true, grade: true, author: true, rubric: true, release: true, runCheckIns: true } } as Partial<FacultyData>);
  const tf = () =>
    data({ can: { isOwner: false, grade: true, author: false, rubric: true, release: false, runCheckIns: true } } as Partial<FacultyData>);
  const buttonIn = (el: HTMLElement | undefined, text: string) =>
    [...(el?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === text);
  const openNotSubmitted = () =>
    click([...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Not submitted"))!);
  const pile = (label: string) =>
    [...host.querySelectorAll<HTMLElement>(".fv-group")].find((b) => b.textContent?.includes(label));

  beforeEach(() => {
    reopens.value = [];
  });

  it("offers Reopen on a missing student once the deadline has passed", async () => {
    await mount(owner(), dueIn(-DAY));
    await openNotSubmitted();

    const reopen = buttonIn(rowFor("Di"), "Reopen");
    expect(reopen).toBeTruthy();
    await click(reopen!);

    expect(reopenHandIn).toHaveBeenCalledWith("combo", "s4");
    expect(rowFor("Di").textContent).toContain("Reopened");
    expect(buttonIn(rowFor("Di"), "Reopen")).toBeFalsy();
    expect(pile("Reopened")?.textContent).toContain("1");
  });

  it("closes it again from the Reopened pile", async () => {
    reopens.value = ["s4"];
    await mount(owner(), dueIn(-DAY));

    const rows = [...host.querySelectorAll<HTMLElement>(".fv-person")].filter((el) =>
      el.textContent?.includes("Di Ott"),
    );
    const close = rows.map((r) => buttonIn(r, "Close")).find(Boolean);
    expect(close).toBeTruthy();
    await click(close!);

    expect(closeHandIn).toHaveBeenCalledWith("combo", "s4");
    expect(pile("Reopened")).toBeFalsy();
  });

  it("lists a reopened student who has since handed in, so it can still be closed", async () => {
    // Cy (s3) is on To grade, a pile of buttons, so the Close lives here.
    reopens.value = ["s3"];
    await mount(owner(), dueIn(-DAY));
    expect(pile("Reopened")).toBeTruthy();
    const closes = [...host.querySelectorAll<HTMLElement>(".fv-person")]
      .filter((el) => el.tagName === "DIV" && el.textContent?.includes("Cy Ng"))
      .map((r) => buttonIn(r, "Close"));
    expect(closes.some(Boolean)).toBe(true);
  });

  it("offers nothing to reopen before the deadline, when nothing is closed", async () => {
    await mount(owner(), dueIn(DAY));
    await openNotSubmitted();
    expect(buttonIn(rowFor("Di"), "Reopen")).toBeFalsy();
  });

  it("offers nothing to reopen on an activity with no due date", async () => {
    await mount(owner(), combo);
    await openNotSubmitted();
    expect(buttonIn(rowFor("Di"), "Reopen")).toBeFalsy();
  });

  // 0044 lets only the course owner write a reopen. A TF reads who was let in
  // late, and has nothing to press.
  it("a TF sees who it was reopened for, and can neither reopen nor close", async () => {
    reopens.value = ["s4"];
    await mount(tf(), dueIn(-DAY));
    await openNotSubmitted();

    expect(pile("Reopened")).toBeTruthy();
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Reopen")).toBe(false);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Close")).toBe(false);
  });
});
