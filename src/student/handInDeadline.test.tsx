// A student's hand-in closes at the individual deadline (0044), and opens again
// only for a student the instructor reopened it for.
//
// The database refuses the write either way; what is pinned here is that the
// screens say so first. A Submit button that is always refused is a student at
// 9:01 being told they have no permission, and an Unsubmit button after the
// deadline is the worse one: it takes on-time work back with no way to hand it
// in again.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment, Enrolment } from "@/checkins/studentData";
import type { Activity, CheckIn, CheckInResult } from "@/checkins/types";

const ensureMyResult = vi.fn(async () => "r-new");
const findMyResult = vi.fn(async () => null as string | null);
const hasFile = { value: false };

vi.mock("@/checkins/studentData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureMyResult,
  findMyResult,
  listMyQuestions: vi.fn(async () => []),
  ensureTeamResult: vi.fn(async () => null),
}));
vi.mock("@/checkins/submissions", () => ({
  getSubmissionFile: vi.fn(async () => (hasFile.value ? { id: "f1", page_count: 2 } : null)),
  listSubmissionPages: vi.fn(async () => []),
  markSubmitted: vi.fn(async () => undefined),
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
// The PDF hand-in has its own tests. Here it only has to report what it was told.
vi.mock("./PdfSubmit", () => ({
  PdfSubmit: (p: { locked: boolean; lockedWhy?: string; resultId: string | null }) => (
    <div data-testid="pdf" data-locked={String(p.locked)} data-result={p.resultId ?? ""}>
      {p.lockedWhy}
    </div>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { Assignments } = await import("./Assignments");
const { SubmitScreen } = await import("./SubmitScreen");

const DAY = 24 * 60 * 60 * 1000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

function assignment(opts: {
  due: string | null;
  result?: Partial<CheckInResult> | null;
  reopened?: boolean;
}): Assignment {
  const activity = {
    id: "a1",
    course_id: "c1",
    week: 5,
    title: "Week 5 combo",
    type: "combo",
    stage: 1,
    due_at: opts.due,
    individual_due_at: null,
    team_due_at: null,
    files: [],
    position: 1,
  } as unknown as Activity;
  const myResult = opts.result
    ? ({ id: "r1", check_in_id: "ci1", student_id: "s1", ...opts.result } as CheckInResult)
    : null;
  const inNow = myResult?.status === "submitted";
  return {
    activity,
    indivCheckIn: { id: "ci1", activity_id: "a1", kind: "individual" } as CheckIn,
    teamCheckIn: null,
    myResult,
    teamResult: null,
    status: inNow ? "Turned in" : "Not started",
    grade: "—",
    teamGrade: "—",
    submitted: myResult?.submitted_at ?? null,
    reopened: opts.reopened ?? false,
  };
}

const enrolment = {
  student: { id: "s1", name: "Ada Lovelace" },
  course: { id: "c1", name: "AP 50" },
  team: null,
  teammates: [],
} as unknown as Enrolment;

let host: HTMLDivElement;
let root: Root;

async function showDetail(a: Assignment): Promise<void> {
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

async function showSubmit(a: Assignment): Promise<void> {
  await act(async () => {
    root.render(
      <SubmitScreen
        assignment={a}
        enrolment={enrolment}
        onBack={() => undefined}
        onChanged={() => undefined}
      />,
    );
  });
}

const button = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  ensureMyResult.mockClear();
  findMyResult.mockClear();
  hasFile.value = false;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the assignment page", () => {
  it("offers the hand-in before the deadline", async () => {
    await showDetail(assignment({ due: iso(DAY) }));
    expect(button("Submit assignment")?.disabled).toBe(false);
  });

  it("says Closed, and offers nothing, once the deadline passes with nothing in", async () => {
    await showDetail(assignment({ due: iso(-DAY) }));

    expect(button("Submit assignment")).toBeFalsy();
    expect(button("Closed")?.disabled).toBe(true);
    expect(host.textContent).toContain("ask your instructor if you need it reopened");
    expect(host.textContent).toContain("Nothing was handed in before the deadline");
  });

  // An open draft row is not a hand-in. Opening the screen made it.
  it("treats a draft as nothing handed in", async () => {
    await showDetail(assignment({ due: iso(-DAY), result: { status: "draft" } }));
    expect(button("Closed")?.disabled).toBe(true);
  });

  it("still lets a student look at what they handed in on time, but not replace it", async () => {
    await showDetail(
      assignment({
        due: iso(-DAY),
        result: { status: "submitted", submitted_at: iso(-2 * DAY) },
      }),
    );

    expect(button("View submission")?.disabled).toBe(false);
    expect(host.textContent).not.toContain("Open your work to replace it");
  });

  it("opens again for a student it was reopened for, and says it will be late", async () => {
    await showDetail(assignment({ due: iso(-DAY), reopened: true }));

    expect(button("Submit assignment")?.disabled).toBe(false);
    expect(host.textContent).toContain("marked late");
  });
});

describe("the hand-in screen", () => {
  it("makes a draft row and offers Submit while the hand-in is open", async () => {
    hasFile.value = true;
    await showSubmit(assignment({ due: iso(DAY) }));

    expect(ensureMyResult).toHaveBeenCalled();
    expect(button("Submit")?.disabled).toBe(false);
  });

  it("offers no Submit once closed, and never makes a draft row to hold one", async () => {
    await showSubmit(assignment({ due: iso(-DAY) }));

    expect(button("Submit")).toBeFalsy();
    expect(host.textContent).toContain("Closed");
    expect(host.textContent).toContain("ask your instructor to reopen it");
    // 0044 refuses the insert; asking would only put an error on screen.
    expect(ensureMyResult).not.toHaveBeenCalled();
    expect(findMyResult).toHaveBeenCalled();
  });

  it("offers no Unsubmit on work handed in before the deadline", async () => {
    hasFile.value = true;
    await showSubmit(
      assignment({
        due: iso(-DAY),
        result: { status: "submitted", submitted_at: iso(-2 * DAY) },
      }),
    );

    expect(button("Unsubmit")).toBeFalsy();
    expect(host.textContent).toContain("Turned in");
    expect(host.textContent).toContain("can no longer be changed");
    const pdf = host.querySelector("[data-testid=pdf]");
    expect(pdf?.getAttribute("data-locked")).toBe("true");
    expect(pdf?.textContent).toContain("closed at the deadline");
  });

  it("lets a reopened student hand in, and tells them it will be marked late", async () => {
    hasFile.value = true;
    await showSubmit(assignment({ due: iso(-DAY), reopened: true }));

    expect(button("Submit")?.disabled).toBe(false);
    expect(host.textContent).toContain("reopened this for you");
    expect(host.textContent).toContain("marked late");
    expect(host.querySelector("[data-testid=pdf]")?.getAttribute("data-locked")).toBe("false");
  });

  // The last-minute upload: the screen was opened before the deadline and is
  // still open after it. Submit has to go when the hand-in closes, not at the
  // next refetch.
  it("takes Submit away the moment the deadline passes", async () => {
    hasFile.value = true;
    await showSubmit(assignment({ due: iso(60) }));
    expect(button("Submit")?.disabled).toBe(false);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    expect(button("Submit")).toBeFalsy();
    expect(host.textContent).toContain("Closed");
  });
});
