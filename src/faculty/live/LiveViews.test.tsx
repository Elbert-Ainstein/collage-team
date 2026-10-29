// The instructor's views of a student marked absent for team time (0051): no
// points from it, and said so wherever their team score would be.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { buildLiveModel } from "@/live/model";
import type { LiveSnapshot } from "@/live/types";

vi.mock("@/live/figure", () => ({ Figure: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { StudentsView, StudentDetail, TeamDetail } = await import("./LiveViews");

const student = (id: string, name: string) => ({ id, name, avatar_tint: null }) as unknown as Student;
const PEOPLE = [student("s1", "Ana Lee"), student("s2", "Bo Ng")];
const TEAM = { id: "t1", name: "Team Helix", members: PEOPLE } as unknown as TeamWithMembers;

const m = buildLiveModel({
  snapshot: {
    state: { activity_id: "a", phase: "closed", lock_rule: "any", show_answers: "close", grading: "both", team_started_at: null, closed_at: null, scored_at: null, updated_at: "" },
    questions: [{ id: "q1", activity_id: "a", position: 0, kind: "mc", stem: "Which?", options: ["x", "y"], unit: null, figure_path: null, created_at: "" }],
    keys: [{ question_id: "q1", activity_id: "a", correct_option: 1, answer: null, tolerance: null, accept: [] }],
    responses: [],
    votes: [],
    locks: [{ question_id: "q1", activity_id: "a", team_id: "t1", answer: "B", correct: true, locked_by: "s1", locked_at: "" }],
    attempts: [],
    teamSetup: true,
    leaderVotes: [],
    setups: [],
    absences: [{ activity_id: "a", team_id: "t1", student_id: "s2", source: "roll" }],
    roster: [],
    explanations: [],
  } as LiveSnapshot,
  students: PEOPLE,
  teams: [TEAM],
  now: 0,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (el: React.ReactElement) => act(() => root.render(el));
const rowOf = (name: string) =>
  [...host.querySelectorAll<HTMLElement>('[role="row"]')].find((r) => r.textContent?.includes(name))!;

describe("Students", () => {
  it("scores someone marked absent 0 with their team, and says they were absent", () => {
    render(<StudentsView m={m} reveal onStudent={() => {}} />);
    expect(rowOf("Bo Ng").textContent).toContain("Absent");
    expect(rowOf("Bo Ng").querySelector(".lq-teamnum")?.textContent).toBe("0/1");
    expect(rowOf("Ana Lee").textContent).not.toContain("Absent");
    expect(rowOf("Ana Lee").querySelector(".lq-teamnum")?.textContent).toBe("1/1");
  });
});

describe("one student", () => {
  const detail = (id: string) =>
    render(<StudentDetail m={m} studentId={id} reveal backLabel="Students" onBack={() => {}} onTeam={() => {}} onQuestion={() => {}} />);

  it("shows 0 with the team for someone marked absent", () => {
    detail("s2");
    const stat = [...host.querySelectorAll(".lq-dstats > *")].find((el) => el.textContent?.includes("Team Helix"))!;
    expect(stat.textContent).toContain("Absent");
    expect(stat.textContent).toContain("0/1");
  });

  it("shows the team's score for someone who was there", () => {
    detail("s1");
    const stat = [...host.querySelectorAll(".lq-dstats > *")].find((el) => el.textContent?.includes("Team Helix"))!;
    expect(stat.textContent).not.toContain("Absent");
    expect(stat.textContent).toContain("1/1");
  });
});

describe("one team", () => {
  it("marks who was absent among its members", () => {
    render(<TeamDetail m={m} teamId="t1" reveal onBack={() => {}} onStudent={() => {}} />);
    const chips = [...host.querySelectorAll(".lq-memberchip")].map((c) => c.textContent);
    expect(chips.find((t) => t?.includes("Bo Ng"))).toContain("Absent");
    expect(chips.find((t) => t?.includes("Ana Lee"))).not.toContain("Absent");
  });
});
