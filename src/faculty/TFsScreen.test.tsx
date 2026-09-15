// Adding a TF who is also on the student roster.
//
// A TF must not be a student on their own course, and at sign-in the TF list
// wins regardless — RoleRouter claims the TF row and returns "tf" before it
// reaches claimStudentRows (app/ck/page.tsx) — so the student row would sit
// there unclaimed, on a team and ungraded, forever. Adding the TF clears it.
//
// The line is work, and it is the whole point of these tests: removing a roster
// row cascades check_in_results and takes the PDFs and audio with it, so an
// empty row may go quietly but one with submissions must NOT.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, CourseTF, Student } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";

const removeStudentWithStorage = vi.fn(async () => undefined);
const addTF = vi.fn(async () => undefined);
const countWorkForStudent = vi.fn(async () => 0);

vi.mock("@/checkins/purge", () => ({ removeStudentWithStorage }));

vi.mock("./facultyData", () => ({
  addTF,
  addTFs: vi.fn(async () => undefined),
  countWorkForStudent,
  removeTF: vi.fn(async () => undefined),
  setTFPermissions: vi.fn(async () => undefined),
}));

vi.mock("./FacultyApp", () => ({ FacultyError: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TFsScreen } = await import("./TFsScreen");

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

function student(id: string, name: string, email: string | null): Student {
  return {
    id,
    user_id: null,
    course_id: "c1",
    name,
    email,
    avatar_tint: null,
    position: 0,
    created_at: "",
  };
}

function facultyData(roster: Student[], tfs: CourseTF[] = []): FacultyData {
  return {
    course,
    weeks: [],
    roster,
    activities: [],
    questions: [],
    checkIns: [],
    results: [],
    teams: [],
    tfs,
    stats: new Map(),
    can: {
      isOwner: true,
      author: true,
      grade: true, rubric: true, release: true,
      runCheckIns: true,
      manageRoster: true,
      manageTFs: true,
    },
  };
}

let host: HTMLDivElement;
let root: Root;

async function mount(data: FacultyData): Promise<void> {
  await act(async () => {
    root.render(<TFsScreen data={data} onChanged={() => undefined} onError={() => undefined} />);
  });
}

function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Type an address into "Add one by email" and press the button. */
async function addByEmail(address: string): Promise<void> {
  const field = host.querySelector<HTMLInputElement>('input[aria-label="Add one TF by email"]');
  if (!field) throw new Error("no add-by-email field");
  await act(async () => typeInto(field, address));

  const add = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Add",
  );
  if (!add) throw new Error("no Add button");
  await act(async () => add.click());
}

beforeEach(() => {
  removeStudentWithStorage.mockClear();
  addTF.mockClear();
  countWorkForStudent.mockClear();
  countWorkForStudent.mockResolvedValue(0);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("adding a TF who is on the student roster", () => {
  it("takes the empty student row away, and says so", async () => {
    await mount(facultyData([student("s1", "Ian Wu", "ian@collage-ai.com")]));
    await addByEmail("ian@collage-ai.com");

    expect(addTF).toHaveBeenCalled();
    expect(removeStudentWithStorage).toHaveBeenCalledWith("s1");
    expect(host.textContent).toContain("off the student roster");
  });

  it("matches the address whatever its case", async () => {
    // students.email is stored trimmed but NOT lowercased, while addTF
    // lowercases — so the two rosters routinely disagree on case.
    await mount(facultyData([student("s1", "Ian Wu", "Ian@Collage-AI.com")]));
    await addByEmail("ian@collage-ai.com");

    expect(removeStudentWithStorage).toHaveBeenCalledWith("s1");
  });

  it("leaves a row that has submissions on it, and names the cost", async () => {
    countWorkForStudent.mockResolvedValue(3);
    await mount(facultyData([student("s1", "Ian Wu", "ian@collage-ai.com")]));
    await addByEmail("ian@collage-ai.com");

    // The TF is still added — only the destructive half is withheld.
    expect(addTF).toHaveBeenCalled();
    expect(removeStudentWithStorage).not.toHaveBeenCalled();
    expect(host.textContent).toContain("3 submissions");
    expect(host.textContent).toContain("left alone");
  });

  it("touches nobody else's row", async () => {
    await mount(
      facultyData([
        student("s1", "Rain Doe", "rain@college.harvard.edu"),
        student("s2", "Ian Wu", null),
      ]),
    );
    await addByEmail("ellie@collage-ai.com");

    expect(addTF).toHaveBeenCalled();
    expect(removeStudentWithStorage).not.toHaveBeenCalled();
    expect(countWorkForStudent).not.toHaveBeenCalled();
  });
});
