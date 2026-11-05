// The instructor's question-by-question view for select multiple (0056):
// every option on its own row, as for multiple choice — before anyone has
// answered, and with a bar per option counting who ticked it once they have.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { buildLiveModel } from "@/live/model";
import type { LiveResponse, LiveSnapshot } from "@/live/types";

vi.mock("@/live/figure", () => ({ Figure: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { QuestionsView, StudentQuestion } = await import("./LiveViews");

const student = (id: string, name: string) => ({ id, name, avatar_tint: null }) as unknown as Student;
const PEOPLE = [student("s1", "Ana Lee"), student("s2", "Bo Ng"), student("s3", "Cy Oh")];
const TEAM = { id: "t1", name: "Team Helix", members: PEOPLE } as unknown as TeamWithMembers;

const answer = (student_id: string, a: string): LiveResponse => ({
  question_id: "q1",
  activity_id: "a",
  student_id,
  answer: a,
  correct: null,
  updated_at: "",
});

const model = (responses: LiveResponse[]) =>
  buildLiveModel({
    snapshot: {
      state: { activity_id: "a", phase: "individual", lock_rule: "any", show_answers: "close", grading: "both", team_started_at: null, closed_at: null, scored_at: null, updated_at: "" },
      questions: [{ id: "q1", activity_id: "a", position: 0, kind: "multi", stem: "Which are true?", options: ["w", "x", "y"], unit: null, figure_path: null, created_at: "" }],
      keys: [{ question_id: "q1", activity_id: "a", correct_option: null, correct_options: [0, 2], answer: null, tolerance: null, accept: [] }],
      responses,
      votes: [],
      locks: [],
      attempts: [],
      teamSetup: true,
      leaderVotes: [],
      setups: [],
      absences: [],
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
const rows = () => [...host.querySelectorAll<HTMLElement>(".lq-opt")];
const row = (letter: string) => rows().find((r) => r.querySelector(".lq-optl")?.textContent === letter)!;

describe("Questions, select multiple", () => {
  it("lists every option before anyone has answered", () => {
    render(<QuestionsView m={model([])} reveal={false} />);
    expect(rows().map((r) => r.querySelector(".lq-opttext")?.textContent)).toEqual(["w", "x", "y"]);
    expect(host.textContent).not.toContain("No answers yet");
    expect(host.textContent).toContain("each bar counts who ticked that option");
  });

  it("counts, per option, who ticked it — and the whole-answer rate stays all or nothing", () => {
    // Ana AC (right), Bo A, Cy ABC.
    render(<QuestionsView m={model([answer("s1", "AC"), answer("s2", "A"), answer("s3", "ABC")])} reveal />);
    const count = (letter: string) => row(letter).querySelector(".lq-bar b")?.textContent;
    expect(count("A")).toBe("3");
    expect(count("B")).toBe("1");
    expect(count("C")).toBe("2");
    expect(host.textContent).toContain("3/3");
    expect(host.textContent).toContain("33% right");
    // The key's options are the green ones, not the whole-set match.
    expect(row("A").className).toContain("right");
    expect(row("B").className).not.toContain("right");
    expect(row("C").className).toContain("right");
    // Nothing is filed under "Other answers": every set lands on its options.
    expect(host.textContent).not.toContain("Other answers");
  });

  it("says nothing about right or wrong with answers hidden", () => {
    render(<QuestionsView m={model([answer("s1", "AC")])} reveal={false} />);
    expect(rows().some((r) => r.className.includes("right"))).toBe(false);
  });
});

describe("one student's select-multiple question", () => {
  it("marks each option they ticked, and counts the class per option", () => {
    render(
      <StudentQuestion
        m={model([answer("s1", "AC"), answer("s2", "A")])}
        studentId="s1"
        q={0}
        reveal
        onBack={() => {}}
        onQuestion={() => {}}
        onStudent={() => {}}
      />,
    );
    const opts = [...host.querySelectorAll<HTMLElement>(".lq-sqopt")];
    const opt = (letter: string) => opts.find((o) => o.querySelector(".lq-optl")?.textContent === letter)!;
    expect(opt("A").className).toContain("own");
    expect(opt("B").className).not.toContain("own");
    expect(opt("C").className).toContain("own");
    expect(opt("A").querySelector(".lq-sqclass")?.textContent).toBe("2 of 2");
    expect(opt("C").querySelector(".lq-sqclass")?.textContent).toBe("1 of 2");
    expect(opt("A").querySelector(".lq-optl")?.className).toContain("right");
    expect(opt("B").querySelector(".lq-optl")?.className).not.toContain("right");
  });
});
