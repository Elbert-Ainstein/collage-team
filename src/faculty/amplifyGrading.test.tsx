// Grading a half nobody hands in.
//
// The grader lists whoever handed something in, which is the right rule
// everywhere work arrives — and no rule at all on an Amplify individual half,
// where the answers are on Amplify. Before this, that screen listed nobody:
// the marks existed, the check-in existed, and there was no way to record one.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity, ActivityType } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";

const openResultsFor = vi.fn(async () => 2);

vi.mock("@/checkins/data", () => ({ openResultsFor }));

vi.mock("./facultyData", () => ({
  addRubricItem: vi.fn(async () => undefined),
  clearMark: vi.fn(async () => undefined),
  ensureRubric: vi.fn(async () => []),
  listMarks: vi.fn(async () => []),
  releaseMany: vi.fn(async () => ({ released: 0, failed: 0 })),
  releaseMark: vi.fn(async () => undefined),
  setFeedback: vi.fn(async () => undefined),
  setMark: vi.fn(async () => undefined),
  updateRubricItem: vi.fn(async () => undefined),
}));

vi.mock("./SubmissionPages", () => ({ SubmissionPages: () => <div>PAGES VIEWER</div> }));
vi.mock("./ActivityTeamPanel", () => ({ ActivityTeamPanel: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { GradingScreen } = await import("./GradingScreen");

const activity = (type: ActivityType): Activity =>
  ({
    id: "act1",
    course_id: "c1",
    week: 3,
    title: "Week 3",
    type,
    stage: 2,
    position: 3,
    resubmit_mode: "team",
  }) as Activity;

const student = (id: string, name: string) =>
  ({ id, name, avatar_tint: null, course_id: "c1", position: 0, email: null }) as never;

function facultyData(type: ActivityType, results: unknown[] = []): FacultyData {
  return {
    course: { id: "c1", name: "AP 50", code: "AP50" },
    weeks: [],
    roster: [student("s1", "Ada Lovelace"), student("s2", "Wei Ng")],
    activities: [activity(type)],
    questions: [],
    checkIns: [
      { id: "ci-i", activity_id: "act1", kind: "individual", label: "Individual" },
      { id: "ci-t", activity_id: "act1", kind: "team", label: "Team" },
    ],
    results,
    teams: [],
    tfs: [],
    stats: new Map(),
    can: {
      isOwner: true,
      author: true,
      grade: true,
      runCheckIns: true,
      manageRoster: true,
      manageTFs: true,
    },
  } as unknown as FacultyData;
}

let host: HTMLDivElement;
let root: Root;

async function mount(data: FacultyData): Promise<void> {
  await act(async () => {
    root.render(
      <GradingScreen
        data={data}
        activity={data.activities[0]}
        onBack={() => undefined}
        onOpenCheckIn={() => undefined}
        onChanged={() => undefined}
        onError={() => undefined}
      />,
    );
  });
}

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

describe("an Amplify individual half", () => {
  it("opens a row for everyone, so there is somewhere to put a mark", async () => {
    await mount(facultyData("amplify"));
    expect(openResultsFor).toHaveBeenCalledWith("ci-i", ["s1", "s2"]);
  });

  it("grades the whole class, not only the people who handed in", async () => {
    // The rows openResultsFor just made: empty, and nobody has handed in.
    const rows = [
      { id: "r1", check_in_id: "ci-i", student_id: "s1", team_id: null, status: "none" },
      { id: "r2", check_in_id: "ci-i", student_id: "s2", team_id: null, status: "none" },
    ];
    await mount(facultyData("amplify", rows));

    expect(host.textContent).not.toContain("Nothing to grade yet");
    expect(host.textContent).toContain("Ada Lovelace");
  });

  it("says where the answers are instead of showing an empty pages viewer", async () => {
    const rows = [
      { id: "r1", check_in_id: "ci-i", student_id: "s1", team_id: null, status: "none" },
    ];
    await mount(facultyData("amplify", rows));

    expect(host.textContent).toContain("Answered in Amplify");
    expect(host.textContent).toContain("open their Amplify report alongside");
    expect(host.textContent).not.toContain("PAGES VIEWER");
  });
});

describe("every other type is untouched", () => {
  it("a Challenge still lists only what was handed in", async () => {
    const rows = [
      { id: "r1", check_in_id: "ci-i", student_id: "s1", team_id: null, status: "none" },
      { id: "r2", check_in_id: "ci-i", student_id: "s2", team_id: null, status: "submitted" },
    ];
    await mount(facultyData("challenge", rows));

    expect(openResultsFor).not.toHaveBeenCalled();
    // Wei handed in; Ada's empty row is not a thing to mark.
    expect(host.textContent).toContain("Wei Ng");
    expect(host.textContent).toContain("PAGES VIEWER");
  });
});
