// Kelly's file: name, email, team number — in one go.
//
// The three-column CSV is the whole of how she sets a class up: she has it in a
// spreadsheet already, and the roster and the teams both come out of it. The
// import used to refuse the team half of that on a roster that was still empty
// — every row read as "is not on the roster, so nothing was moved" — which is
// the state a course is in on the day she does this, before anybody has entered
// the class code.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, Student } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";

/** The database, as far as these tests are concerned. */
const db = {
  students: [] as Student[],
  sets: [] as { id: string; course_id: string }[],
  teams: [] as { id: string; team_set_id: string; name: string; position: number }[],
  members: [] as { team_id: string; student_id: string }[],
};

const addStudents = vi.fn(
  async (courseId: string, entries: { name: string; email?: string }[], startPos: number) => {
    const rows = entries.map((e, i) => ({
      id: `s-new-${db.students.length + i}`,
      user_id: null,
      course_id: courseId,
      name: e.name,
      email: e.email ?? null,
      avatar_tint: null,
      position: startPos + i,
      created_at: "",
    })) as Student[];
    db.students.push(...rows);
    return rows;
  },
);

const setStudentName = vi.fn(async (id: string, name: string) => {
  const at = db.students.findIndex((s) => s.id === id);
  if (at >= 0) db.students[at] = { ...db.students[at], name };
});

const createTeamSet = vi.fn(async (input: { courseId: string }) => {
  const row = { id: `set-${db.sets.length}`, course_id: input.courseId };
  db.sets.push(row);
  return row;
});
const listTeamSets = vi.fn(async () => db.sets);
const createTeam = vi.fn(async (teamSetId: string, name: string, position: number) => {
  const row = { id: `t-${db.teams.length}`, team_set_id: teamSetId, name, position };
  db.teams.push(row);
  return row;
});
const renameTeam = vi.fn(async () => undefined);
const moveStudents = vi.fn(async (studentIds: string[], teamId: string | null) => {
  db.members = db.members.filter((m) => !studentIds.includes(m.student_id));
  if (teamId) db.members.push(...studentIds.map((student_id) => ({ team_id: teamId, student_id })));
});

vi.mock("@/checkins/data", () => ({
  addStudents,
  createTeam,
  createTeamSet,
  listTeamSets,
  moveStudents,
  renameTeam,
  removeStudent: vi.fn(async () => undefined),
  setStudentEmail: vi.fn(async () => undefined),
  setStudentName,
}));

vi.mock("@/checkins/purge", () => ({
  removeStudentWithStorage: vi.fn(async () => undefined),
}));

vi.mock("@/faculty/facultyData", () => ({
  countWorkForStudent: vi.fn(async () => 0),
  courseMemberRoles: vi.fn(async () => new Map<string, string>()),
  setMemberRole: vi.fn(async () => undefined),
}));

// Only the two calls the export path makes; SCALE and the rest stay real,
// because exportTerm reads them at module load.
vi.mock("@/checkins/tutorial", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTutorialSheet: vi.fn(async () => ({ marks: [], absences: [] })),
}));

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

function facultyData(over: Partial<FacultyData> = {}): FacultyData {
  return {
    course,
    weeks: [],
    roster: [],
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

const CSV = [
  "Name,Email,Team",
  "Ada Lovelace,ada@x.edu,1",
  "Grace Hopper,grace@x.edu,1",
  "Alan Turing,alan@x.edu,2",
  "Katherine Johnson,katherine@x.edu,2",
].join("\n");

let host: HTMLDivElement;
let root: Root;

async function mount(data: FacultyData = facultyData()): Promise<void> {
  await act(async () => {
    root.render(<TeamsScreen data={data} onChanged={() => undefined} onError={() => undefined} />);
  });
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const buttons = (): HTMLButtonElement[] => Array.from(host.querySelectorAll("button"));
const buttonSaying = (text: string): HTMLButtonElement | undefined =>
  buttons().find((b) => b.textContent?.trim() === text);

async function pasteTheFile(): Promise<void> {
  const paste = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste students"]');
  if (!paste) throw new Error("no paste box");
  await act(async () => typeInto(paste, CSV));
  const preview = buttonSaying("Add to roster");
  if (!preview) throw new Error("no button to preview the paste");
  await act(async () => preview.click());
}

beforeEach(() => {
  db.students = [];
  db.sets = [];
  db.teams = [];
  db.members = [];
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function student(id: string, name: string, email: string | null, position: number): Student {
  return {
    id,
    user_id: null,
    course_id: "c1",
    name,
    email,
    avatar_tint: null,
    position,
    created_at: "",
  };
}

describe("a name/email/team file onto an empty roster", () => {
  it("previews the teams it will make, not four rows that match nobody", async () => {
    await mount();
    await pasteTheFile();

    expect(host.textContent).not.toContain("is not on the roster");
    expect(host.textContent).toContain("2 teams");
    expect(host.textContent).toContain("4 students placed");
  });

  it("adds the students and seats them in one press", async () => {
    await mount();
    await pasteTheFile();

    const go = buttonSaying("Add to roster and set teams");
    expect(go).toBeTruthy();
    await act(async () => go?.click());

    expect(addStudents).toHaveBeenCalledTimes(1);
    expect(db.students).toHaveLength(4);
    expect(db.teams.map((t) => t.name)).toEqual(["Team 1", "Team 2"]);
    // Everybody is seated, and on the team the file gave them.
    const seatOf = (name: string) => {
      const s = db.students.find((x) => x.name === name);
      const link = db.members.find((m) => m.student_id === s?.id);
      return db.teams.find((t) => t.id === link?.team_id)?.name;
    };
    expect(seatOf("Ada Lovelace")).toBe("Team 1");
    expect(seatOf("Grace Hopper")).toBe("Team 1");
    expect(seatOf("Alan Turing")).toBe("Team 2");
    expect(seatOf("Katherine Johnson")).toBe("Team 2");
  });
});

describe("the same file onto a roster that filled itself", () => {
  it("seats the students who are already here, adding nobody", async () => {
    await mount(
      facultyData({
        roster: [
          student("s1", "Ada Lovelace", "ada@x.edu", 0),
          student("s2", "Grace Hopper", "grace@x.edu", 1),
          student("s3", "Alan Turing", "alan@x.edu", 2),
          student("s4", "Katherine Johnson", "katherine@x.edu", 3),
        ],
      }),
    );
    // The importer is behind the toolbar once there are students on the page.
    await act(async () => buttonSaying("Add students")?.click());
    await pasteTheFile();

    expect(host.textContent).toContain("2 teams");
    const go = buttonSaying("Set teams");
    expect(go).toBeTruthy();
    await act(async () => go?.click());

    expect(addStudents).not.toHaveBeenCalled();
    expect(db.teams.map((t) => t.name)).toEqual(["Team 1", "Team 2"]);
    expect(db.members.map((m) => m.student_id).sort()).toEqual(["s1", "s2", "s3", "s4"]);
  });
});

describe("a file that is half late enrolments", () => {
  it("adds the two who are missing and seats all four", async () => {
    await mount(
      facultyData({
        roster: [
          student("s1", "Ada Lovelace", "ada@x.edu", 0),
          student("s3", "Alan Turing", "alan@x.edu", 1),
        ],
      }),
    );
    await act(async () => buttonSaying("Add students")?.click());
    await pasteTheFile();

    expect(host.textContent).not.toContain("is not on the roster");
    const go = buttonSaying("Add to roster and set teams");
    expect(go).toBeTruthy();
    await act(async () => go?.click());

    expect(addStudents).toHaveBeenCalledTimes(1);
    expect(db.students.map((s) => s.name)).toEqual(["Grace Hopper", "Katherine Johnson"]);
    expect(db.teams.map((t) => t.name)).toEqual(["Team 1", "Team 2"]);
    const seats = new Map(db.members.map((m) => [m.student_id, m.team_id]));
    expect(seats.get("s1")).toBe(seats.get(db.students[0].id));
    expect(seats.get("s3")).toBe(seats.get(db.students[1].id));
    expect(seats.get("s1")).not.toBe(seats.get("s3"));
  });
});

describe("when the team half fails after the students are in", () => {
  it("does not offer to add them a second time", async () => {
    createTeam.mockRejectedValueOnce(new Error("permission denied for table teams"));
    await mount();
    await pasteTheFile();
    await act(async () => buttonSaying("Add to roster and set teams")?.click());

    expect(db.students).toHaveLength(4);
    // The add is off the panel: what is left to retry is the seating alone.
    expect(buttonSaying("Add to roster and set teams")).toBeFalsy();
    const retry = buttonSaying("Set teams");
    expect(retry).toBeTruthy();

    await act(async () => retry?.click());
    expect(addStudents).toHaveBeenCalledTimes(1);
    expect(db.students).toHaveLength(4);
    expect(db.teams.map((t) => t.name)).toEqual(["Team 1", "Team 2"]);
  });
});

describe("a registrar's export, in the shape one really arrives in", () => {
  // No header row, "Last,First Middle" quoted with no space after the comma,
  // CRLF, address, team number — 8 students over 2 teams.
  const REGISTRAR = [
    '"Ashgrove,Martin Peter",martin@example.edu,1',
    '"Del Rio Santos,Camila Rose",camila@example.edu,1',
    '"Okonkwo,Ifeoma",ifeoma@example.edu,1',
    '"Lindqvist,Anders Nils",anders@example.edu,1',
    '"Whitlock Jr,Desmond Earl",desmond@example.edu,2',
    '"Ng,Wei",wei@example.edu,2',
    '"Sato,Haruki Jun",haruki@example.edu,2',
    '"Ferreira,Luisa Marta",luisa@example.edu,2',
  ].join("\r\n");

  it("seats the whole class in one press", async () => {
    await mount();
    const box = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste students"]');
    if (!box) throw new Error("no paste box");
    await act(async () => typeInto(box, REGISTRAR));
    await act(async () => buttonSaying("Add to roster")?.click());

    expect(host.textContent).toContain("2 teams");
    expect(host.textContent).toContain("8 students placed");
    await act(async () => buttonSaying("Add to roster and set teams")?.click());

    expect(db.students.map((s) => s.name)).toEqual([
      "Martin Peter Ashgrove",
      "Camila Rose Del Rio Santos",
      "Ifeoma Okonkwo",
      "Anders Nils Lindqvist",
      "Desmond Earl Whitlock Jr",
      "Wei Ng",
      "Haruki Jun Sato",
      "Luisa Marta Ferreira",
    ]);
    expect(db.teams.map((t) => t.name)).toEqual(["Team 1", "Team 2"]);
    const on = (team: string) =>
      db.members
        .filter((m) => m.team_id === db.teams.find((t) => t.name === team)?.id)
        .map((m) => db.students.find((s) => s.id === m.student_id)?.name);
    expect(on("Team 1")).toHaveLength(4);
    expect(on("Team 2")).toHaveLength(4);
    expect(on("Team 1")).toContain("Anders Nils Lindqvist");
    expect(on("Team 2")).toContain("Wei Ng");
  });
});

describe("a file that Excel did not save as UTF-8", () => {
  /** jsdom's File implements neither text() nor arrayBuffer(); this is the two
   *  fields takeFile actually reads. */
  const fileOf = (bytes: number[], name: string): File =>
    ({
      name,
      size: bytes.length,
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    }) as unknown as File;

  async function drop(file: File): Promise<void> {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // takeFile reads the bytes, so the preview lands a microtask or two later.
    for (let i = 0; i < 3; i++) await act(async () => undefined);
  }

  it("refuses a file far too big to be a class list, without reading it", async () => {
    await mount();
    let read = false;
    const huge = {
      name: "lecture-recording.csv",
      size: 40 * 1024 * 1024,
      arrayBuffer: async () => {
        read = true;
        return new Uint8Array(0).buffer;
      },
    } as unknown as File;
    await drop(huge);

    expect(read).toBe(false);
    expect(host.textContent).toContain("far larger than any class list");
  });

  it("reads the accented name as a letter, not a black diamond, and says so", async () => {
    await mount();
    // "Zoë Brennan,r@x.edu,1" with ë written as the single byte 0xEB —
    // valid windows-1252, not valid UTF-8.
    // Four rows over two teams, because a team column of one repeated value is
    // indistinguishable from an "enrolled" flag and is refused on purpose.
    const ascii = (t: string) => [...t].map((c) => c.charCodeAt(0));
    const line = [
      ...ascii('"Brennan,Zo'),
      0xeb,
      ...ascii(
        '",r@x.edu,1\r\n"Ng,Wei",wei@x.edu,1\r\n' +
          '"Lindqvist,Anders Nils",anders@x.edu,2\r\n"Ferreira,Luisa Marta",luisa@x.edu,2',
      ),
    ];
    await drop(fileOf(line, "AP50A_team_list.csv"));

    expect(host.textContent).toContain("Zoë Brennan");
    expect(host.textContent).not.toContain("\ufffd");
    expect(host.textContent).toContain("not saved as UTF-8");
    // And it is still an import: the teams are planned as usual.
    expect(host.textContent).toContain("2 teams");
    expect(host.textContent).toContain("4 students placed");
    expect(buttonSaying("Add to roster and set teams")).toBeTruthy();
  });
});

describe("a corrected spelling, re-imported", () => {
  const mangled = () =>
    facultyData({
      roster: [
        student("s1", "Zo\ufffd Brennan", "zoe@x.edu", 0),
        student("s2", "Wei Ng", "wei@x.edu", 1),
      ],
    });
  const FIXED = ["Name,Email", "Zoë Brennan,zoe@x.edu", "Wei Ng,wei@x.edu"].join("\n");

  async function proposeFixed(): Promise<void> {
    await act(async () => buttonSaying("Add students")?.click());
    const box = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste students"]');
    if (!box) throw new Error("no paste box");
    await act(async () => typeInto(box, FIXED));
    await act(async () => buttonSaying("Add to roster")?.click());
  }

  it("shows the rename old → new instead of calling it nothing to add", async () => {
    await mount(mangled());
    await proposeFixed();

    // The whole file matches on address; before, that was "nothing to add".
    expect(host.textContent).toContain("1 name is spelled differently");
    expect(host.textContent).toContain("Zoë Brennan");
    expect(addStudents).not.toHaveBeenCalled();
  });

  it("writes the corrected name", async () => {
    await mount(mangled());
    await proposeFixed();
    await act(async () => buttonSaying("Update the roster")?.click());

    expect(setStudentName).toHaveBeenCalledTimes(1);
    expect(setStudentName).toHaveBeenCalledWith("s1", "Zoë Brennan");
  });

  it("leaves the roster alone when the correction is unticked", async () => {
    await mount(mangled());
    await proposeFixed();
    const tick = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(tick?.checked).toBe(true);
    await act(async () => tick?.click());

    // Nothing left for this file to do, so nothing offers to do it.
    expect(buttonSaying("Update the roster")).toBeFalsy();
    expect(setStudentName).not.toHaveBeenCalled();
  });
});

describe("renaming a student on the roster", () => {
  const roster = () =>
    facultyData({ roster: [student("s1", "Zo\ufffd Brennan", "zoe@x.edu", 0)] });

  const nameField = (of: string): HTMLInputElement => {
    const el = host.querySelector<HTMLInputElement>(`input[aria-label="Name for ${of}"]`);
    if (!el) throw new Error(`no name field for ${of}`);
    return el;
  };

  it("saves the new spelling", async () => {
    await mount(roster());
    const field = nameField("Zo\ufffd Brennan");
    await act(async () => typeInto(field, "Zoë Brennan"));
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(setStudentName).toHaveBeenCalledWith("s1", "Zoë Brennan");
    expect(host.textContent).toContain("is now Zoë Brennan");
  });

  it("refuses to leave a row with no name at all", async () => {
    await mount(roster());
    const field = nameField("Zo\ufffd Brennan");
    await act(async () => typeInto(field, "   "));
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(setStudentName).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Every row needs a name");
  });

  it("offers Save, not a red Clear, when the student has no address yet", async () => {
    await mount(facultyData({ roster: [student("s1", "Wei Ng", null, 0)] }));
    const field = nameField("Wei Ng");
    await act(async () => typeInto(field, "Wei Ng-Alvarez"));

    // The row's button is about the rename; nothing here clears anything.
    expect(buttonSaying("Save")).toBeTruthy();
    expect(buttonSaying("Clear")).toBeFalsy();

    await act(async () => buttonSaying("Save")?.click());
    expect(setStudentName).toHaveBeenCalledWith("s1", "Wei Ng-Alvarez");
  });

  it("still calls it Clear when an address really is being emptied", async () => {
    await mount(facultyData({ roster: [student("s1", "Wei Ng", "wei@x.edu", 0)] }));
    const email = host.querySelector<HTMLInputElement>('input[aria-label="Email for Wei Ng"]');
    if (!email) throw new Error("no email field");
    await act(async () => typeInto(email, ""));
    expect(buttonSaying("Clear")).toBeTruthy();
  });

  it("puts the name back on Escape", async () => {
    await mount(roster());
    const field = nameField("Zo\ufffd Brennan");
    await act(async () => typeInto(field, "Something Else"));
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(nameField("Zo\ufffd Brennan").value).toBe("Zo\ufffd Brennan");
    expect(setStudentName).not.toHaveBeenCalled();
  });
});
