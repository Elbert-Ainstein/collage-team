// Taking a term out of the app.
//
// WHY THIS EXISTS. Supabase's daily backups cover Postgres and NOTHING ELSE —
// their own words: "Database backups do not include objects you store via the
// Storage API, as the database only includes metadata about these objects." So
// the grades have a seven-day safety net and the recordings, hand-ins and
// whiteboard photos have none at all.
//
// Two files come out of here, and they answer different questions.
//
//   GRADES     what everyone got. The record of record, and the thing a faculty
//              member wants at the end of a term regardless of any of this. It
//              is also the copy that survives if this app does not.
//
//   MANIFEST   what was handed in. One row per uploaded object, with who, what
//              it answered, and when. This is the one that matters after the
//              artifacts are cleared: the bytes are gone, but the record of
//              what existed is not, and "what did you delete" stops being an
//              unanswerable question.
//
// Neither of these is the bytes. 22 GB cannot come down through a browser, and
// Vercel caps a request body at 4.5 MB so nothing can proxy it either. Pulling
// the objects themselves is rclone against Supabase's S3-compatible endpoint —
// docs/backup-runbook.md — and it is a thing a person runs, not a button.

import { requireSupabase } from "@/lib/supabaseClient";
import { selectAll, selectAllIn,
  type ResultRow,
} from "@/checkins/data";
import { isCompletionMet } from "@/checkins/studentData";
import type {
  Activity,
  ActivityQuestion,
  CheckIn,
  CheckInResult,
  Course,
  Student,
  TeamWithMembers,
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
