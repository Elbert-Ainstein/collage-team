// Taking a term out of the app.
//
// WHY THIS EXISTS. Supabase's daily backups cover Postgres and NOTHING ELSE —
// their own words: "Database backups do not include objects you store via the
// Storage API, as the database only includes metadata about these objects." So
// the grades have a seven-day safety net and the recordings, hand-ins and
// whiteboard photos have none at all.
//
// Four files come out of here, and they answer different questions.
//
//   GRADES     what everyone got. The record of record, and the thing a faculty
//              member wants at the end of a term regardless of any of this. It
//              is also the copy that survives if this app does not.
//
//   CANVAS     the same term, one week of it, as points a gradebook can add.
//              Not a second opinion about anyone's grade — it reads the same
//              cellFor() the screens do — just the arithmetic Canvas needs.
//
//   CHECK-INS  the live tutorial sheet, per student rather than per team.
//
//   MANIFEST   what was handed in. One row per uploaded object, with who, what
//              it answered, and when. This is the one that matters after the
//              artifacts are cleared: the bytes are gone, but the record of
//              what existed is not, and "what did you delete" stops being an
//              unanswerable question.
//
// None of these is the bytes. 22 GB cannot come down through a browser, and
// Vercel caps a request body at 4.5 MB so nothing can proxy it either. Pulling
// the objects themselves is rclone against Supabase's S3-compatible endpoint —
// docs/backup-runbook.md — and it is a thing a person runs, not a button.

import { requireSupabase } from "@/lib/supabaseClient";
import { selectAll, selectAllIn,
  type ResultRow,
} from "@/checkins/data";
import { isCompletionMet } from "@/checkins/studentData";
import { SCALE, type StudentMark } from "@/checkins/tutorial";
import {
  isCompletion,
  SCOPE_OF,
  type Activity,
  type ActivityQuestion,
  type CheckIn,
  type CheckInResult,
  type Course,
  type Student,
  type TeamWithMembers,
} from "@/checkins/types";
import { cellFor, pointsTotal, studentPercents } from "./model";

const db = () => requireSupabase();

/**
 * One CSV field, escaped.
 *
 * Not optional politeness: a roster carries names with commas in them ("Han,
 * Caleb"), a marker's feedback carries quotes and newlines, and any of those
 * unescaped silently shifts every column to its right — which is worse than
 * failing, because the file still opens.
 */
function field(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (!/[",\r\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  // CRLF, and a trailing newline. RFC 4180, and the thing Excel is least
  // likely to argue with.
  return rows.map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";
}

/** A filename that will not need renaming on any of the three platforms. */
export function safeFilename(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .join("-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** How a single activity's outcome reads in a spreadsheet cell. */
function gradeCell(
  activity: Activity,
  student: Student,
  checkIns: CheckIn[],
  results: ResultRow[],
): string {
  const cell = cellFor(activity, { kind: "student", id: student.id }, checkIns, results, null);
  const r = cell.result;
  if (cell.state === "na") return "";
  if (!r || r.status !== "scored") {
    // The state, not a blank. "not started" and "handed in, not marked yet" are
    // different facts about a term and a blank cell loses the difference.
    return r?.status === "submitted" || r?.status === "needs_review" ? "not marked" : "";
  }
  if (r.is_ci) return isCompletionMet(r) ? "complete" : "not complete";
  const outOf = cell.checkIn?.max_points ?? pointsTotal(activity);
  return outOf ? `${r.score ?? 0} of ${outOf}` : String(r.score ?? 0);
}

export interface GradesInput {
  course: Course;
  students: Student[];
  activities: Activity[];
  checkIns: CheckIn[];
  results: ResultRow[];
  questions: ActivityQuestion[];
}

/**
 * The gradebook, one row per student.
 *
 * Built from cellFor and studentPercents rather than from a second reading of
 * the results — the number in this file and the number on screen disagreeing
 * would make the export worse than not having one, and that disagreement is
 * exactly what happens when two places compute the same thing.
 */
export function gradesCsv(input: GradesInput): string {
  const { students, activities, checkIns, results } = input;
  const cols = [...activities].sort(
    (a, b) => (a.week ?? 0) - (b.week ?? 0) || a.title.localeCompare(b.title),
  );
  const percents = studentPercents(activities, students, checkIns, results);

  const header = [
    "Student",
    "Email",
    ...cols.map((a) => (a.week ? `Week ${a.week} · ${a.title}` : a.title)),
    "Total %",
  ];

  const body = [...students]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((s) => [
      s.name,
      s.email ?? "",
      ...cols.map((a) => gradeCell(a, s, checkIns, results)),
      percents.get(s.id) ?? "",
    ]);

  return toCsv([header, ...body]);
}

// -------------------------------------------- into somebody else's gradebook
//
// gradesCsv above is the record of a term: it prints "complete" and "12 of 20"
// because a PERSON reads it. Canvas does not read a column, it adds one — so
// everything below writes the same facts as points, one row per student, with a
// total that is the sum of the cells beside it and nothing else.
//
// The shape is Kelly's, per week: tutorial completion + challenge completion +
// combo, added up. Nothing here derives one activity's score from another's —
// the three activities stay exactly as they are and this file does the adding.
// A combo that half-derived its own points would be fighting 0014's trigger,
// which recomputes a score from its marks the moment anything is re-pointed,
// and the number that reaches Canvas is the same either way.

/** One column of the Canvas file: an activity, and what it pays. */
export interface CanvasColumn {
  activity: Activity;
  /** Points on offer. Also what a met completion is worth. */
  worth: number;
  label: string;
}

/**
 * Which activities become columns, and what each is out of.
 *
 * Team-scope activities are not among them: Canvas grades people, and a column
 * every student row would have to leave blank is worse than no column.
 *
 * A completion activity is worth its own points_total. "Complete" is not a
 * number and a gradebook cannot add a word, so the figure faculty already set
 * on the activity is what a met completion pays — deliberately with no second
 * place to keep "what a Complete is worth", because a second place is a place
 * to disagree. An activity nobody has priced comes out as 0, in the bracket in
 * the header as well as in the cells, where it is visible rather than invented.
 *
 * Exported because the screen offering the download shows these columns before
 * anything is written: a 0 in a header is the one problem with this file that
 * is much cheaper to see beforehand than to find in Canvas afterwards.
 */
export function canvasColumns(activities: Activity[], checkIns: CheckIn[]): CanvasColumn[] {
  return activities
    .filter((a) => SCOPE_OF[a.type] !== "team")
    .sort(
      (a, b) =>
        (a.week ?? 0) - (b.week ?? 0) ||
        a.position - b.position ||
        a.title.localeCompare(b.title),
    )
    .map((a) => {
      const ci = checkIns.find((c) => c.activity_id === a.id && c.kind === "individual");
      return {
        activity: a,
        // A completion check-in carries max_points NULL by design (data.ts), so
        // this falls through to the activity for exactly the activities Kelly
        // is exporting.
        worth: ci?.max_points ?? pointsTotal(a),
        label: `${a.title}${isCompletion(a) ? " completion" : ""}`,
      };
    });
}

/**
 * One activity's contribution to one student's row, in points.
 *
 * Blank, never 0, for anything not released. `submitted` and `needs_review` are
 * work that is IN and waiting on a marker, and uploading a 0 against it tells a
 * class it failed something nobody has read yet. A released Not complete IS a
 * 0 — that one was marked, and the answer was no.
 */
function pointsCell(
  col: CanvasColumn,
  student: Student,
  checkIns: CheckIn[],
  results: ResultRow[],
): number | null {
  const cell = cellFor(col.activity, { kind: "student", id: student.id }, checkIns, results, null);
  const r = cell.result;
  if (!r || r.status !== "scored") return null;
  if (r.is_ci) return isCompletionMet(r) ? col.worth : 0;
  return r.score ?? 0;
}

export interface CanvasInput {
  students: Student[];
  /** One week's worth, ordinarily. Whatever is here becomes the columns. */
  activities: Activity[];
  checkIns: CheckIn[];
  results: ResultRow[];
}

/**
 * The file that goes into Canvas.
 *
 * Kelly's columns in Kelly's order — name, email, the total, then the pieces
 * the total is made of. She asked for four and then listed five; five is what
 * she listed and five is what this writes, since the count was the slip and the
 * list was the specification.
 *
 * Matching is on EMAIL, because an SIS id is the other thing Canvas will match
 * on and this app has never held one — there is no column for it anywhere in
 * the schema, so there is nothing honest to put in one. The assumption is said
 * out loud on the screen that offers the download, and every header here is
 * plain English with what it is out of in brackets, so a person whose Canvas
 * matches on something else can map the five columns by hand in a minute.
 */
export function canvasCsv(input: CanvasInput): string {
  const { students, checkIns, results } = input;
  const cols = canvasColumns(input.activities, checkIns);
  const possible = cols.reduce((n, c) => n + c.worth, 0);

  const header = [
    "Student",
    "Email",
    `Total (${possible})`,
    ...cols.map((c) => `${c.label} (${c.worth})`),
  ];

  const body = [...students]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((s) => {
      const cells = cols.map((c) => pointsCell(c, s, checkIns, results));
      const marked = cells.filter((v): v is number => v !== null);
      // Nothing released yet is no total, not a zero. Every cell beside it is
      // blank, and a 0 in that row would be a grade nobody has given.
      const total = marked.length ? marked.reduce((n, v) => n + v, 0) : null;
      return [s.name, s.email ?? "", total, ...cells];
    });

  return toCsv([header, ...body]);
}

/** One student's slots on one activity, as tutorial.ts derives them. */
export interface CheckInGradeRow {
  activityId: string;
  studentId: string;
  slots: StudentMark[];
}

/** The top of both 1-5 scales, from the scale itself rather than from memory. */
const TOP = SCALE[SCALE.length - 1];

/**
 * What one student's slots come to: the AVERAGE of the marked numbers, out of
 * the scale's 5 — Kelly's spec, verbatim: "average of the 4 scores for the
 * day /5". Adding them (4+5+3+4 as 16 of 20) is what this used to do, and it
 * is not the number her gradebook wants.
 *
 * Only a number that was actually marked joins the average — an untouched
 * check-in is not a zero for anybody, so it moves neither the top nor the
 * bottom of the fraction. An absent student's numbers arrive here already
 * zeroed by studentMarks(); who was in the room is decided once, there, and
 * re-deciding it here is precisely the two-functions-one-score bug this file
 * must not add. Null when nothing at all was marked.
 */
function checkInAverage(slots: StudentMark[]): number | null {
  let sum = 0;
  let marked = 0;
  for (const s of slots) {
    for (const v of [s.accuracy, s.discussion]) {
      if (v === null) continue;
      sum += v;
      marked += 1;
    }
  }
  if (!marked) return null;
  return Math.round((sum / marked) * 100) / 100;
}

export interface CheckInGradesInput {
  students: Student[];
  activities: Activity[];
  rows: CheckInGradeRow[];
}

/** One column of the check-in file: an activity, out of the scale's 5. */
export interface CheckInColumn {
  activity: Activity;
  outOf: number;
}

const checkInKey = (activityId: string, studentId: string) => `${activityId} ${studentId}`;

function checkInScores(input: CheckInGradesInput): Map<string, number | null> {
  return new Map(
    input.rows.map(
      (r) => [checkInKey(r.activityId, r.studentId), checkInAverage(r.slots)] as const,
    ),
  );
}

/**
 * Which activities become columns.
 *
 * Exported because the screen offering the download has to know whether a week
 * holds a check-in BEFORE it writes anything, and it has to ask this function
 * rather than one of its own. With no columns this file is not empty — it is the
 * entire roster with a blank Total beside it, which is indistinguishable from
 * having downloaded some other export, and that is precisely what it got
 * mistaken for.
 */
export function checkInColumns(input: CheckInGradesInput): CheckInColumn[] {
  const scored = checkInScores(input);
  return input.activities
    // A tutorial nobody has marked yet is not a column of zeroes, it is a column
    // that does not exist.
    .filter((a) => input.students.some((s) => scored.get(checkInKey(a.id, s.id)) != null))
    // Out of the scale's top whatever was marked: the cell is an average, and
    // an average has one denominator however many slots a team is behind.
    .map((a) => ({ activity: a, outOf: TOP }))
    .sort(
      (a, b) =>
        (a.activity.week ?? 0) - (b.activity.week ?? 0) ||
        a.activity.position - b.activity.position,
    );
}

/**
 * The live check-in, one column per session day: the student's average of the
 * day's marked numbers, out of 5. The Total adds the DAYS, so it is out of 5
 * per column beside it.
 *
 * There is no Absent column, and that is a decision rather than an oversight:
 * both scales start at 1, so a student who was in the room cannot average
 * below 1 on a day that was marked at all. A 0 in this file IS the absence and
 * needs no second column to say so.
 */
export function checkInCsv(input: CheckInGradesInput): string {
  const { students } = input;
  const scored = checkInScores(input);
  const cols = checkInColumns(input);

  const possible = cols.reduce((n, c) => n + c.outOf, 0);
  const header = [
    "Student",
    "Email",
    `Total (${possible})`,
    ...cols.map((c) => `${c.activity.title} (${c.outOf})`),
  ];

  const body = [...students]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((s) => {
      const cells = cols.map((c) => scored.get(checkInKey(c.activity.id, s.id)) ?? null);
      const marked = cells.filter((v): v is number => v !== null);
      const total = marked.length
        ? // Re-rounded: two rounded averages can still add to 8.669999….
          Math.round(marked.reduce((n, v) => n + v, 0) * 100) / 100
        : null;
      return [s.name, s.email ?? "", total, ...cells];
    });

  return toCsv([header, ...body]);
}

/** One uploaded object, as it will appear in the manifest. */
export interface ManifestRow {
  kind: "recording" | "submission" | "photo";
  week: number | null;
  activity: string;
  subject: string;
  path: string;
  detail: string;
  bytes: number | null;
  createdAt: string;
}

/**
 * Every artifact this course holds.
 *
 * Read through the course rather than by path prefix: the prefixes are pinned
 * by the migrations, but the rows are the authority on what exists, and an
 * object filed under an unexpected prefix should still be listed rather than
 * quietly missing from the record of what was deleted.
 *
 * Sizes are honest about what the schema knows. team_resources carries
 * size_bytes (0017); recordings and submission_files do not, so those rows
 * report null rather than a number somebody would later add up and believe.
 * What they do carry is duration and page count, which is the more useful fact
 * about them anyway.
 */
export async function listArtifacts(
  courseId: string,
  roster: Student[],
  teams: TeamWithMembers[],
): Promise<ManifestRow[]> {
  const activities = await selectAll<Activity>((from, to) =>
    db().from("activities").select("*").eq("course_id", courseId).order("id").range(from, to),
  );
  if (!activities.length) return [];
  const activityIds = activities.map((a) => a.id);
  const titleOf = new Map(activities.map((a) => [a.id, a] as const));

  const checkIns = await selectAllIn<CheckIn>(activityIds, (chunk, from, to) =>
    db().from("check_ins").select("*").in("activity_id", chunk).order("id").range(from, to),
  );
  const results = checkIns.length
    ? await selectAllIn<CheckInResult>(
        checkIns.map((c) => c.id),
        (chunk, from, to) =>
          db()
            .from("check_in_results")
            .select("*")
            .in("check_in_id", chunk)
            .order("id")
            .range(from, to),
      )
    : [];

  const activityOfCheckIn = new Map(checkIns.map((c) => [c.id, c.activity_id] as const));
  const studentName = new Map(roster.map((s) => [s.id, s.name] as const));
  const teamName = new Map(teams.map((t) => [t.id, t.name] as const));
  const byResult = new Map(results.map((r) => [r.id, r] as const));

  const place = (resultId: string) => {
    const r = byResult.get(resultId);
    const a = r ? titleOf.get(activityOfCheckIn.get(r.check_in_id) ?? "") : undefined;
    const who = !r
      ? "unknown"
      : r.subject_type === "team"
        ? (teamName.get(r.team_id ?? "") ?? "a team")
        : (studentName.get(r.student_id ?? "") ?? "a student");
    return { week: a?.week ?? null, activity: a?.title ?? "unknown", subject: who };
  };

  const resultIds = results.map((r) => r.id);
  const out: ManifestRow[] = [];

  if (resultIds.length) {
    const audio = await selectAllIn<{
      result_id: string;
      path: string;
      duration_ms: number | null;
      created_at: string;
    }>(resultIds, (chunk, from, to) =>
      db()
        .from("recordings")
        .select("result_id,path,duration_ms,created_at")
        .in("result_id", chunk)
        .order("id")
        .range(from, to),
    );
    for (const a of audio) {
      out.push({
        kind: "recording",
        ...place(a.result_id),
        path: a.path,
        detail: a.duration_ms ? `${Math.round(a.duration_ms / 1000)}s` : "",
        bytes: null,
        createdAt: a.created_at,
      });
    }

    const pdfs = await selectAllIn<{
      result_id: string;
      path: string;
      page_count: number;
      created_at: string;
    }>(resultIds, (chunk, from, to) =>
      db()
        .from("submission_files")
        .select("result_id,path,page_count,created_at")
        .in("result_id", chunk)
        .order("id")
        .range(from, to),
    );
    for (const p of pdfs) {
      out.push({
        kind: "submission",
        ...place(p.result_id),
        path: p.path,
        detail: `${p.page_count} page${p.page_count === 1 ? "" : "s"}`,
        bytes: null,
        createdAt: p.created_at,
      });
    }
  }

  const photos = await selectAllIn<{
    activity_id: string;
    team_id: string;
    title: string;
    path: string;
    size_bytes: number | null;
    created_at: string;
  }>(activityIds, (chunk, from, to) =>
    db()
      .from("team_resources")
      .select("activity_id,team_id,title,path,size_bytes,created_at")
      .in("activity_id", chunk)
      .order("id")
      .range(from, to),
  );
  for (const p of photos) {
    const a = titleOf.get(p.activity_id);
    out.push({
      kind: "photo",
      week: a?.week ?? null,
      activity: a?.title ?? "unknown",
      subject: teamName.get(p.team_id) ?? "a team",
      path: p.path,
      detail: p.title,
      bytes: p.size_bytes,
      createdAt: p.created_at,
    });
  }

  return out.sort(
    (x, y) => (x.week ?? 0) - (y.week ?? 0) || x.activity.localeCompare(y.activity) || x.kind.localeCompare(y.kind),
  );
}

export function manifestCsv(rows: ManifestRow[]): string {
  const header = ["Kind", "Week", "Activity", "Student or team", "Detail", "Size (bytes)", "Uploaded", "Path"];
  const body = rows.map((r) => [
    r.kind,
    r.week ?? "",
    r.activity,
    r.subject,
    r.detail,
    r.bytes ?? "",
    r.createdAt,
    // Last, and kept: it is the only way to find this object again in a bucket
    // dump taken by rclone, which is where the bytes will be if they are
    // anywhere.
    r.path,
  ]);
  return toCsv([header, ...body]);
}

/** Hand a CSV to the browser as a download. */
export function downloadCsv(filename: string, csv: string): void {
  // A BOM, because Excel on Windows reads a UTF-8 CSV as Latin-1 without one
  // and turns every accented name in the roster into mojibake.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked on the next turn of the loop rather than immediately: Safari has
  // not started reading the blob when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
