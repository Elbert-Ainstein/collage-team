// Data access for the student view.
//
// Everything here reads as the signed-in STUDENT. The database decides what is
// visible (supabase/migrations/0006): their own course, their own submissions,
// their own team — never a classmate's individual work. These functions do not
// re-filter for security, they just shape what comes back. The one exception is
// the opens_at check below, which restates a rule RLS already enforces so that
// the schedule is legible in the code a student's screen is actually built from.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError } from "./data";
import type {
  Activity,
  ActivityQuestion,
  CheckIn,
  CheckInResult,
  Course,
  Profile,
  Role,
  Student,
  Team,
} from "./types";

const db = () => requireSupabase();
function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

// ---------------------------------------------------------------- profile
export async function getProfile(): Promise<Profile | null> {
  const { data: auth } = await db().auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;
  const rows = unwrap(
    await db().from("profiles").select("*").eq("id", uid).limit(1),
  ) as Profile[] ?? [];
  return rows[0] ?? null;
}

export async function getRole(): Promise<Role | null> {
  return (await getProfile())?.role ?? null;
}

/**
 * Attach this account to any roster rows carrying its email address. Safe to
 * call on every sign-in: it only ever claims unclaimed rows, and returns how
 * many it took so the UI can explain an empty state.
 */
export async function claimStudentRows(): Promise<number> {
  const { data, error } = await db().rpc("claim_student_rows");
  if (error) throw dbError(error);
  return (data as number) ?? 0;
}

// ------------------------------------------------------------- enrolment
export interface Enrolment {
  student: Student;
  course: Course;
  team: Team | null;
  teammates: Student[];
}

/**
 * Who this student is, in which session, on which team. Returns null when the
 * account has no roster row yet — the instructor has not imported them, or
 * imported them under a different address.
 */
export async function getEnrolment(): Promise<Enrolment | null> {
  const { data: auth } = await db().auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;

  // Ordered, because one account can sit on more than one roster (a student in
  // both AP50A and AP50B). Which session they land in is arbitrary either way,
  // but it must not change between reloads.
  const me = (unwrap(
    await db().from("students").select("*")
      .eq("user_id", uid).order("created_at").limit(1),
  ) as Student[] ?? [])[0];
  if (!me) return null;

  const course = (unwrap(
    await db().from("courses").select("*").eq("id", me.course_id).limit(1),
  ) as Course[] ?? [])[0];
  if (!course) return null;

  // Team membership: RLS only returns rows for teams this student is in.
  const links = unwrap(
    await db().from("team_members").select("team_id,student_id"),
  ) as { team_id: string; student_id: string }[] ?? [];
  const mine = links.find((l) => l.student_id === me.id);

  let team: Team | null = null;
  let teammates: Student[] = [];
  if (mine) {
    team = (unwrap(
      await db().from("teams").select("*").eq("id", mine.team_id).limit(1),
    ) as Team[] ?? [])[0] ?? null;
    const memberIds = links.filter((l) => l.team_id === mine.team_id).map((l) => l.student_id);
    if (memberIds.length) {
      teammates = (unwrap(
        await db().from("students").select("*").in("id", memberIds).order("position"),
      ) as Student[] ?? []);
    }
  }

  return { student: me, course, team, teammates };
}

// ------------------------------------------------------------ assignments
export type AssignmentStatus =
  | "Not started"
  | "Turned in"
  | "Late"
  | "Graded"
  | "Discussing"
  | "Excused";

export interface Assignment {
  activity: Activity;
  /** The individual and team check-ins that belong to this activity. */
  indivCheckIn: CheckIn | null;
  teamCheckIn: CheckIn | null;
  /** This student's result on the individual check-in. */
  myResult: CheckInResult | null;
  /** Their team's result on the team check-in. */
  teamResult: CheckInResult | null;
  status: AssignmentStatus;
  /** The headline grade — the individual one, except for team-only work. */
  grade: string;
  /** The team half's grade on its own, for activities that have both. */
  teamGrade: string;
  submitted: string | null;
}

function statusOf(r: CheckInResult | null, stage: number): AssignmentStatus {
  if (!r || r.status === "none") return stage >= 2 ? "Late" : "Not started";
  switch (r.status) {
    case "scored":
      return "Graded";
    case "needs_review":
    case "submitted":
      return "Turned in";
    case "discussing":
      return "Discussing";
    case "excused":
      return "Excused";
    default:
      return "Not started";
  }
}

function gradeOf(r: CheckInResult | null, ci: CheckIn | null): string {
  if (!r || r.status !== "scored") return "—";
  if (r.is_ci) return "Complete";
  if (r.score == null) return "—";
  return ci?.max_points ? `${r.score} / ${ci.max_points}` : String(r.score);
}

/**
 * Whether a student may see this activity yet.
 *
 * A NULL opens_at means visible, not hidden: every activity authored before
 * scheduling existed has one, and reading NULL as "not open" would empty a live
 * course's assignment list. Faculty opt in to hiding by setting a future
 * instant; `posted` is a faculty-side flag and governs nothing here.
 */
export function isOpenToStudents(activity: Activity, now: Date = new Date()): boolean {
  // Falsy rather than `=== null`: rows reach here through a cast, so an absent
  // column would arrive as undefined and must read as "no schedule set" too.
  if (!activity.opens_at) return true;
  const at = Date.parse(activity.opens_at);
  // An unparseable stamp is a broken row, not a schedule. Treating it as hidden
  // would take work away from a class with nothing on screen to explain why.
  if (Number.isNaN(at)) return true;
  return at <= now.getTime();
}

/**
 * Everything this student owes, newest week first. Scope decides which result
 * drives the row: an individual activity reads their own, a team activity the
 * team's, and a `both` activity leads with the individual one.
 */
export async function listAssignments(enrolment: Enrolment): Promise<Assignment[]> {
  const all = unwrap(
    await db().from("activities").select("*")
      .eq("course_id", enrolment.course.id)
      .order("week", { ascending: false, nullsFirst: false }),
  ) as Activity[] ?? [];

  // RLS already withholds unopened activities; this repeats the test so that a
  // policy someone later loosens cannot quietly put next week's half-written
  // draft on a student's list, and so the rule is readable from the screen it
  // governs. One `now` for the whole list keeps a long fetch from opening an
  // activity partway down it.
  const now = new Date();
  const activities = all.filter((a) => isOpenToStudents(a, now));
  if (!activities.length) return [];

  const checkIns = unwrap(
    await db().from("check_ins").select("*")
      .in("activity_id", activities.map((a) => a.id))
      .order("position"),
  ) as CheckIn[] ?? [];

  const results = checkIns.length
    ? (unwrap(
        await db().from("check_in_results").select("*")
          .in("check_in_id", checkIns.map((c) => c.id)),
      ) as CheckInResult[] ?? [])
    : [];

  return activities.map((activity) => {
    const mine = checkIns.filter((c) => c.activity_id === activity.id);
    const indivCheckIn = mine.find((c) => c.kind === "individual") ?? null;
    const teamCheckIn = mine.find((c) => c.kind === "team") ?? null;

    const myResult =
      results.find(
        (r) => r.check_in_id === indivCheckIn?.id && r.student_id === enrolment.student.id,
      ) ?? null;
    const teamResult =
      results.find(
        (r) => r.check_in_id === teamCheckIn?.id && r.team_id === enrolment.team?.id,
      ) ?? null;

    const lead = activity.type === "amplify" ? teamResult : myResult;
    const leadCheckIn = activity.type === "amplify" ? teamCheckIn : indivCheckIn;

    return {
      activity,
      indivCheckIn,
      teamCheckIn,
      myResult,
      teamResult,
      status: statusOf(lead, activity.stage),
      grade: gradeOf(lead, leadCheckIn),
      teamGrade: gradeOf(teamResult, teamCheckIn),
      submitted: lead?.updated_at ?? null,
    };
  });
}

/**
 * Raised when a write was refused because the stored row moved on after the
 * caller read it — the usual cause being a teammate submitting the team answer
 * from their own laptop mid-discussion.
 *
 * It carries the row as it now stands so the caller can put both versions in
 * front of the student. Throwing without it would only move the data loss from
 * "silent" to "unavoidable".
 */
export class SubmissionConflictError extends Error {
  readonly current: CheckInResult | null;

  constructor(current: CheckInResult | null) {
    super(
      current
        ? "Someone else saved this after you opened it."
        : "This submission was removed after you opened it.",
    );
    this.name = "SubmissionConflictError";
    this.current = current;
  }
}

export function isSubmissionConflict(e: unknown): e is SubmissionConflictError {
  return e instanceof SubmissionConflictError;
}

/** The stored row for one subject, or null. One row at most — unique index. */
async function readResult(
  checkInId: string,
  column: "student_id" | "team_id",
  id: string,
): Promise<CheckInResult | null> {
  const rows = unwrap(
    await db().from("check_in_results").select("*")
      .eq("check_in_id", checkInId).eq(column, id).limit(1),
  ) as CheckInResult[] ?? [];
  return rows[0] ?? null;
}

/**
 * Write a submission, creating the row the first time and updating it after.
 *
 * `expectedUpdatedAt` is the version the caller was editing — the row's
 * `updated_at` as they last read it, or null if they read no row at all. The
 * write only lands on that exact version, so two people who both opened the
 * team answer cannot overwrite each other unseen; the loser gets a
 * SubmissionConflictError holding what is actually stored.
 *
 * Find-then-write rather than upsert: the uniqueness that makes a result unique
 * is expressed as two partial indexes (one per subject), and a partial index
 * cannot be an ON CONFLICT arbiter.
 */
async function submit(
  checkInId: string,
  subject: { subject_type: "student"; student_id: string } | { subject_type: "team"; team_id: string },
  text: string,
  expectedUpdatedAt: string | null,
): Promise<void> {
  const column = subject.subject_type === "student" ? "student_id" : "team_id";
  const id = subject.subject_type === "student" ? subject.student_id : subject.team_id;
  const fields = () => ({ status: "submitted" as const, text, updated_at: new Date().toISOString() });

  if (expectedUpdatedAt === null) {
    // The caller saw no row, so this should be the first submission. If someone
    // got there first the partial unique index rejects the insert, and that
    // rejection is the conflict.
    const { error } = await db().from("check_in_results")
      .insert({ check_in_id: checkInId, ...subject, ...fields() });
    if (!error) return;
    if (!/duplicate key|23505/i.test(error.message)) throw dbError(error);
    throw new SubmissionConflictError(await readResult(checkInId, column, id));
  }

  // .select() is what makes a lost race visible: without a returned row, an
  // UPDATE that matched nothing is indistinguishable from one that succeeded.
  const write = async (expected: string): Promise<boolean> => {
    const rows = unwrap(
      await db().from("check_in_results").update(fields())
        .eq("check_in_id", checkInId).eq(column, id).eq("updated_at", expected)
        .select("id"),
    ) as { id: string }[] ?? [];
    return rows.length > 0;
  };

  if (await write(expectedUpdatedAt)) return;

  const current = await readResult(checkInId, column, id);
  // Whoever moved the row stored the very text we were about to store, so there
  // is nothing to reconcile and nothing anyone can lose by claiming it. This is
  // the ordinary shape of "a mark was placed on the row" (grading bumps
  // updated_at) and of two people submitting the same agreed sentence.
  if (current && current.text === text && (await write(current.updated_at))) return;

  throw new SubmissionConflictError(current);
}

/**
 * The questions of an activity, for the page-mapping step.
 *
 * RLS ("student reads open activity_questions", 0014) already limits this to
 * activities open to them, so there is nothing to re-filter. A database without
 * 0014 has no such table; questions are an enhancement and the hand-in works
 * without them, so that one error degrades to none rather than blanking the
 * screen a student is trying to submit from.
 */
export async function listMyQuestions(activityId: string): Promise<ActivityQuestion[]> {
  try {
    return (
      (unwrap(
        await db().from("activity_questions").select("*")
          .eq("activity_id", activityId)
          .order("position").order("label"),
      ) as ActivityQuestion[] | null) ?? []
    );
  } catch (e) {
    if (/activity_questions/.test(String((e as Error)?.message ?? e))) return [];
    throw e;
  }
}

/**
 * This student's result row for a check-in, creating an empty one if missing.
 *
 * A PDF has to hang off a result row, and the row was only ever created when
 * work was submitted — so there was nothing for an upload to attach to. Created
 * as a DRAFT, which no count treats as handed in, so opening the hand-in screen
 * does not tell the instructor a student has submitted when they have not.
 */
export async function ensureMyResult(checkInId: string, studentId: string): Promise<string> {
  const existing = (unwrap(
    await db().from("check_in_results").select("id")
      .eq("check_in_id", checkInId).eq("student_id", studentId).limit(1),
  ) as { id: string }[] | null) ?? [];
  if (existing.length) return existing[0].id;

  const rows = unwrap(
    await db().from("check_in_results").insert({
      check_in_id: checkInId,
      subject_type: "student",
      student_id: studentId,
      status: "draft",
    }).select("id"),
  ) as { id: string }[];
  return rows[0].id;
}

/**
 * Submit (or re-submit) the student's own work for an activity. Version-checked
 * like the team half: one student with two tabs open loses work the same way.
 */
export async function submitMyWork(
  checkInId: string,
  studentId: string,
  text: string,
  expectedUpdatedAt: string | null,
): Promise<void> {
  await submit(checkInId, { subject_type: "student", student_id: studentId }, text, expectedUpdatedAt);
}

/**
 * Submit the team's work after the discussion — the second half of a check-in.
 * Any member may write it, but only over the version they were looking at: a
 * blind replace is how the discussion's answer disappears when the second
 * member presses Submit on a page they opened ten minutes earlier.
 */
export async function submitTeamWork(
  checkInId: string,
  teamId: string,
  text: string,
  expectedUpdatedAt: string | null,
): Promise<void> {
  await submit(checkInId, { subject_type: "team", team_id: teamId }, text, expectedUpdatedAt);
}
