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

const listProjects = vi.fn(
  async (): Promise<ProjectsOverview> => ({
    projects: [snapshot.project],
    categoryCount: new Map([["p1", snapshot.categories.length]]),
    gradings: snapshot.gradings,
  }),
);
const loadProject = vi.fn(async (): Promise<ProjectSnapshot | null> => snapshot);
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
    watchProject: vi.fn(() => () => undefined),
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

function facultyData(grade = true): FacultyData {
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
      isOwner: true,
      author: true,
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
    expect(host.textContent).toContain("0 of 2 teams fully graded");

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
    expect(rows[0].querySelector(".pj-teamscore")?.textContent).toBe("— / 10");
  });

  it("opens a team's graders, then a grader's sheet with the rubric", async () => {
    window.history.replaceState(null, "", "/ck?s=projects&proj=p1");
    await mount();
    await click(host.querySelector(".pj-teamopen") as Element);
    expect(window.location.search).toBe("?s=projects&proj=p1&team=t1");
    expect(host.textContent).toContain("Grader 1");
    expect(host.textContent).toContain("Grader 2");
    expect(host.textContent).toContain("Not started");

    await click(button(/Grader 1/));
    expect(window.location.search).toBe("?s=projects&proj=p1&team=t1&slot=1");
    expect(host.querySelector("h1")?.textContent).toBe("Team 1 — Grader 1");

    // Every category, 5 down to 1, each with what it means.
    const rob = section("Robustness");
    expect([...rob.querySelectorAll(".pj-opt")].map((o) => o.textContent)).toEqual([
      "5Robust 5",
      "4Robust 4",
      "3Robust 3",
      "2Robust 2",
      "1Robust 1",
    ]);
    expect(section("Time")).toBeTruthy();
    // The name is theirs, filled in, and not saved just for looking.
    expect((host.querySelector(".pj-namein") as HTMLInputElement).value).toBe("Will");
    expect(saveGraderName).not.toHaveBeenCalled();
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
    await click(button(/Mark done/));
    expect(setGradingDone).not.toHaveBeenCalled();
    expect(section("Robustness").textContent).toContain("Say why before marking it done.");
    expect(section("Time").textContent).toContain("Pick a score.");

    // Reasons other graders gave in this category are offered; one press uses it.
    const chip = section("Robustness").querySelector(".pj-reuse") as HTMLElement;
    expect(chip.textContent).toContain("7 parts, cool pulley that actuates");
    expect(chip.className).toContain("mine");
    await click(chip);
    expect(saveScore).toHaveBeenLastCalledWith(expect.anything(), "rob", {
      score: 4,
      reason: "7 parts, cool pulley that actuates",
    });

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
    expect(button("Reopen to edit")).toBeTruthy();
    expect((section("Time").querySelector(".pj-opt.s5") as HTMLButtonElement).disabled).toBe(true);

    // And on the way back the team list says so.
    await click(host.querySelector(".fv-back") as Element);
    await click(host.querySelector(".fv-back") as Element);
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
});
