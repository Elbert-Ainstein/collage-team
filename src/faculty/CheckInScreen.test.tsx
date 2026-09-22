// The check-in screen opens on a picker, not a sheet.
//
// It used to land on the first activity in a sidebar list. Faculty said the
// list read like a file tree they had to scan every session, so the first
// screen is now a Drive-style grid: one tile per activity, grouped by week,
// and the sheet only appears once a tile is clicked. These tests pin that
// shape — the tiles, the click, the way back — and the column heading
// "Check-in N", which was "Tutorial check-in N" and is the one string a TF
// reads while standing in the room.

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity, ActivityType } from "@/checkins/types";
import type { TutorialMark, TutorialSheet } from "@/checkins/tutorial";
import type { FacultyData } from "./FacultyApp";

const getTutorialSheet = vi.fn(
  async (): Promise<TutorialSheet> => ({ marks: [], absences: [], graders: [] }),
);
const setTutorialMark = vi.fn(async (): Promise<TutorialMark> => ({}) as TutorialMark);
const setTutorialGrader = vi.fn(async (): Promise<void> => undefined);

vi.mock("@/checkins/tutorial", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/checkins/tutorial")>();
  return {
    ...real,
    getTutorialSheet,
    setTutorialMark,
    setTutorialGrader,
    setTutorialAbsences: vi.fn(async () => undefined),
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { CheckInScreen } = await import("./CheckInScreen");

const activity = (
  id: string,
  title: string,
  week: number,
  type: ActivityType,
): Activity =>
  ({
    id,
    course_id: "c1",
    week,
    title,
    type,
    stage: 2,
    position: 0,
  }) as Activity;

const student = (id: string, name: string) =>
  ({
    id,
    name,
    avatar_tint: null,
    course_id: "c1",
    position: 0,
    email: null,
  }) as never;

function facultyData(): FacultyData {
  return {
    course: { id: "c1", name: "AP 50", code: "AP50" },
    weeks: [],
    roster: [student("s1", "Ada Lovelace")],
    activities: [
      activity("a1", "Velocity", 8, "challenge"),
      activity("a2", "Circuits", 7, "challenge"),
      activity("a3", "Skills sheet", 8, "skills"),
    ],
    questions: [],
    checkIns: [],
    results: [],
    teams: [
      { id: "t1", name: "Team 1", members: [student("s1", "Ada Lovelace")] },
    ],
    tfs: [],
    stats: new Map(),
    can: { runCheckIns: true },
  } as unknown as FacultyData;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getTutorialSheet.mockReset();
  getTutorialSheet.mockResolvedValue({ marks: [], absences: [], graders: [] });
  setTutorialMark.mockReset();
  setTutorialGrader.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

type OnOpen = (id: string | null, opts?: { correction?: boolean }) => void;

/**
 * The owner's half. Which activity is open lives in FacultyApp, on the URL, so
 * a reload lands back on the same sheet — this stands in for it.
 */
function Harness({
  data,
  start,
  onOpen,
}: {
  data: FacultyData;
  start: string | null;
  onOpen?: OnOpen;
}) {
  const [selId, setSelId] = useState<string | null>(start);
  return (
    <CheckInScreen
      data={data}
      selId={selId}
      onOpen={(...args) => {
        onOpen?.(...args);
        setSelId(args[0]);
      }}
    />
  );
}

async function mount(
  data: FacultyData = facultyData(),
  opts: { start?: string | null; onOpen?: OnOpen } = {},
) {
  await act(async () => {
    root.render(<Harness data={data} start={opts.start ?? null} onOpen={opts.onOpen} />);
  });
}

const score = (n: number) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>(".fv-scale:not(.disc) .fv-scalebtn")).find(
    (b) => b.textContent === String(n),
  )!;

const tiles = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>(".fv-cktile"));
const textOf = () => host.textContent ?? "";

describe("CheckInScreen", () => {
  it("opens on a grid of activity tiles, one per team-capable activity, and no sheet", async () => {
    await mount();
    expect(tiles().map((t) => t.textContent)).toEqual([
      expect.stringContaining("Velocity"),
      expect.stringContaining("Circuits"),
    ]);
    // Individual-only work has no team to check in.
    expect(textOf()).not.toContain("Skills sheet");
    expect(host.querySelector("table")).toBeNull();
    expect(getTutorialSheet).not.toHaveBeenCalled();
  });

  it("groups the tiles by week", async () => {
    await mount();
    const eyebrows = Array.from(
      host.querySelectorAll(".fv-ckweek .fv-eyebrow"),
    ).map((e) => e.textContent);
    expect(eyebrows).toEqual(["Week 8", "Week 7"]);
  });

  it("clicking a tile opens that activity's sheet, headed Check-in 1 and Check-in 2", async () => {
    await mount();
    await act(async () => {
      tiles()[1].click();
    });
    expect(getTutorialSheet).toHaveBeenCalledWith("a2");
    expect(host.querySelector("table")).not.toBeNull();
    expect(textOf()).toContain("Circuits");
    expect(textOf()).toContain("Check-in 1");
    expect(textOf()).toContain("Check-in 2");
    expect(textOf()).not.toContain("Tutorial check-in");
    expect(tiles()).toHaveLength(0);
  });

  it("the back button returns to the picker", async () => {
    await mount();
    await act(async () => {
      tiles()[0].click();
    });
    const back = host.querySelector<HTMLButtonElement>(".fv-back");
    expect(back).not.toBeNull();
    await act(async () => {
      back!.click();
    });
    expect(host.querySelector("table")).toBeNull();
    expect(tiles()).toHaveLength(2);
  });

  it("a save error does not follow you back to the picker", async () => {
    setTutorialMark.mockRejectedValueOnce(new Error("offline"));
    await mount();
    await act(async () => {
      tiles()[0].click();
    });
    await act(async () => {
      score(3).click();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("offline");
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".fv-back")!.click();
    });
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("a save that lands after you have opened another sheet is not written into it", async () => {
    let finish: (v: TutorialMark) => void = () => undefined;
    setTutorialMark.mockImplementationOnce(
      () =>
        new Promise<TutorialMark>((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    await act(async () => {
      tiles()[0].click();
    });
    await act(async () => {
      score(4).click();
    });
    expect(score(4).getAttribute("aria-pressed")).toBe("true");

    // Back, then into the other activity — while a1's save is still in flight.
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".fv-back")!.click();
    });
    await act(async () => {
      tiles()[1].click();
    });
    expect(score(4).getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      finish({
        id: "m1", activity_id: "a1", team_id: "t1", slot: 1,
        presenter_id: null, accuracy: 4, discussion: null, updated_at: "",
      });
    });
    expect(score(4).getAttribute("aria-pressed")).toBe("false");
  });

  it("the sheet does not show the last activity's marks while the next one loads", async () => {
    getTutorialSheet.mockResolvedValueOnce({
      marks: [{
        id: "m1", activity_id: "a1", team_id: "t1", slot: 1,
        presenter_id: null, accuracy: 2, discussion: null, updated_at: "",
      }],
      absences: [],
      graders: [],
    });
    getTutorialSheet.mockImplementationOnce(() => new Promise<TutorialSheet>(() => undefined));
    await mount();
    await act(async () => {
      tiles()[0].click();
    });
    expect(score(2).getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".fv-back")!.click();
    });
    await act(async () => {
      tiles()[1].click();
    });
    expect(score(2).getAttribute("aria-pressed")).toBe("false");
  });

  it("opens straight onto the sheet for the activity it is handed — a reload lands back on it", async () => {
    await mount(facultyData(), { start: "a2" });
    expect(getTutorialSheet).toHaveBeenCalledWith("a2");
    expect(host.querySelector("table")).not.toBeNull();
    expect(textOf()).toContain("Circuits");
    expect(tiles()).toHaveLength(0);
  });

  it("a tile click and the back button both hand the selection up to the owner", async () => {
    const onOpen = vi.fn();
    await mount(facultyData(), { onOpen });
    await act(async () => {
      tiles()[1].click();
    });
    expect(onOpen).toHaveBeenLastCalledWith("a2");
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".fv-back")!.click();
    });
    expect(onOpen).toHaveBeenLastCalledWith(null);
  });

  it("an activity it cannot check in on is handed back as a correction, not a page", async () => {
    const onOpen = vi.fn();
    // A skills sheet is individual-only: no team half for the marks to belong to.
    await mount(facultyData(), { start: "a3", onOpen });
    expect(onOpen).toHaveBeenCalledWith(null, { correction: true });
    expect(host.querySelector("table")).toBeNull();
    expect(tiles()).toHaveLength(2);
    expect(getTutorialSheet).not.toHaveBeenCalled();
  });

  it("falls back to the picker if the open activity disappears", async () => {
    await mount();
    await act(async () => {
      tiles()[0].click();
    });
    expect(host.querySelector("table")).not.toBeNull();
    const less = facultyData();
    await mount({ ...less, activities: less.activities.filter((a) => a.id !== "a1") });
    expect(host.querySelector("table")).toBeNull();
    expect(tiles()).toHaveLength(1);
  });
});

describe("the Grading TF column", () => {
  const withTFs = (): FacultyData =>
    ({
      ...facultyData(),
      tfs: [
        { id: "tf1", course_id: "c1", name: "Sam Chen", email: null, avatar_tint: null, user_id: null, position: 0, created_at: "" },
        { id: "tf2", course_id: "c1", name: "Rae Patel", email: null, avatar_tint: null, user_id: null, position: 1, created_at: "" },
      ],
    }) as FacultyData;

  /** One pick per check-in: the staff split the room a section at a time. */
  const graderSelect = (slot: number) =>
    host.querySelector<HTMLSelectElement>(
      `select[aria-label="Who is grading Team 1, check-in ${slot}"]`,
    )!;

  it("offers the instructor and the course's TFs per check-in, and saves the pick", async () => {
    await mount(withTFs(), { start: "a1" });
    expect(textOf()).toContain("Grading TF");
    const sel = graderSelect(2);
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      "—",
      "Instructor",
      "Sam Chen",
      "Rae Patel",
    ]);
    await act(async () => {
      sel.value = "tf2";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(setTutorialGrader).toHaveBeenCalledWith("a1", "t1", 2, "tf2");
    expect(graderSelect(2).value).toBe("tf2");
    // The other check-in is untouched — that is the whole point of the pair.
    expect(graderSelect(1).value).toBe("");
  });

  it("shows what the sheet already recorded, and clears back to nobody", async () => {
    getTutorialSheet.mockResolvedValue({
      marks: [],
      absences: [],
      graders: [
        { activity_id: "a1", team_id: "t1", slot: 1, tf_id: "tf1", instructor: false },
        { activity_id: "a1", team_id: "t1", slot: 2, tf_id: null, instructor: true },
      ],
    });
    await mount(withTFs(), { start: "a1" });
    expect(graderSelect(1).value).toBe("tf1");
    expect(graderSelect(2).value).toBe("instructor");
    await act(async () => {
      graderSelect(1).value = "";
      graderSelect(1).dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(setTutorialGrader).toHaveBeenCalledWith("a1", "t1", 1, null);
  });

  it("a course with no TFs still offers the instructor — she runs check-ins too", async () => {
    await mount(facultyData(), { start: "a1" });
    expect(textOf()).toContain("Grading TF");
    expect([...graderSelect(1).options].map((o) => o.textContent)).toEqual([
      "—",
      "Instructor",
    ]);
  });

  it("a failed save restores the previous pick and says so", async () => {
    setTutorialGrader.mockRejectedValueOnce(new Error("offline"));
    await mount(withTFs(), { start: "a1" });
    await act(async () => {
      graderSelect(1).value = "tf1";
      graderSelect(1).dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(graderSelect(1).value).toBe("");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("offline");
  });
});

describe("the sheet's shape", () => {
  it("stacks the two check-ins under one team, saying the team and the absences once", async () => {
    await mount(facultyData(), { start: "a1" });
    const rows = [...host.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Team 1");
    expect(rows[0].textContent).toContain("Check-in 1");
    expect(rows[1].textContent).toContain("Check-in 2");
    // Said once, spanning the pair — not repeated on the second row.
    expect(rows[1].textContent).not.toContain("Team 1");
    expect(host.querySelectorAll("tbody td[rowspan]")).toHaveLength(2);
    // Seven columns, not the ten that had to be scrolled sideways.
    expect(host.querySelectorAll("thead th")).toHaveLength(7);
  });
});
