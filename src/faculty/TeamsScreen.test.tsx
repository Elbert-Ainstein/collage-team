// A teaching fellow's address landing on a student row.
//
// Nothing about that state looks wrong on the screen that creates it, and the
// damage arrives later somewhere else. At sign-in the TF list wins — RoleRouter
// claims the TF row and returns "tf" in both role branches before it reaches
// claimStudentRows() (app/ck/page.tsx) — so whoever holds that address gets the
// teaching-fellow view of this course, and the student row is never claimed: it
// sits on a team, ungraded, with nothing able to hand in against it. The roster
// screen is the only place an instructor can see this, so all three parts of the
// guard — the badge, the refused save, the import warning — are pinned here.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, CourseTF, Student } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";

const setStudentEmail = vi.fn(async () => undefined);
const setStudentName = vi.fn(async () => undefined);
const addStudents = vi.fn(async () => []);

vi.mock("@/checkins/data", () => ({
  addStudents,
  removeStudent: vi.fn(async () => undefined),
  setStudentEmail,
  setStudentName,
}));

vi.mock("@/checkins/purge", () => ({
  deleteStudentStorage: vi.fn(async () => undefined),
}));

// courseMemberRoles reads a scoped function against Supabase; the roles it
// returns are a different row's concern, so it answers empty here.
vi.mock("@/faculty/facultyData", () => ({
  countWorkForStudent: vi.fn(async () => 0),
  courseMemberRoles: vi.fn(async () => new Map<string, string>()),
  setMemberRole: vi.fn(async () => undefined),
}));

// The team builder is the original app's component and is a whole screen of its
// own — reached from here, never rendered by these tests.
vi.mock("@/checkins/TeamsPillar", () => ({ TeamsPillar: () => null }));

vi.mock("./FacultyApp", () => ({
  FacultyError: () => null,
  capabilitiesFor: () => undefined,
}));

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

function student(id: string, name: string, email: string | null, userId?: string): Student {
  return {
    id,
    user_id: userId ?? null,
    course_id: "c1",
    name,
    email,
    avatar_tint: null,
    position: Number(id.slice(1)),
    created_at: "",
  };
}

function tf(id: string, name: string, email: string | null): CourseTF {
  return {
    id,
    course_id: "c1",
    name,
    email,
    avatar_tint: null,
    user_id: null,
    position: 0,
    created_at: "",
  };
}

/** Ian is on both rosters — the state that prompted the guard. Ellie is a TF
 *  only, so she is the address an instructor might type in or import next. */
const ROSTER: Student[] = [
  student("s1", "Caleb Han", "first144fruit8@gmail.com", "u1"),
  student("s2", "Rain Doe", null),
  student("s3", "Ian Wu", "ian@collage-ai.com"),
];
const TFS: CourseTF[] = [
  tf("t1", "Ian Wu", "ian@collage-ai.com"),
  tf("t2", "Ellie Wynkoop", "ellie@collage-ai.com"),
];

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
    tfs: TFS,
    instructor: null,
    stats: new Map(),
    can: {
      isOwner: true,
      author: true,
      grade: true, rubric: true, release: true,
      runCheckIns: true,
      manageRoster: true,
      manageTFs: true,
    },
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;

async function mount(data: FacultyData = facultyData()): Promise<void> {
  await act(async () => {
    root.render(<TeamsScreen data={data} onChanged={() => undefined} onError={() => undefined} />);
  });
}

/** React reads the value off the element's own property, so a plain assignment
 *  is invisible to it. This is the setter it watches. */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const emailFieldFor = (name: string): HTMLInputElement => {
  const el = host.querySelector<HTMLInputElement>(`input[aria-label="Email for ${name}"]`);
  if (!el) throw new Error(`no email field for ${name}`);
  return el;
};

const buttonsSaying = (text: string): HTMLButtonElement[] =>
  Array.from(host.querySelectorAll("button")).filter((b) => b.textContent?.trim() === text);

const badges = (text: string): Element[] =>
  Array.from(host.querySelectorAll(".fv-badge")).filter((b) => b.textContent?.trim() === text);

beforeEach(() => {
  setStudentEmail.mockClear();
  setStudentName.mockClear();
  addStudents.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("a TF's address on a student row", () => {
  it("marks the row that already has one", async () => {
    await mount();

    // The comparison is on render, so it does not matter which screen created
    // the overlap — including the TFs screen, which this guard never touches.
    expect(badges("also a TF")).toHaveLength(1);
    // The name is a field of its own now, so the row is identified by it.
    const row = badges("also a TF")[0].closest("div");
    expect(row?.querySelector('input[aria-label="Name for Ian Wu"]')).toBeTruthy();
  });

  it("says nothing when the two rosters do not overlap", async () => {
    await mount(facultyData({ tfs: [tf("t2", "Ellie Wynkoop", "ellie@collage-ai.com")] }));
    expect(badges("also a TF")).toHaveLength(0);
  });

  it("still marks it when the addresses differ only in case", async () => {
    // setStudentEmail stores a trimmed address, NOT a lowercased one, while
    // addTF lowercases — so the two rosters can hold the same address in
    // different cases, and claim_tf_rows() (0007) compares lower() on both
    // sides, so the TF claim fires anyway.
    await mount(
      facultyData({ roster: [student("s3", "Ian Wu", "Ian@Collage-AI.com")], teams: [] }),
    );
    expect(badges("also a TF")).toHaveLength(1);
  });

  it("is not claimed for a TF who has no address at all", async () => {
    await mount(
      facultyData({ roster: [student("s2", "Rain Doe", null)], tfs: [tf("t3", "New TF", null)] }),
    );
    expect(badges("also a TF")).toHaveLength(0);
  });
});

describe("typing one in", () => {
  it("is refused, and says whose address it is", async () => {
    await mount();
    const field = emailFieldFor("Rain Doe");

    await act(async () => typeInto(field, "ellie@collage-ai.com"));
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(setStudentEmail).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Ellie Wynkoop");
    expect(host.textContent).toContain("TF roster");
  });

  it("still saves an address that belongs to nobody else", async () => {
    await mount();
    const field = emailFieldFor("Rain Doe");

    await act(async () => typeInto(field, "rain@college.harvard.edu"));
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(setStudentEmail).toHaveBeenCalledWith("s2", "rain@college.harvard.edu");
  });
});

describe("importing one", () => {
  it("warns in the preview instead of blocking", async () => {
    await mount();
    // On the toolbar above the roster now, not at the bottom of the list.
    await act(async () => buttonsSaying("Add students")[0].click());

    const paste = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste students"]');
    if (!paste) throw new Error("no paste box");
    await act(async () => typeInto(paste, "Name,Email\nDrew Vance,ellie@collage-ai.com"));
    await act(async () => buttonsSaying("Add to roster")[0].click());

    const warning = Array.from(host.querySelectorAll("li")).map((li) => li.textContent ?? "");
    expect(warning.join(" ")).toContain("Ellie Wynkoop");

    // Warned, not blocked: the instructor can still go ahead, because somebody
    // may genuinely be both.
    expect(buttonsSaying("Add to roster")).not.toHaveLength(0);
    expect(addStudents).not.toHaveBeenCalled();
  });
});
