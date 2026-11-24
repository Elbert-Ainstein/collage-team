// The Projects tab inside the whole faculty app: its own pages share the URL
// and the browser history with FacultyApp's, and the two must not trip over
// each other. Back inside Projects once left FacultyApp thinking a Back was
// still pending, so the next tab pressed never reached the URL and a reload
// went back to Projects.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const course = {
  id: "c1",
  owner_id: "owner",
  name: "AP 50",
  code: "AP50",
  term: "Fall",
  live_week: null,
  tf_can_grade: true,
  tf_can_checkin: true,
  created_at: "",
};
const project = {
  id: "p1",
  course_id: "c1",
  title: "Project fair",
  graders_per_team: 2,
  team_set_id: null,
  position: 0,
  created_at: "",
  updated_at: "",
};
const category = { id: "k1", project_id: "p1", position: 0, name: "Robustness", levels: ["", "", "", "", ""], created_at: "" };

vi.mock("@/lib/supabaseClient", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isSupabaseConfigured: true,
}));
vi.mock("@/checkins/data", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ensureSessions: vi.fn(async () => [course]),
  listCourses: vi.fn(async () => [course]),
  listStudents: vi.fn(async () => []),
  listActivities: vi.fn(async () => []),
  listTeamSets: vi.fn(async () => []),
  listCheckIns: vi.fn(async () => []),
  listResults: vi.fn(async () => []),
  listTeams: vi.fn(async () => []),
}));
vi.mock("@/checkins/rosters", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listRosters: vi.fn(async () => []),
  listTeamsByIds: vi.fn(async () => []),
}));
vi.mock("@/faculty/facultyData", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  myTFCourses: vi.fn(async () => []),
  listWeeks: vi.fn(async () => []),
  listTFs: vi.fn(async () => []),
  canWriteRubric: vi.fn(async () => true),
  getInstructorName: vi.fn(async () => "Kelly"),
  listQuestionsFor: vi.fn(async () => []),
}));
vi.mock("@/projects/data", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listProjects: vi.fn(async () => ({ projects: [project], categoryCount: new Map([["p1", 1]]), gradings: [] })),
  loadProject: vi.fn(async () => ({ project, categories: [category], gradings: [], scores: [] })),
  watchProject: vi.fn(() => () => undefined),
}));
vi.mock("@/faculty/ActivitiesScreen", () => ({ ActivitiesScreen: () => <div>ACTIVITIES</div> }));
vi.mock("@/faculty/TeamsScreen", () => ({ TeamsScreen: () => <div>TEAMS</div> }));
vi.mock("@/faculty/assistant/AssistantPanel", () => ({ AssistantPanel: () => null, SHEET_QUERY: "(max-width: 1px)" }));
vi.mock("@/faculty/assistant/AssistantLauncher", () => ({ AssistantLauncher: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { FacultyApp } = await import("../FacultyApp");

let host: HTMLDivElement;
let root: Root;
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
const click = async (el: Element | undefined) => {
  if (!el) throw new Error("nothing to click");
  await act(async () => (el as HTMLElement).click());
  await settle();
};
const navBtn = (label: string) => [...host.querySelectorAll(".fv-navbtn")].find((b) => b.textContent?.includes(label));
const button = (t: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(t));
const back = async () => {
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 30));
  });
  await settle();
};
const query = () => new URLSearchParams(window.location.search);

beforeEach(async () => {
  window.history.replaceState(null, "", "/ck");
  window.sessionStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<FacultyApp uid="owner" mode="owner" />));
  await settle();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Projects in the faculty app", () => {
  it("sits right after Activities in the sidebar", () => {
    const labels = [...host.querySelectorAll(".fv-navbtn")].map((b) => b.textContent?.trim());
    expect(labels.slice(0, 2)).toEqual(["Activities", "Projects"]);
  });

  it("lets the next tab reach the URL after Back inside Projects", async () => {
    await click(navBtn("Projects"));
    await click(button("Project fair"));
    expect(query().get("proj")).toBe("p1");
    await back();
    expect(query().get("s")).toBe("projects");
    expect(query().get("proj")).toBeNull();

    await click(navBtn("Teams"));
    expect(host.textContent).toContain("TEAMS");
    expect(query().get("s")).toBe("teams");
    expect(JSON.parse(window.sessionStorage.getItem("fv-where") ?? "{}").screen).toBe("teams");
  });

  it("drops its own keys from the URL on every other tab", async () => {
    await click(navBtn("Projects"));
    await click(button("Project fair"));
    await click(navBtn("Activities"));
    expect(query().get("proj")).toBeNull();
    expect(query().get("s")).toBeNull();
  });

  it("goes back to the list when its tab is pressed on a project, and adds nothing when already there", async () => {
    await click(navBtn("Projects"));
    await click(button("Project fair"));
    await click(navBtn("Projects"));
    expect(query().get("proj")).toBeNull();
    expect(button("New project")).toBeTruthy();

    const before = window.history.length;
    await click(navBtn("Projects"));
    expect(window.history.length).toBe(before);
  });

  it("leaves the editor by going back, not by stacking the project page again", async () => {
    await click(navBtn("Projects"));
    await click(button("Project fair"));
    await click(button("Edit"));
    expect(query().get("edit")).toBe("edit");

    await click(button("Cancel"));
    // Cancel goes back, and popping is asynchronous in the browser.
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    await settle();
    expect(query().get("edit")).toBeNull();
    expect(query().get("proj")).toBe("p1");

    // One more Back is the list — not the editor again, which it was when
    // Cancel pushed a second copy of the project page.
    await back();
    expect(query().get("proj")).toBeNull();
    expect(query().get("edit")).toBeNull();
    expect(button("New project")).toBeTruthy();
  });
});
