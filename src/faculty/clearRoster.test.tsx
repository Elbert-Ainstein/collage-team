// Emptying the whole roster, asked twice.
//
// This is the one control on Roster & teams that can destroy a term of work in
// a single press, and it sits on the same row as the button an instructor
// presses every week. What is pinned here is that neither press alone does
// anything: the first opens the question, the second opens a plainer one, and
// only the third — inside the second dialog — writes.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, Student } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";

const clearRoster = vi.fn(async () => ({ students: 3, work: 12, files: 4 }));
const previewRosterRemoval = vi.fn(async () => ({ students: 3, work: 12, files: 4 }));

vi.mock("@/checkins/purge", () => ({
  clearRoster,
  previewRosterRemoval,
  removeStudentWithStorage: vi.fn(async () => undefined),
}));

vi.mock("@/checkins/data", () => ({
  addStudents: vi.fn(async () => []),
  removeStudent: vi.fn(async () => undefined),
  setStudentEmail: vi.fn(async () => undefined),
  setStudentName: vi.fn(async () => undefined),
}));

vi.mock("@/faculty/facultyData", () => ({
  countWorkForStudent: vi.fn(async () => 0),
  courseMemberRoles: vi.fn(async () => new Map<string, string>()),
  setMemberRole: vi.fn(async () => undefined),
}));

vi.mock("@/checkins/tutorial", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTutorialSheet: vi.fn(async () => ({ marks: [], absences: [] })),
}));

vi.mock("@/checkins/TeamsPillar", () => ({ TeamsPillar: () => null }));
vi.mock("./FacultyApp", () => ({ FacultyError: () => null, capabilitiesFor: () => undefined }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TeamsScreen } = await import("./TeamsScreen");

const course: Course = {
  id: "c1",
  owner_id: "owner",
  name: "AP 50",
  code: "AP50",
  term: "Fall",
  live_week: null,
  tf_can_grade: true,
  tf_can_checkin: false,
  created_at: "",
};

const student = (id: string, name: string): Student => ({
  id,
  user_id: null,
  course_id: "c1",
  name,
  email: `${name.split(" ")[0].toLowerCase()}@x.edu`,
  avatar_tint: null,
  position: Number(id.slice(1)),
  created_at: "",
});

const ROSTER = [student("s1", "Ada Lovelace"), student("s2", "Wei Ng"), student("s3", "Zoe Brennan")];

function facultyData(over: Partial<FacultyData> = {}): FacultyData {
  return {
    course,
    weeks: [],
    roster: ROSTER,
    activities: [],
    questions: [],
    checkIns: [],
    results: [],
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
    ...over,
  } as FacultyData;
}

let host: HTMLDivElement;
let root: Root;
let changed: number;

async function mount(data: FacultyData = facultyData()): Promise<void> {
  await act(async () => {
    root.render(
      <TeamsScreen data={data} onChanged={() => (changed += 1)} onError={() => undefined} />,
    );
  });
}

const buttonSaying = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

const dialog = (): Element | null => host.querySelector('[role="alertdialog"]');

async function press(text: string): Promise<void> {
  const b = buttonSaying(text);
  if (!b) throw new Error(`no button saying "${text}"`);
  await act(async () => b.click());
}

beforeEach(() => {
  vi.clearAllMocks();
  changed = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the two confirmations", () => {
  it("the first press only asks, and says what it would cost", async () => {
    await mount();
    await press("Clear roster");

    expect(dialog()).toBeTruthy();
    expect(host.textContent).toContain("Remove all 3 students from the roster?");
    // Counted, not guessed: the numbers come from the database before asking.
    expect(previewRosterRemoval).toHaveBeenCalledWith("c1");
    expect(host.textContent).toContain("12 marks and submissions");
    expect(host.textContent).toContain("4 recordings and PDFs");
    expect(clearRoster).not.toHaveBeenCalled();
  });

  it("says what survives, so clearing is not read as starting the term again", async () => {
    await mount();
    await press("Clear roster");
    expect(host.textContent).toContain("The teams stay, empty");
    expect(host.textContent).toContain("class code still works");
  });

  it("the second press asks again, and still writes nothing", async () => {
    await mount();
    await press("Clear roster");
    await press("Remove all 3 students");

    expect(host.textContent).toContain("Sure? This cannot be undone.");
    expect(clearRoster).not.toHaveBeenCalled();
  });

  it("only the third press empties it", async () => {
    await mount();
    await press("Clear roster");
    await press("Remove all 3 students");
    await press("Yes, clear the roster");

    expect(clearRoster).toHaveBeenCalledTimes(1);
    expect(clearRoster).toHaveBeenCalledWith("c1");
    expect(dialog()).toBeFalsy();
    expect(changed).toBe(1);
    expect(host.textContent).toContain("Removed 3 students from the roster");
  });

  it("cancelling the second question leaves the roster alone", async () => {
    await mount();
    await press("Clear roster");
    await press("Remove all 3 students");
    await press("Cancel");

    expect(dialog()).toBeFalsy();
    expect(clearRoster).not.toHaveBeenCalled();
  });

  it("cancelling the first question leaves the roster alone", async () => {
    await mount();
    await press("Clear roster");
    await press("Cancel");

    expect(dialog()).toBeFalsy();
    expect(clearRoster).not.toHaveBeenCalled();
  });
});

describe("who sees it at all", () => {
  it("is not offered to a teaching fellow", async () => {
    await mount(
      facultyData({
        can: {
          isOwner: false,
          author: false,
          grade: true, rubric: true,
          runCheckIns: true,
          manageRoster: false,
          manageTFs: false,
        },
      }),
    );
    expect(buttonSaying("Clear roster")).toBeFalsy();
  });

  it("is not offered when there is nobody to remove", async () => {
    await mount(facultyData({ roster: [] }));
    expect(buttonSaying("Clear roster")).toBeFalsy();
  });

  it("says the count failed rather than spinning on “counting…”", async () => {
    previewRosterRemoval.mockRejectedValueOnce(new Error("network"));
    await mount();
    await press("Clear roster");

    expect(host.textContent).toContain("could not be counted");
    expect(host.textContent).not.toContain("Counting what would go");
    // Still answerable: the question is about the students, not the count.
    expect(buttonSaying("Remove all 3 students")).toBeTruthy();
  });

  it("closes and reports when the clear itself fails, since the banner is behind it", async () => {
    clearRoster.mockRejectedValueOnce(new Error("permission denied"));
    await mount();
    await press("Clear roster");
    await press("Remove all 3 students");
    await press("Yes, clear the roster");

    expect(dialog()).toBeFalsy();
    expect(host.textContent).toContain("not fully cleared");
    expect(host.textContent).toContain("clearing again is safe");
  });

  it("says so plainly when the class has handed nothing in", async () => {
    previewRosterRemoval.mockResolvedValueOnce({ students: 3, work: 0, files: 0 });
    await mount();
    await press("Clear roster");
    expect(host.textContent).toContain("Nothing has been handed in yet");
  });
});
