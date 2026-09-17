// The Review tab opens on a picker, not a list.
//
// Faculty could not scroll the old list past the fold, and a single column of
// every activity's table was a lot to read past on the way to the one they
// meant to check. So it opens the way Check-in does: one tile per activity
// with marks waiting, and the page for one activity — every student, the
// grade they will read, the note, a way into the grading page — only once a
// tile is clicked. Release everything from the picker, or one activity's
// worth from its page; warned first when a combo's 30 is not final.

import { act, useState } from "react";
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
    weeks: [],
    roster: [
      { id: "s1", name: "Ada Lovelace", avatar_tint: null },
      { id: "s2", name: "Ben Bo", avatar_tint: null },
    ],
    teams: [],
    checkIns: [
      { id: "ci-combo", activity_id: "combo", kind: "individual", max_points: 20 },
      { id: "ci-tut", activity_id: "tut", kind: "individual", max_points: null },
    ],
    results: [
      { id: "r1", check_in_id: "ci-combo", student_id: "s1", team_id: null, status: "needs_review", score: 18, is_ci: false, feedback: "Nice work" },
      { id: "r2", check_in_id: "ci-combo", student_id: "s2", team_id: null, status: "submitted", score: null, is_ci: false },
      { id: "r3", check_in_id: "ci-tut", student_id: "s1", team_id: null, status: "needs_review", score: null, is_ci: true, ci_met: false },
      { id: "r4", check_in_id: "ci-tut", student_id: "s2", team_id: null, status: "scored", score: null, is_ci: true, ci_met: true },
    ],
    ...over,
  } as unknown as FacultyData;
}

type OnSelect = (id: string | null, opts?: { correction?: boolean }) => void;

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

/** Owns `selId` the way FacultyApp does, so a tile click really opens a page. */
function Harness({
  data,
  start,
  onSelect,
}: {
  data: FacultyData;
  start: string | null;
  onSelect?: OnSelect;
}) {
  const [selId, setSelId] = useState<string | null>(start);
  return (
    <ReviewScreen
      data={data}
      selId={selId}
      onSelect={(...args) => {
        onSelect?.(...args);
        setSelId(args[0]);
      }}
      onOpen={onOpen}
      onChanged={onChanged}
      onError={onError}
    />
  );
}

async function mount(d: FacultyData = data(), opts: { start?: string | null; onSelect?: OnSelect } = {}) {
  await act(async () => {
    root.render(<Harness data={d} start={opts.start ?? null} onSelect={opts.onSelect} />);
  });
}
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("button")];
const button = (text: string) => buttons().find((b) => b.textContent?.includes(text))!;
const tile = (title: string) =>
  buttons().find((b) => b.getAttribute("aria-label") === `Review ${title}`)!;

describe("ReviewScreen: the picker", () => {
  it("opens on one tile per activity with marks waiting, and Release all", async () => {
    await mount();
    expect(tile("Week 3 Combo")).toBeDefined();
    expect(tile("Tutorial")).toBeDefined();
    expect(tile("Week 3 Combo").textContent).toContain("1 waiting");
    expect(tile("Week 3 Combo").textContent).toContain("1 still being marked");
    expect(tile("Tutorial").textContent).toContain("1 released");
    expect(button("Release all 2")).toBeDefined();
    // No student is on the picker: that is the page's job.
    expect(host.textContent).not.toContain("Ada Lovelace");
    expect(host.querySelector("table")).toBeNull();
  });

  it("groups the tiles by week", async () => {
    await mount();
    const week = host.querySelector('section[aria-label="Week 3"]');
    expect(week).not.toBeNull();
    expect(week?.querySelectorAll("button").length).toBe(2);
  });

  it("says so when nothing is waiting", async () => {
    await mount(data({ results: [] }));
    expect(host.textContent).toContain("Nothing waiting");
    expect(button("Nothing to release").disabled).toBe(true);
  });

  it("a tile opens that activity's page", async () => {
    const onSelect = vi.fn();
    await mount(data(), { onSelect });
    await act(async () => tile("Week 3 Combo").click());
    expect(onSelect).toHaveBeenLastCalledWith("combo");
    expect(host.querySelector("h1")?.textContent).toBe("Week 3 Combo");
    expect(host.textContent).toContain("Ada Lovelace");
  });

  it("warns before releasing everything when a combo's week is not fully marked, then goes", async () => {
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
});

describe("ReviewScreen: one activity", () => {
  it("lists every student sent, as they will read it, with the whole note", async () => {
    await mount(data(), { start: "combo" });
    expect(host.querySelector("h1")?.textContent).toBe("Week 3 Combo");
    expect(host.textContent).toContain("Ada Lovelace");
    expect(host.textContent).toContain("18 / 25 pts");
    expect(host.textContent).toContain("not final");
    expect(host.textContent).toContain("Nice work");
    expect(host.textContent).toContain("1 still being marked");
    // Ben is still on the TF's desk: not here.
    expect(host.textContent).not.toContain("Ben Bo");
    expect(button("Release 1")).toBeDefined();
  });

  it("the rows sit in the panel's scrolling region, so a long list is reachable", async () => {
    await mount(data(), { start: "combo" });
    expect(host.querySelector(".fv-scroll table")).not.toBeNull();
  });

  it("back returns to the picker", async () => {
    const onSelect = vi.fn();
    await mount(data(), { start: "tut", onSelect });
    const back = buttons().find((b) => b.getAttribute("aria-label") === "Back to all activities")!;
    await act(async () => back.click());
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(tile("Tutorial")).toBeDefined();
  });

  it("releases this activity's rows as they were sent, and refreshes", async () => {
    await mount(data(), { start: "tut" });
    await act(async () => button("Release 1").click());
    expect(releaseMany).toHaveBeenCalledTimes(1);
    expect(releaseMany).toHaveBeenCalledWith([{ id: "r3", met: false }], true);
    expect(onChanged).toHaveBeenCalled();
    expect(host.textContent).toContain("Released 1.");
  });

  it("an already-released row stays listed with a mark, and Release skips it", async () => {
    await mount(data(), { start: "tut" });
    // Ben's grade went out in an earlier batch: still on the page, marked.
    expect(host.textContent).toContain("Ben Bo");
    expect(host.textContent).toContain("1 waiting · 1 released");
    const ben = [...host.querySelectorAll("tr")].find((tr) => tr.textContent?.includes("Ben Bo"))!;
    expect(ben.textContent).toContain("Released");
    // The button counts only Ada, and pressing it sends only her row.
    await act(async () => button("Release 1").click());
    expect(releaseMany).toHaveBeenCalledTimes(1);
    expect(releaseMany).toHaveBeenCalledWith([{ id: "r3", met: false }], true);
  });

  it("Release all from the picker also skips what already went out", async () => {
    await mount();
    await act(async () => button("Release all 2").click());
    await act(async () => button("Release 2 anyway").click());
    const sent = releaseMany.mock.calls.flatMap((c) => c[0] as { id: string }[]);
    expect(sent.map((r) => r.id).sort()).toEqual(["r1", "r3"]);
  });

  it("a release that fails is reported, not swallowed", async () => {
    releaseMany.mockRejectedValueOnce(new Error("offline"));
    await mount(data(), { start: "tut" });
    await act(async () => button("Release 1").click());
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
    expect(onChanged).not.toHaveBeenCalled();
    expect(button("Release 1").disabled).toBe(false);
  });

  it("Open hands the activity and the person to the grading page", async () => {
    await mount(data(), { start: "tut" });
    await act(async () => button("Open").click());
    expect(onOpen).toHaveBeenCalledWith("tut", "s1", "individual");
  });

  it("an activity with nothing waiting sends you back to the picker, as a correction", async () => {
    const onSelect = vi.fn();
    await mount(data({ results: [] }), { start: "combo", onSelect });
    expect(onSelect).toHaveBeenCalledWith(null, { correction: true });
    expect(host.textContent).toContain("Nothing waiting");
  });
});
