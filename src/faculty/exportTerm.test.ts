import { describe, expect, it } from "vitest";
import type { ResultRow } from "@/checkins/data";
import type { StudentMark } from "@/checkins/tutorial";
import type { Activity, CheckIn, Student } from "@/checkins/types";
import {
  canvasCsv,
  checkInColumns,
  checkInCsv,
  manifestCsv,
  safeFilename,
  toCsv,
  type ManifestRow,
} from "./exportTerm";

describe("toCsv", () => {
  it("leaves ordinary fields alone", () => {
    expect(toCsv([["a", "b"]])).toBe("a,b\r\n");
  });

  // The whole reason this function exists. A roster carries "Han, Caleb" and a
  // marker's note carries quotes and newlines; unescaped, every column to the
  // right shifts by one and the file still opens, which is worse than failing.
  it("quotes a field containing a comma", () => {
    expect(toCsv([["Han, Caleb"]])).toBe('"Han, Caleb"\r\n');
  });

  it("doubles an embedded quote", () => {
    expect(toCsv([['she said "no"']])).toBe('"she said ""no"""\r\n');
  });

  it("quotes a field containing a newline", () => {
    expect(toCsv([["one\ntwo"]])).toBe('"one\ntwo"\r\n');
  });

  it("writes null and undefined as empty rather than as words", () => {
    expect(toCsv([[null, undefined, 0]])).toBe(",,0\r\n");
  });

  it("keeps a zero, which is a real score", () => {
    expect(toCsv([[0]])).toBe("0\r\n");
  });
});

describe("safeFilename", () => {
  it("joins the parts it was given", () => {
    expect(safeFilename("AP50A", "Fall 2026", "grades")).toBe("ap50a-fall-2026-grades");
  });

  it("drops empty parts rather than leaving a gap", () => {
    expect(safeFilename("AP50A", null, "grades")).toBe("ap50a-grades");
  });

  it("collapses anything a filesystem would argue about", () => {
    expect(safeFilename("AP 50 / B: week 8")).toBe("ap-50-b-week-8");
  });
});

describe("manifestCsv", () => {
  const row: ManifestRow = {
    kind: "photo",
    week: 8,
    activity: "CHALLENGE - Velocity",
    subject: "Team 3",
    path: "course/activity/team/whiteboard.jpg",
    detail: "whiteboard, end of session",
    bytes: 4_194_304,
    createdAt: "2026-10-14T15:04:00.000Z",
  };

  it("puts the path last, where it stays findable in a bucket dump", () => {
    const [header, body] = manifestCsv([row]).trim().split("\r\n");
    expect(header.split(",").at(-1)).toBe("Path");
    expect(body.split(",").at(-1)).toBe("course/activity/team/whiteboard.jpg");
  });

  it("reports a missing size as empty, never as zero", () => {
    const line = manifestCsv([{ ...row, bytes: null }]).trim().split("\r\n")[1];
    // Recordings and hand-ins have no size_bytes column, so a 0 here would be a
    // number somebody adds up and believes.
    expect(line).toContain(",,");
    expect(line).not.toContain(",0,");
  });

  it("survives an activity title with a comma in it", () => {
    const csv = manifestCsv([{ ...row, activity: "Combo, part two" }]);
    expect(csv).toContain('"Combo, part two"');
    expect(csv.trim().split("\r\n")[1].split(",").at(-1)).toBe(row.path);
  });
});

// ---------------------------------------------------------- into a gradebook
//
// A total that is wrong in a gradebook is the worst bug this file can have:
// nobody re-derives it, they upload it. So the sum gets tested from both ends —
// what it adds, and what it refuses to add.

const activity = (over: Partial<Activity> & Pick<Activity, "id" | "title" | "type">): Activity => ({
  course_id: "c",
  week: 8,
  topic: null,
  dates_label: null,
  points_total: 5,
  question_count: 0,
  points_per_question: 0,
  completion: true,
  due_at: null,
  stage: 1,
  resubmit_mode: "individual",
  source_text: null,
  files: [],
  opens_at: null,
  individual_due_at: null,
  team_due_at: null,
  posted: true,
  position: 0,
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

const student = (id: string, name: string, position: number): Student => ({
  id,
  course_id: "c",
  name,
  email: `${id}@example.edu`,
  avatar_tint: null,
  position,
  created_at: "2026-01-01T00:00:00.000Z",
});

const checkIn = (id: string, activityId: string, over: Partial<CheckIn> = {}): CheckIn => ({
  id,
  activity_id: activityId,
  label: "Individual",
  kind: "individual",
  phase: null,
  scale: "ci",
  max_points: null,
  posted: true,
  position: 0,
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

const result = (over: Partial<ResultRow> & Pick<ResultRow, "check_in_id" | "student_id">): ResultRow => ({
  id: `r-${over.check_in_id}-${over.student_id}`,
  subject_type: "student",
  team_id: null,
  status: "scored",
  score: null,
  is_ci: true,
  ci_met: true,
  transcription_state: "none",
  flagged: false,
  submitted_at: null,
  feedback: null,
  updated_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

// Kelly's week: a tutorial completion worth 5, a challenge completion worth 5,
// and a combo out of 20.
const TUTORIAL = activity({ id: "a-tut", title: "Tutorial", type: "skills", position: 0 });
const CHALLENGE = activity({ id: "a-chal", title: "CHALLENGE - Velocity", type: "challenge", position: 1 });
const COMBO = activity({
  id: "a-combo",
  title: "COMBO - Kinematics",
  type: "combo",
  position: 2,
  completion: false,
  points_total: 20,
});
const WEEK = [TUTORIAL, CHALLENGE, COMBO];
const CHECK_INS = [
  checkIn("ci-tut", "a-tut"),
  checkIn("ci-chal", "a-chal"),
  checkIn("ci-combo", "a-combo", { scale: "points", max_points: 20 }),
];

const cells = (csv: string, row: number) => csv.trim().split("\r\n")[row].split(",");

const slot = (n: number, accuracy: number | null, discussion: number | null, absent = false): StudentMark => ({
  slot: n,
  student_id: "s1",
  absent,
  presenter_id: null,
  accuracy,
  discussion,
});

const kim = student("s1", "Kim", 0);
const sam = student("s2", "Sam", 1);

describe("canvasCsv", () => {
  it("writes the five columns Kelly listed, in her order", () => {
    const head = cells(canvasCsv({ students: [kim], activities: WEEK, checkIns: CHECK_INS, results: [] }), 0);
    expect(head).toEqual([
      "Student",
      "Email",
      "Total (30)",
      "Tutorial completion (5)",
      "CHALLENGE - Velocity completion (5)",
      "COMBO - Kinematics (20)",
    ]);
  });

  it("adds the week up to 30", () => {
    const csv = canvasCsv({
      students: [kim],
      activities: WEEK,
      checkIns: CHECK_INS,
      results: [
        result({ check_in_id: "ci-tut", student_id: "s1" }),
        result({ check_in_id: "ci-chal", student_id: "s1" }),
        result({ check_in_id: "ci-combo", student_id: "s1", is_ci: false, score: 20 }),
      ],
    });
    expect(cells(csv, 1)).toEqual(["Kim", "s1@example.edu", "30", "5", "5", "20"]);
  });

  // The words are what gradesCsv writes for a person to read. This file is for
  // a machine that adds, and it cannot add "Complete".
  it("writes a completion as points, not as the word", () => {
    const csv = canvasCsv({
      students: [kim],
      activities: [CHALLENGE],
      checkIns: CHECK_INS,
      results: [result({ check_in_id: "ci-chal", student_id: "s1" })],
    });
    expect(cells(csv, 1)).toEqual(["Kim", "s1@example.edu", "5", "5"]);
  });

  it("makes a released Not complete a real zero", () => {
    const csv = canvasCsv({
      students: [kim],
      activities: [CHALLENGE],
      checkIns: CHECK_INS,
      results: [result({ check_in_id: "ci-chal", student_id: "s1", ci_met: false })],
    });
    expect(cells(csv, 1)).toEqual(["Kim", "s1@example.edu", "0", "0"]);
  });

  // Uploading a 0 against work that is in and unread tells a class it failed
  // something nobody has looked at.
  it("leaves work that is handed in but unmarked blank, and out of the total", () => {
    const csv = canvasCsv({
      students: [kim],
      activities: WEEK,
      checkIns: CHECK_INS,
      results: [
        result({ check_in_id: "ci-tut", student_id: "s1" }),
        result({ check_in_id: "ci-chal", student_id: "s1", status: "submitted" }),
        result({ check_in_id: "ci-combo", student_id: "s1", status: "needs_review", is_ci: false, score: 18 }),
      ],
    });
    expect(cells(csv, 1)).toEqual(["Kim", "s1@example.edu", "5", "5", "", ""]);
  });

  it("gives a student with nothing released no total at all", () => {
    const csv = canvasCsv({ students: [kim], activities: WEEK, checkIns: CHECK_INS, results: [] });
    expect(cells(csv, 1)).toEqual(["Kim", "s1@example.edu", "", "", "", ""]);
  });

  it("keeps an excused activity out of the total rather than scoring it 0", () => {
    const csv = canvasCsv({
      students: [kim],
      activities: [CHALLENGE, COMBO],
      checkIns: CHECK_INS,
      results: [
        result({ check_in_id: "ci-chal", student_id: "s1", status: "excused" }),
        result({ check_in_id: "ci-combo", student_id: "s1", is_ci: false, score: 20 }),
      ],
    });
    expect(cells(csv, 1)).toEqual(["Kim", "s1@example.edu", "20", "", "20"]);
  });

  it("says in the header when an activity has not been priced", () => {
    const free = activity({ id: "a-free", title: "Tutorial", type: "skills", points_total: 0 });
    const head = cells(canvasCsv({ students: [kim], activities: [free], checkIns: [checkIn("ci-free", "a-free")], results: [] }), 0);
    expect(head).toEqual(["Student", "Email", "Total (0)", "Tutorial completion (0)"]);
  });

  it("orders rows by roster position, not by name", () => {
    const csv = canvasCsv({
      students: [student("s2", "Ada", 1), student("s1", "Zoë", 0)],
      activities: [CHALLENGE],
      checkIns: CHECK_INS,
      results: [],
    });
    expect(csv.trim().split("\r\n").slice(1).map((r) => r.split(",")[0])).toEqual(["Zoë", "Ada"]);
  });
});

describe("checkInCsv", () => {
  // Kelly's spec, verbatim from Slack: "average of the 4 scores for the day
  // /5". The file used to add them — 4+5+3+4 came out as 16 of 20 — and what
  // Canvas needs is the day out of 5.
  it("averages a day's four numbers out of 5", () => {
    const csv = checkInCsv({
      students: [kim],
      activities: [TUTORIAL],
      rows: [{ activityId: "a-tut", studentId: "s1", slots: [slot(1, 4, 5), slot(2, 3, 4)] }],
    });
    expect(cells(csv, 0)).toEqual(["Student", "Email", "Total (5)", "Tutorial (5)"]);
    expect(cells(csv, 1)).toEqual(["Kim", "s1@example.edu", "4", "4"]);
  });

  it("rounds an uneven average to two decimals", () => {
    const csv = checkInCsv({
      students: [kim],
      activities: [TUTORIAL],
      rows: [{ activityId: "a-tut", studentId: "s1", slots: [slot(1, 5, 4), slot(2, 4, null)] }],
    });
    expect(cells(csv, 1)).toEqual(["Kim", "s1@example.edu", "4.33", "4.33"]);
  });

  // studentMarks() has already zeroed an absent member. This must not re-decide
  // it — one score, one function.
  it("carries an absent student's zero through as a zero", () => {
    const csv = checkInCsv({
      students: [kim, sam],
      activities: [TUTORIAL],
      rows: [
        { activityId: "a-tut", studentId: "s1", slots: [slot(1, 4, 5), slot(2, 3, 4)] },
        { activityId: "a-tut", studentId: "s2", slots: [slot(1, 0, 0, true), slot(2, 0, 0, true)] },
      ],
    });
    expect(cells(csv, 2)).toEqual(["Sam", "s2@example.edu", "0", "0"]);
  });

  it("averages only the numbers that were marked, so a slot behind does not drag", () => {
    const csv = checkInCsv({
      students: [kim],
      activities: [TUTORIAL],
      rows: [{ activityId: "a-tut", studentId: "s1", slots: [slot(1, 4, 5), slot(2, null, null)] }],
    });
    // The day is out of 5 whatever was marked: an average has one denominator.
    expect(cells(csv, 0).at(-1)).toBe("Tutorial (5)");
    expect(cells(csv, 1)).toEqual(["Kim", "s1@example.edu", "4.5", "4.5"]);
  });

  it("adds the DAYS into the total, each out of 5", () => {
    const csv = checkInCsv({
      students: [kim],
      activities: [TUTORIAL, CHALLENGE],
      rows: [
        { activityId: "a-tut", studentId: "s1", slots: [slot(1, 4, 5), slot(2, 3, 4)] },
        { activityId: "a-chal", studentId: "s1", slots: [slot(1, 5, 5)] },
      ],
    });
    expect(cells(csv, 0)).toEqual([
      "Student",
      "Email",
      "Total (10)",
      "Tutorial (5)",
      "CHALLENGE - Velocity (5)",
    ]);
    expect(cells(csv, 1)).toEqual(["Kim", "s1@example.edu", "9", "4", "5"]);
  });

  it("drops an activity nobody has marked rather than writing a column of zeroes", () => {
    const csv = checkInCsv({
      students: [kim],
      activities: [TUTORIAL, CHALLENGE],
      rows: [{ activityId: "a-tut", studentId: "s1", slots: [slot(1, 4, 5)] }],
    });
    expect(cells(csv, 0)).toEqual(["Student", "Email", "Total (5)", "Tutorial (5)"]);
  });

  it("leaves a student with no row blank rather than scoring them 0", () => {
    const csv = checkInCsv({
      students: [kim, sam],
      activities: [TUTORIAL],
      rows: [{ activityId: "a-tut", studentId: "s1", slots: [slot(1, 4, 5)] }],
    });
    expect(cells(csv, 2)).toEqual(["Sam", "s2@example.edu", "", ""]);
  });

  // Why TeamsScreen refuses to download this rather than writing it. With no
  // columns the file is NOT empty — it is the whole roster with a blank Total
  // beside every name, which opens looking like some other export entirely.
  // That is the file that got reported as "the wrong CSV", and it is pinned
  // here so nobody later decides an empty download is harmless.
  it("with nothing marked, writes the whole roster and not one score", () => {
    const csv = checkInCsv({ students: [kim, sam], activities: WEEK, rows: [] });
    expect(cells(csv, 0)).toEqual(["Student", "Email", "Total (0)"]);
    expect(cells(csv, 1)).toEqual(["Kim", "s1@example.edu", ""]);
    expect(csv.trim().split("\r\n")).toHaveLength(3);
  });
});

// The question the screen asks before it writes anything. It has to be this
// function and not a second opinion: a check the screen computes for itself is
// free to disagree with the file, which is the same bug one step later.
describe("checkInColumns", () => {
  it("finds nothing in a week nobody has checked in on", () => {
    expect(checkInColumns({ students: [kim, sam], activities: WEEK, rows: [] })).toEqual([]);
  });

  // `rows` is not empty here and there is still nothing to export: a presenter
  // was picked and the session moved on, so studentMarks returns slots that are
  // out of nothing. Asking "did we get any rows" would have written the file.
  it("finds nothing when the slots exist but no score was given", () => {
    const cols = checkInColumns({
      students: [kim],
      activities: [TUTORIAL],
      rows: [{ activityId: "a-tut", studentId: "s1", slots: [slot(1, null, null)] }],
    });
    expect(cols).toEqual([]);
  });

  it("names exactly the columns the file goes on to write", () => {
    const input = {
      students: [kim, sam],
      activities: [TUTORIAL, CHALLENGE],
      rows: [{ activityId: "a-tut", studentId: "s1", slots: [slot(1, 4, 5)] }],
    };
    expect(checkInColumns(input).map((c) => c.activity.id)).toEqual(["a-tut"]);
    expect(cells(checkInCsv(input), 0)).toEqual(["Student", "Email", "Total (5)", "Tutorial (5)"]);
  });

  it("a day is out of 5 however many slots are marked — an average has one denominator", () => {
    const cols = checkInColumns({
      students: [kim, sam],
      activities: [TUTORIAL],
      rows: [
        { activityId: "a-tut", studentId: "s1", slots: [slot(1, 4, 5)] },
        { activityId: "a-tut", studentId: "s2", slots: [slot(1, 4, 5), slot(2, 3, 3)] },
      ],
    });
    expect(cols).toEqual([{ activity: TUTORIAL, outOf: 5 }]);
  });
});
