// What a student sees on an Amplify's individual half.
//
// Nothing to hand in, because the answers are on Amplify — so there is no
// upload button, and the row does not sit in amber saying Late for a deadline
// that was never theirs to meet. The grade still lands here when it is
// released, which is the half of this that must not be lost while removing the
// other half.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment, Enrolment } from "@/checkins/studentData";
import type { Activity, ActivityType, CheckIn, CheckInResult } from "@/checkins/types";

vi.mock("@/checkins/studentData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listMyQuestions: vi.fn(async () => []),
  ensureTeamResult: vi.fn(async () => null),
}));
vi.mock("@/checkins/tutorial", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMyMarks: vi.fn(async () => []),
}));
vi.mock("@/checkins/resources", () => ({
  listTeamResources: vi.fn(async () => []),
  resourceUrls: vi.fn(async () => ({ urls: {}, signedAt: 0 })),
}));
vi.mock("./Recorder", () => ({ Recorder: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { Assignments } = await import("./Assignments");

const activity = (type: ActivityType): Activity =>
  ({
    id: `a-${type}`,
    course_id: "c1",
    week: 3,
    title: `Week 3 ${type}`,
    type,
    stage: 2, // past its deadline: what used to make an empty row "Late"
    position: 3,
    resubmit_mode: "team",
  }) as Activity;

const checkIn = (kind: "individual" | "team"): CheckIn =>
  ({ id: `ci-${kind}`, activity_id: "a-amplify", kind, label: kind }) as CheckIn;

function assignment(type: ActivityType, myResult: CheckInResult | null = null): Assignment {
  return {
    activity: activity(type),
    indivCheckIn: checkIn("individual"),
    teamCheckIn: checkIn("team"),
    myResult,
    teamResult: null,
    status: type === "amplify" ? "Answered elsewhere" : "Late",
    grade: myResult?.status === "scored" ? "8/10" : "—",
    teamGrade: "—",
    submitted: null,
  } as Assignment;
}

const enrolment = {
  student: { id: "s1", name: "Ada Lovelace" },
  course: { id: "c1", name: "AP 50" },
  team: { id: "t1", name: "Team 1" },
  teammates: [],
} as unknown as Enrolment;

let host: HTMLDivElement;
let root: Root;

async function show(a: Assignment): Promise<void> {
  await act(async () => {
    root.render(
      <Assignments
        enrolment={enrolment}
        assignments={[a]}
        selId={a.activity.id}
        tab="indiv"
        onSelect={() => undefined}
        onBack={() => undefined}
        onTabChange={() => undefined}
        onOpenWork={() => undefined}
        onOpenSubmit={() => undefined}
        onOpenResources={() => undefined}
      />,
    );
  });
}

const buttonSaying = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("an Amplify's individual half", () => {
  it("offers no hand-in, and says where the answers go instead", async () => {
    await show(assignment("amplify"));

    expect(buttonSaying("Submit assignment")).toBeFalsy();
    expect(host.textContent).toContain("You answer these questions in");
    expect(host.textContent).toContain("Amplify.");
    // The instructor's own words, including what a student has to do there.
    expect(host.textContent).toContain("effort on every slide");
    expect(host.textContent).toContain("Hand in");
  });

  it("names the platform rather than saying 'elsewhere'", async () => {
    await show(assignment("amplify"));
    expect(host.textContent).toContain("Answered in Amplify");
    expect(host.textContent).not.toContain("Answered elsewhere");
  });

  it("does not tell the student nothing was submitted", async () => {
    await show(assignment("amplify"));
    expect(host.textContent).not.toContain("Nothing submitted yet");
  });

  it("still shows the grade once it is released", async () => {
    const scored = { id: "r1", status: "scored" } as CheckInResult;
    const a = assignment("amplify", scored);
    await show({ ...a, status: "Graded", grade: "8/10" } as Assignment);

    expect(host.textContent).toContain("8/10");
    expect(buttonSaying("Submit assignment")).toBeFalsy();
  });

  it("says nothing about a hand-in that never happened here", async () => {
    // The stamp used to fall back to the row's updated_at, so a graded Amplify
    // read "Submitted Tue Sep 8, 3:25pm" — the moment the INSTRUCTOR marked it.
    const scored = { id: "r1", status: "scored", updated_at: "2026-09-08T15:25:00Z" };
    const a = assignment("amplify", scored as CheckInResult);
    await show({
      ...a,
      status: "Graded",
      grade: "Complete",
      submitted: "2026-09-08T15:25:00Z",
    } as Assignment);

    expect(host.textContent).not.toContain("Submitted");
    expect(host.textContent).not.toContain("Handed in");
    expect(host.textContent).not.toContain("Open your work to replace it");
    expect(host.textContent).not.toContain("plus the team discussion");
    // The grade itself still stands.
    expect(host.textContent).toContain("Complete");
  });
});

describe("every other type is untouched", () => {
  it("a Challenge still hands in here", async () => {
    await show(assignment("challenge"));

    expect(buttonSaying("Submit assignment")).toBeTruthy();
    expect(host.textContent).not.toContain("effort on every slide");
  });

  it("a Challenge keeps the lines that are true of it", async () => {
    const scored = { id: "r1", status: "scored" } as CheckInResult;
    const a = assignment("challenge", scored);
    await show({
      ...a,
      status: "Graded",
      grade: "8/10",
      submitted: "2026-09-08T15:25:00Z",
    } as Assignment);

    // Deleting these for Amplify must not delete them where a hand-in is real.
    expect(host.textContent).toContain("Submitted");
    expect(host.textContent).toContain("Open your work to replace it");
    expect(host.textContent).toContain("plus the team discussion");
  });
});
