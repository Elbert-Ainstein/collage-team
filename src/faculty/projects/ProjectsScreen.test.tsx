// The Projects tab, walked the way a grader walks a project fair: the list of
// projects, a project's teams with a dot per grader, one team's graders, and
// one grader's sheet — score every category, say why, mark it done. The data
// layer is mocked; what's pinned is the flow and what gets written.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamWithMembers } from "@/checkins/types";
import type { GradingKey, ProjectGrading, ProjectScore, ProjectSnapshot, ProjectsOverview } from "@/projects/types";
import type { FacultyData } from "../FacultyApp";

let snapshot: ProjectSnapshot;
/** The project's live channel, captured so a test can play "someone else wrote". */
let live: (() => void) | null = null;

const listProjects = vi.fn(
  async (): Promise<ProjectsOverview> => ({
    projects: [snapshot.project],
    categoryCount: new Map([["p1", snapshot.categories.length]]),
    gradings: snapshot.gradings,
  }),
);
// A copy each time, as the real read is: handing back the same object would
// look to React like nothing changed.
const loadProject = vi.fn(async (): Promise<ProjectSnapshot | null> => structuredClone(snapshot));
const saveGraderName = vi.fn(
  async (k: GradingKey, name: string): Promise<ProjectGrading> => ({
    project_id: k.projectId,
    team_id: k.teamId,
    slot: k.slot,
    grader_name: name,
    done_at: null,
    updated_by: "u1",
    updated_at: "2026-11-01T10:00:00Z",
  }),
);
const saveScore = vi.fn(
  async (k: GradingKey, categoryId: string, v: { score: number | null; reason: string }): Promise<ProjectScore> => ({
    project_id: k.projectId,
    team_id: k.teamId,
    slot: k.slot,
    category_id: categoryId,
    score: v.score,
    reason: v.reason,
    updated_at: "2026-11-01T10:00:00Z",
  }),
);
const setGradingDone = vi.fn(
  async (k: GradingKey, done: boolean): Promise<ProjectGrading> => ({
    project_id: k.projectId,
    team_id: k.teamId,
    slot: k.slot,
    grader_name: "Will",
    done_at: done ? "2026-11-01T10:05:00Z" : null,
    updated_by: "u1",
    updated_at: "2026-11-01T10:05:00Z",
  }),
);

vi.mock("@/projects/data", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/projects/data")>();
  return {
    ...real,
    listProjects,
    loadProject,
    saveGraderName,
    saveScore,
    setGradingDone,
    watchProject: vi.fn((_: string, onChange: () => void) => {
      live = onChange;
      return () => {
        live = null;
      };
    }),
    clearGrading: vi.fn(async () => undefined),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ProjectsScreen } = await import("./ProjectsScreen");

const member = (id: string, name: string) =>
  ({ id, name, avatar_tint: null, course_id: "c1", position: 0, email: null }) as never;

const teams: TeamWithMembers[] = [
  { id: "t1", team_set_id: "set1", name: "Team 1", position: 0, created_at: "", members: [member("s1", "Ada"), member("s2", "Bo")] },
  { id: "t2", team_set_id: "set1", name: "Team 2", position: 1, created_at: "", members: [member("s3", "Cy")] },
];

const levels = (name: string) => [1, 2, 3, 4, 5].map((n) => `${name} ${n}`);

function freshSnapshot(): ProjectSnapshot {
  return {
    project: {
      id: "p1",
      course_id: "c1",
      title: "Project fair",
      graders_per_team: 2,
      team_set_id: null,
      position: 0,
      created_at: "",
      updated_at: "",
    },
    categories: [
      { id: "rob", project_id: "p1", position: 0, name: "Robustness", levels: levels("Robust"), created_at: "" },
      { id: "time", project_id: "p1", position: 1, name: "Time", levels: levels("Time"), created_at: "" },
    ],
    gradings: [
      // Team 2 already has a done grader and one who's started.
      {
        project_id: "p1",
        team_id: "t2",
        slot: 1,
        grader_name: "Will",
        done_at: "2026-11-01T09:00:00Z",
        updated_by: null,
        updated_at: "2026-11-01T09:00:00Z",
      },
      {
        project_id: "p1",
        team_id: "t2",
        slot: 2,
        grader_name: "Kelly",
        done_at: null,
        updated_by: null,
        updated_at: "2026-11-01T09:00:00Z",
      },
    ],
    scores: [
      {
        project_id: "p1",
        team_id: "t2",
        slot: 1,
        category_id: "rob",
        score: 5,
        reason: "7 parts, cool pulley that actuates",
        updated_at: "2026-11-01T09:00:00Z",
      },
      {
        project_id: "p1",
        team_id: "t2",
        slot: 1,
        category_id: "time",
        score: 4,
        reason: "6:47",
        updated_at: "2026-11-01T09:00:00Z",
      },
    ],
  };
}

/** Another phone wrote: change what the server holds, and tell the open copy. */
async function elsewhere(change: (s: ProjectSnapshot) => void) {
  change(snapshot);
  await act(async () => {
    live?.();
    // The copy waits for a burst to settle before it re-reads.
    await new Promise((r) => setTimeout(r, 350));
  });
  await settle();
}

const row = (team: string, slot: number, category: string, score: number | null, reason: string): ProjectScore => ({
  project_id: "p1",
  team_id: team,
  slot,
  category_id: category,
  score,
  reason,
  updated_at: "2026-11-01T11:00:00Z",
});

function facultyData(grade = true, author = true): FacultyData {
  return {
    course: { id: "c1", name: "AP 50", code: "AP50" },
    weeks: [],
    roster: [],
    activities: [],
    questions: [],
    checkIns: [],
    results: [],
    teams,
    teamSetId: "set1",
    tfs: [],
    instructor: "Kelly",
    stats: new Map(),
    can: {
      isOwner: author,
      author,
      grade,
      release: true,
      rubric: true,
      runCheckIns: true,
      manageRoster: true,
      manageTFs: true,
    },
  } as unknown as FacultyData;
}

let host: HTMLDivElement;
let root: Root;
const onError = vi.fn();

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function mount(data = facultyData()) {
  await act(async () => {
    root.render(<ProjectsScreen data={data} me="Will" home={0} onError={onError} />);
  });
  await settle();
}

const buttons = () => [...host.querySelectorAll("button")];
const button = (text: string | RegExp) => {
  const b = buttons().find((x) =>
    typeof text === "string" ? x.textContent?.trim() === text : text.test(x.textContent ?? ""),
  );
  if (!b) throw new Error(`No button ${text}: ${buttons().map((x) => x.textContent?.trim()).join(" | ")}`);
  return b;
};
const click = async (el: Element) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
};
const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const blur = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  await settle();
};
const section = (name: string) => host.querySelector(`section[aria-label="${name}"]`) as HTMLElement;

beforeEach(() => {
  snapshot = freshSnapshot();
  window.history.replaceState(null, "", "/ck?s=projects");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the Projects tab", () => {
  it("goes from the list to a project's teams, each with a dot per grader", async () => {
    await mount();
    expect(host.textContent).toContain("Projects");
    expect(host.textContent).toContain("0 of 2 teams done");

    await click(button(/Project fair/));
    expect(window.location.search).toBe("?s=projects&proj=p1");
    const rows = [...host.querySelectorAll(".pj-teamrow")];
    expect(rows.map((r) => r.querySelector(".pj-teamname")?.textContent)).toEqual(["Team 1", "Team 2"]);

    // Team 1: nobody yet. Team 2: Will done, Kelly in progress, and a score
    // from Will's done grading alone.
    const chips = (row: Element) => [...row.querySelectorAll(".pj-chip")].map((c) => c.getAttribute("aria-label"));
    expect(chips(rows[0])).toEqual(["Team 1, Grader 1: not started", "Team 1, Grader 2: not started"]);
    expect(chips(rows[1])).toEqual(["Team 2, Will: done", "Team 2, Kelly: in progress"]);
    expect(rows[1].querySelector(".pj-teamscore")?.textContent).toBe("9 / 10");
    expect(rows[0].querySelector(".pj-teamscore")?.textContent).toBe("—");
  });

  it("opens a team's graders, then a grader's sheet with the rubric", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1");
    await mount();
    await click(host.querySelector(".pj-teamopen") as Element);
    expect(window.location.search).toBe("?s=projects&proj=p1&team=t1");
    expect(host.textContent).toContain("Grader 1");
    expect(host.textContent).toContain("Grader 2");
    // An empty slot is an invitation, for someone who can grade.
    expect(host.querySelector(".pj-grader.empty")?.textContent).toContain("Grade");

    await click(button(/Grader 1/));
    expect(window.location.search).toBe("?s=projects&proj=p1&team=t1&slot=1");
    expect(host.querySelector("h1")?.textContent).toBe("Team 1 — Grader 1");

    // Every category, 5 down to 1; each button carries what its score means,
    // and the picked one's meaning shows under the row.
    const rob = section("Robustness");
    expect([...rob.querySelectorAll(".pj-opt")].map((o) => o.textContent)).toEqual(["5", "4", "3", "2", "1"]);
    expect(rob.querySelector(".pj-opt.s5")?.getAttribute("aria-label")).toBe("5: Robust 5");
    expect(rob.querySelector(".pj-meaning")).toBeNull();
    expect(section("Time")).toBeTruthy();
    // The name is theirs, filled in, and not saved just for looking.
    expect((host.querySelector(".pj-namein") as HTMLInputElement).value).toBe("Will");
    expect(saveGraderName).not.toHaveBeenCalled();

    await click(rob.querySelector(".pj-opt.s4") as Element);
    expect(section("Robustness").querySelector(".pj-meaning")?.textContent).toBe("Robust 4");
    expect(saveGraderName).toHaveBeenCalledTimes(1);
  });

  it("saves as they grade, needs a reason for every score, and marks it done", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1&team=t1&slot=1");
    await mount();

    // A score: the name goes first, then the score.
    await click(section("Robustness").querySelector(".pj-opt.s4") as Element);
    expect(saveGraderName).toHaveBeenCalledWith({ projectId: "p1", teamId: "t1", slot: 1 }, "Will");
    expect(saveScore).toHaveBeenLastCalledWith({ projectId: "p1", teamId: "t1", slot: 1 }, "rob", {
      score: 4,
      reason: "",
    });
    expect(saveGraderName.mock.invocationCallOrder[0]).toBeLessThan(saveScore.mock.invocationCallOrder[0]);

    // Mark done too early: nothing is sent, and the sheet says what's missing.
    expect(host.querySelector(".pj-left")?.textContent).toBe("0 of 2 categories complete");
    await click(button(/Mark done/));
    expect(setGradingDone).not.toHaveBeenCalled();
    expect(section("Robustness").textContent).toContain("Say why before marking it done.");
    expect(section("Time").textContent).toContain("Pick a score.");

    // Reasons other graders gave in this category are offered; one press uses it.
    const chip = section("Robustness").querySelector(".pj-reuse") as HTMLElement;
    expect(chip.textContent).toBe("Reuse:7 parts, cool pulley that actuates");
    await click(chip);
    expect(saveScore).toHaveBeenLastCalledWith(expect.anything(), "rob", {
      score: 4,
      reason: "7 parts, cool pulley that actuates",
    });
    // With a reason written, the earlier ones step aside.
    expect(section("Robustness").querySelector(".pj-reuse")).toBeNull();
    expect(host.querySelector(".pj-left")?.textContent).toBe("1 of 2 categories complete");

    // Typing saves when they move on.
    await click(section("Time").querySelector(".pj-opt.s3") as Element);
    const why = section("Time").querySelector("textarea") as HTMLTextAreaElement;
    await typeInto(why, "6:47, slow start");
    await blur(why);
    expect(saveScore).toHaveBeenLastCalledWith(expect.anything(), "time", { score: 3, reason: "6:47, slow start" });

    expect(host.querySelector(".pj-running")?.textContent).toBe("7 / 10");
    await click(button(/Mark done/));
    expect(setGradingDone).toHaveBeenCalledWith({ projectId: "p1", teamId: "t1", slot: 1 }, true);
    expect(onError).not.toHaveBeenCalled();

    // Done: locked, with a way back in.
    expect(host.textContent).toContain("Done at");
    expect(button("Edit")).toBeTruthy();
    expect((section("Time").querySelector(".pj-opt.s5") as HTMLButtonElement).disabled).toBe(true);

    // One press back to the team list, which says so.
    await click(button("Back to teams"));
    expect(window.location.search).toBe("?s=projects&proj=p1");
    const row = host.querySelector(".pj-teamrow") as HTMLElement;
    expect(row.querySelector(".pj-chip")?.getAttribute("aria-label")).toBe("Team 1, Will: done");
    expect(row.querySelector(".pj-teamscore")?.textContent).toBe("7 / 10");
  });

  it("pressing the picked score again unpicks it", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1&team=t1&slot=1");
    await mount();
    const five = () => section("Robustness").querySelector(".pj-opt.s5") as Element;
    await click(five());
    await click(five());
    expect(saveScore).toHaveBeenLastCalledWith(expect.anything(), "rob", { score: null, reason: "" });
    expect(five().getAttribute("aria-checked")).toBe("false");
  });

  it("is read-only for someone who can't grade", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1&team=t2&slot=1");
    await mount(facultyData(false));
    expect(host.textContent).toContain("read-only");
    expect(host.textContent).not.toContain("Mark done");
    expect(host.querySelector("textarea")).toBeNull();
    expect(section("Robustness").textContent).toContain("7 parts, cool pulley that actuates");
  });

  it("goes back to the project when a linked team isn't on it", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1&team=gone");
    await mount();
    expect(window.location.search).toBe("?s=projects&proj=p1");
    expect(host.querySelectorAll(".pj-teamrow")).toHaveLength(2);
  });

  it("takes in what another device saves, and keeps what this grader hasn't saved yet", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1&team=t1&slot=1");
    await mount();
    await click(section("Robustness").querySelector(".pj-opt.s4") as Element);
    const why = section("Time").querySelector("textarea") as HTMLTextAreaElement;
    await typeInto(why, "still typing");

    // The same grader, on their other phone, changes both categories.
    await elsewhere((s) => {
      s.gradings.push({ project_id: "p1", team_id: "t1", slot: 1, grader_name: "Will", done_at: null, updated_by: "u1", updated_at: "" });
      s.scores.push(row("t1", 1, "rob", 2, "Fell over"), row("t1", 1, "time", 3, "From the other phone"));
    });
    // Robustness had nothing unsaved here, so it follows; Time is mid-edit, so it stays.
    expect(section("Robustness").querySelector(".pj-opt.s2")?.getAttribute("aria-checked")).toBe("true");
    expect((section("Robustness").querySelector("textarea") as HTMLTextAreaElement).value).toBe("Fell over");
    expect((section("Time").querySelector("textarea") as HTMLTextAreaElement).value).toBe("still typing");
    // Same name, same person: no warning.
    expect(host.querySelector(".pj-clash")).toBeNull();
  });

  it("warns when someone else takes the same slot, and offers a free one", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1&team=t1&slot=1");
    await mount();
    await elsewhere((s) => {
      s.gradings.push({ project_id: "p1", team_id: "t1", slot: 1, grader_name: "Bo", done_at: null, updated_by: "u2", updated_at: "" });
      s.scores.push(row("t1", 1, "rob", 2, "Bo's"));
    });
    const clash = host.querySelector(".pj-clash") as HTMLElement;
    expect(clash.textContent).toContain("Bo is grading this slot too");

    // Mark done does nothing while two people are on one slot.
    await click(button(/Mark done/));
    expect(setGradingDone).not.toHaveBeenCalled();

    await click(button("Use Grader 2"));
    expect(window.location.search).toBe("?s=projects&proj=p1&team=t1&slot=2");
    expect(host.querySelector("h1")?.textContent).toBe("Team 1 — Grader 2");
  });

  it("shows a read-only sheet as it's saved, even when it's saved after opening", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1&team=t1&slot=1");
    await mount(facultyData(false));
    expect(host.querySelector(".pj-running")?.textContent).toBe("0 / 10");
    await elsewhere((s) => {
      s.gradings.push({ project_id: "p1", team_id: "t1", slot: 1, grader_name: "Will", done_at: "2026-11-01T12:00:00Z", updated_by: "u1", updated_at: "" });
      s.scores.push(row("t1", 1, "rob", 5, "Solid"), row("t1", 1, "time", 3, "Slow"));
    });
    expect(host.querySelector(".pj-running")?.textContent).toBe("8 / 10");
    expect(section("Time").textContent).toContain("Slow");
    expect(host.querySelector(".pj-nameread")?.textContent).toBe("Will");
  });

  it("says Not saved until a failed save goes through, and tries it again", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1&team=t1&slot=1");
    await mount();
    saveScore.mockRejectedValueOnce(new Error("Network down"));
    await click(section("Robustness").querySelector(".pj-opt.s4") as Element);
    expect(host.querySelector(".pj-save")?.textContent).toContain("Not saved");

    // Retry sends it again.
    const before = saveScore.mock.calls.length;
    await click(button("Retry"));
    expect(saveScore.mock.calls.length).toBe(before + 1);
    expect(saveScore).toHaveBeenLastCalledWith(expect.anything(), "rob", { score: 4, reason: "" });
    expect(host.querySelector(".pj-save")?.textContent).toBe("Saved");
  });

  it("stops Mark done with the real reason when something won't save", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1&team=t1&slot=1");
    await mount();
    for (const [cat, why] of [["Robustness", "Solid"], ["Time", "Fast"]] as const) {
      await click(section(cat).querySelector(".pj-opt.s5") as Element);
      const box = section(cat).querySelector("textarea") as HTMLTextAreaElement;
      await typeInto(box, why);
      await blur(box);
    }
    const real = saveScore.getMockImplementation()!;
    saveScore.mockImplementation(async () => {
      throw new Error("Network down");
    });
    try {
      await typeInto(section("Time").querySelector("textarea") as HTMLTextAreaElement, "Fast, twice");
      await click(button(/Mark done/));
      expect(setGradingDone).not.toHaveBeenCalled();
      expect(String(onError.mock.calls.at(-1)?.[0])).toContain("Network down");
    } finally {
      saveScore.mockImplementation(real);
    }
  });

  it("sends a TF who opens the editor's link to the project instead", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1&edit=edit");
    await mount(facultyData(true, false));
    expect(window.location.search).toBe("?s=projects&proj=p1");
    expect(host.querySelector(".pj-teamrow")).toBeTruthy();
    expect(buttons().some((b) => b.textContent?.trim() === "Edit")).toBe(false);
  });
});
