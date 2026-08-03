// Data access for the student view.
//
// Everything here reads as the signed-in STUDENT. The database decides what is
// visible (supabase/migrations/0006): their own course, their own submissions,
// their own team — never a classmate's individual work. These functions do not
// re-filter for security, they just shape what comes back.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError } from "./data";
import { scopeOf } from "./types";
import type {
  Activity,
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

  const me = (unwrap(
    await db().from("students").select("*").eq("user_id", uid).limit(1),
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
  grade: string;
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
 * Everything this student owes, newest week first. Scope decides which result
 * drives the row: an individual activity reads their own, a team activity the
 * team's, and a `both` activity leads with the individual one.
 */
export async function listAssignments(enrolment: Enrolment): Promise<Assignment[]> {
  const activities = unwrap(
    await db().from("activities").select("*")
      .eq("course_id", enrolment.course.id)
      .order("week", { ascending: false, nullsFirst: false }),
  ) as Activity[] ?? [];
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

    // A team-only activity has no individual row to lead with.
    const teamOnly = scopeOf(activity) === "team";
    const lead = teamOnly ? teamResult : myResult;
    const leadCheckIn = teamOnly ? teamCheckIn : indivCheckIn;

    return {
      activity,
      indivCheckIn,
      teamCheckIn,
      myResult,
      teamResult,
      status: statusOf(lead, activity.stage),
      grade: gradeOf(lead, leadCheckIn),
      submitted: lead?.updated_at ?? null,
    };
  });
}

/** Submit (or re-submit) the student's own work for an activity. */
export async function submitMyWork(
  checkInId: string,
  studentId: string,
  text: string,
): Promise<void> {
  const existing = unwrap(
    await db().from("check_in_results").select("id")
      .eq("check_in_id", checkInId).eq("student_id", studentId).limit(1),
  ) as { id: string }[] ?? [];

  const fields = { status: "submitted" as const, text, updated_at: new Date().toISOString() };
  const { error } = existing.length
    ? await db().from("check_in_results").update(fields).eq("id", existing[0].id)
    : await db().from("check_in_results").insert({
        check_in_id: checkInId,
        subject_type: "student",
        student_id: studentId,
        ...fields,
      });
  if (error) throw dbError(error);
}
