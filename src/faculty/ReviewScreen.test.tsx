// The Review tab: Kelly looks over what her TF sent, then releases it in one
// press. Warned first when a combo's 30 is not final.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";

const releaseMany = vi.fn(async (rows: { id: string }[]) => ({ released: rows.length, failed: [] as string[] }));
vi.mock("./facultyData", () => ({
  releaseMany: (...a: unknown[]) => releaseMany(...(a as [{ id: string }[]])),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ReviewScreen } = await import("./ReviewScreen");

const combo = {
  id: "combo", course_id: "c1", week: 3, title: "Week 3 Combo", type: "combo",
  stage: 2, position: 1, completion: false, question_count: 6, points_total: 20,
} as unknown as Activity;
const tutorial = {
  id: "tut", course_id: "c1", week: 3, title: "Tutorial", type: "challenge",
  stage: 2, position: 0, completion: true, question_count: 1, points_total: 5,
} as unknown as Activity;

function data(over: Partial<FacultyData> = {}): FacultyData {
  return {
    activities: [combo, tutorial],
    roster: [{ id: "s1", name: "Ada Lovelace", avatar_tint: null }],
    teams: [],
    checkIns: [
      { id: "ci-combo", activity_id: "combo", kind: "individual", max_points: 20 },
      { id: "ci-tut", activity_id: "tut", kind: "individual", max_points: null },
    ],
    results: [
      { id: "r1", check_in_id: "ci-combo", student_id: "s1", team_id: null, status: "needs_review", score: 18, is_ci: false, feedback: "Nice work" },
      { id: "r3", check_in_id: "ci-tut", student_id: "s1", team_id: null, status: "needs_review", score: null, is_ci: true, ci_met: false },
    ],
    ...over,
  } as unknown as FacultyData;
}

let host: HTMLDivElement;
let root: Root;
const onOpen = vi.fn();
const onChanged = vi.fn();
const onError = vi.fn();

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
    root.render(<ReviewScreen data={d} onOpen={onOpen} onChanged={onChanged} onError={onError} />);
  });
}
const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text))!;

describe("ReviewScreen", () => {
  it("lists what was sent, as the student will read it, with the note", async () => {
    await mount();
    expect(host.textContent).toContain("Week 3 Combo");
    expect(host.textContent).toContain("18 / 25 pts");
    expect(host.textContent).toContain("not final");
    expect(host.textContent).toContain("Not complete");
    expect(host.textContent).toContain("Nice work");
    expect(button("Release all 2")).toBeDefined();
  });

  it("says so when nothing is waiting", async () => {
    await mount(data({ results: [] }));
    expect(host.textContent).toContain("Nothing waiting");
    expect(button("Nothing to release").disabled).toBe(true);
  });

  it("releases one activity's rows as they were sent, and refreshes", async () => {
    await mount();
    await act(async () => button("Release 1").click());
    // The tutorial group is first (position 0): released as Not complete.
    expect(releaseMany).toHaveBeenCalledTimes(1);
    expect(releaseMany).toHaveBeenCalledWith([{ id: "r3", met: false }], true);
    expect(onChanged).toHaveBeenCalled();
    expect(host.textContent).toContain("Released 1.");
  });

  it("warns before releasing a combo whose week is not fully marked, then goes", async () => {
    await mount();
    await act(async () => button("Release all 2").click());
    expect(releaseMany).not.toHaveBeenCalled();
    const dialog = host.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Ada Lovelace — Tutorial completion");
    await act(async () => button("Release 2 anyway").click());
    expect(releaseMany).toHaveBeenCalledTimes(2);
    expect(releaseMany).toHaveBeenCalledWith([{ id: "r1", met: true }], false);
    expect(releaseMany).toHaveBeenCalledWith([{ id: "r3", met: false }], true);
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.textContent).toContain("Released 2.");
  });

  it("Open hands the activity and the person to the grading page", async () => {
    await mount();
    await act(async () => button("Open").click());
    expect(onOpen).toHaveBeenCalledWith("tut", "s1", "individual");
  });
});
