// Supabase data access for Class Check-ins (v1, no auth).
import { requireSupabase } from "@/lib/supabaseClient";
import type {
  Activity,
  CheckIn,
  CheckInKind,
  CheckInResult,
  CheckInScale,
  Course,
  ResultStatus,
  Student,
  Team,
  TeamSet,
  TeamWithMembers,
} from "./types";

const TINTS = [
  "#0382ed", "#8a3ffc", "#d1449c", "#e8710a", "#1f9d55",
  "#0f9bb0", "#6b47dc", "#c2410c", "#0d7a6f", "#b4237a",
];
export function tintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}
export function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

const db = () => requireSupabase();
function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// ---------------- courses ----------------
export async function listCourses(): Promise<Course[]> {
  return unwrap(await db().from("courses").select("*").order("created_at")) ?? [];
}
export async function createCourse(input: {
  name: string; code?: string; term?: string;
}): Promise<Course> {
  return unwrap(
    await db().from("courses")
      .insert({ name: input.name, code: input.code || null, term: input.term || null })
      .select().single(),
  );
}
export async function deleteCourse(id: string): Promise<void> {
  const { error } = await db().from("courses").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------- students ----------------
export async function listStudents(courseId: string): Promise<Student[]> {
  return unwrap(
    await db().from("students").select("*").eq("course_id", courseId)
      .order("position").order("created_at"),
  ) ?? [];
}
/** Accepts bare names (pasted) or {name, email} entries (imported from a file). */
export async function addStudents(
  courseId: string,
  entries: (string | { name: string; email?: string })[],
  startPos: number,
): Promise<Student[]> {
  const rows = entries.map((e, i) => {
    const { name, email } = typeof e === "string" ? { name: e, email: undefined } : e;
    return {
      course_id: courseId,
      name,
      email: email ?? null,
      position: startPos + i,
      avatar_tint: tintFor(name),
    };
  });
  return unwrap(await db().from("students").insert(rows).select()) ?? [];
}
export async function removeStudent(id: string): Promise<void> {
  const { error } = await db().from("students").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------- activities (one per week) ----------------
export async function listActivities(courseId: string): Promise<Activity[]> {
  return unwrap(
    await db().from("activities").select("*").eq("course_id", courseId)
      .order("week", { nullsFirst: false }).order("position"),
  ) ?? [];
}
export async function createActivity(input: {
  courseId: string; week: number; title: string; topic?: string; datesLabel?: string;
  resubmitMode?: "team" | "individual" | "choice"; sourceText?: string; position?: number;
}): Promise<Activity> {
  return unwrap(
    await db().from("activities").insert({
      course_id: input.courseId,
      week: input.week,
      title: input.title,
      topic: input.topic || null,
      dates_label: input.datesLabel || null,
      resubmit_mode: input.resubmitMode || "team",
      source_text: input.sourceText || null,
      position: input.position ?? input.week,
    }).select().single(),
  );
}
export async function updateActivity(id: string, patch: Partial<Activity>): Promise<void> {
  const { error } = await db().from("activities").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function deleteActivity(id: string): Promise<void> {
  const { error } = await db().from("activities").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------- team sets / teams / membership ----------------
export async function listTeamSets(courseId: string): Promise<TeamSet[]> {
  return unwrap(
    await db().from("team_sets").select("*").eq("course_id", courseId).order("created_at"),
  ) ?? [];
}
export async function createTeamSet(input: {
  courseId: string; activityId?: string | null; name?: string; teamSize?: number | null;
}): Promise<TeamSet> {
  return unwrap(
    await db().from("team_sets").insert({
      course_id: input.courseId,
      activity_id: input.activityId ?? null,
      name: input.name || null,
      team_size: input.teamSize ?? null,
    }).select().single(),
  );
}
export async function setTeamSetLocked(id: string, locked: boolean): Promise<void> {
  const { error } = await db().from("team_sets").update({ locked }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function setTeamSetSize(id: string, teamSize: number): Promise<void> {
  const { error } = await db().from("team_sets").update({ team_size: teamSize }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Teams of a set with their members resolved, ordered. */
export async function listTeams(teamSetId: string, roster: Student[]): Promise<TeamWithMembers[]> {
  const teams = unwrap(
    await db().from("teams").select("*").eq("team_set_id", teamSetId).order("position"),
  ) as Team[] ?? [];
  if (!teams.length) return [];
  const links = unwrap(
    await db().from("team_members").select("team_id,student_id")
      .in("team_id", teams.map((t) => t.id)),
  ) as { team_id: string; student_id: string }[] ?? [];
  const byId = new Map(roster.map((s) => [s.id, s]));
  return teams.map((t) => ({
    ...t,
    members: links
      .filter((l) => l.team_id === t.id)
      .map((l) => byId.get(l.student_id))
      .filter((s): s is Student => Boolean(s))
      .sort((a, b) => a.position - b.position),
  }));
}
export async function createTeam(
  teamSetId: string, name: string, position: number,
): Promise<Team> {
  return unwrap(
    await db().from("teams").insert({ team_set_id: teamSetId, name, position }).select().single(),
  );
}
export async function renameTeam(id: string, name: string): Promise<void> {
  const { error } = await db().from("teams").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function deleteTeam(id: string): Promise<void> {
  const { error } = await db().from("teams").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
export async function deleteTeamsOfSet(teamSetId: string): Promise<void> {
  const { error } = await db().from("teams").delete().eq("team_set_id", teamSetId);
  if (error) throw new Error(error.message);
}
/** Move students into a team (or out to unassigned when teamId is null). */
export async function moveStudents(
  studentIds: string[], teamId: string | null, teamIdsInSet: string[],
): Promise<void> {
  if (!studentIds.length) return;
  const sb = db();
  if (teamIdsInSet.length) {
    const { error } = await sb.from("team_members").delete()
      .in("student_id", studentIds).in("team_id", teamIdsInSet);
    if (error) throw new Error(error.message);
  }
  if (teamId) {
    const { error } = await sb.from("team_members")
      .insert(studentIds.map((student_id) => ({ team_id: teamId, student_id })));
    if (error) throw new Error(error.message);
  }
}
/** Replace a set's teams with evenly-sized ones built from the roster. */
export async function autoFormTeams(
  teamSetId: string, roster: Student[], size: number,
): Promise<void> {
  await deleteTeamsOfSet(teamSetId);
  const NAMES = [
    "Team Helix", "Team Ribosome", "Team Vesicle", "Team Mitosis", "Team Cytosol",
    "Team Axon", "Team Lysosome", "Team Codon", "Team Flagellum", "Team Nucleus",
    "Team Golgi", "Team Plasmid",
  ];
  const chunks: Student[][] = [];
  for (let i = 0; i < roster.length; i += size) chunks.push(roster.slice(i, i + size));
  for (let i = 0; i < chunks.length; i++) {
    const team = await createTeam(teamSetId, NAMES[i] ?? `Team ${i + 1}`, i);
    await moveStudents(chunks[i].map((s) => s.id), team.id, []);
  }
}

// ---------------- check-ins ----------------
export async function listCheckIns(activityIds: string[]): Promise<CheckIn[]> {
  if (!activityIds.length) return [];
  return unwrap(
    await db().from("check_ins").select("*").in("activity_id", activityIds).order("position"),
  ) ?? [];
}
export async function createCheckIn(input: {
  activityId: string; label: string; kind: CheckInKind; phase?: string;
  scale?: CheckInScale; maxPoints?: number | null; position?: number;
}): Promise<CheckIn> {
  return unwrap(
    await db().from("check_ins").insert({
      activity_id: input.activityId,
      label: input.label,
      kind: input.kind,
      phase: input.phase || "Readiness",
      scale: input.scale || "points",
      max_points: input.scale === "ci" ? null : (input.maxPoints ?? 10),
      position: input.position ?? 0,
    }).select().single(),
  );
}
export async function deleteCheckIn(id: string): Promise<void> {
  const { error } = await db().from("check_ins").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
export async function setCheckInsPosted(ids: string[], posted: boolean): Promise<void> {
  if (!ids.length) return;
  const { error } = await db().from("check_ins").update({ posted }).in("id", ids);
  if (error) throw new Error(error.message);
}

// ---------------- results (gradebook cells) ----------------
export async function listResults(checkInIds: string[]): Promise<CheckInResult[]> {
  if (!checkInIds.length) return [];
  return unwrap(
    await db().from("check_in_results").select("*").in("check_in_id", checkInIds),
  ) ?? [];
}
/**
 * Save one cell, keyed by (check_in, subject).
 *
 * Deliberately find-then-write rather than upsert: the uniqueness of a cell is
 * enforced by PARTIAL indexes (…where subject_type = 'student'), and Postgres
 * cannot infer a partial index as an ON CONFLICT arbiter without its predicate,
 * which PostgREST cannot express. Two round trips, but correct.
 */
export async function saveResult(input: {
  checkInId: string;
  subject: { type: "student"; id: string } | { type: "team"; id: string };
  status: ResultStatus;
  score?: number | null;
  isCi?: boolean;
  text?: string | null;
  transcription?: string | null;
  transcriptionState?: "none" | "auto" | "confirmed";
  flagged?: boolean;
}): Promise<CheckInResult> {
  const sb = db();
  const isStudent = input.subject.type === "student";
  const fields = {
    status: input.status,
    score: input.score ?? null,
    is_ci: input.isCi ?? false,
    text: input.text ?? null,
    transcription: input.transcription ?? null,
    transcription_state: input.transcriptionState ?? "none",
    flagged: input.flagged ?? false,
    updated_at: new Date().toISOString(),
  };

  const existing = unwrap(
    await sb.from("check_in_results").select("id")
      .eq("check_in_id", input.checkInId)
      .eq(isStudent ? "student_id" : "team_id", input.subject.id)
      .limit(1),
  ) as { id: string }[] ?? [];

  if (existing.length) {
    return unwrap(
      await sb.from("check_in_results").update(fields).eq("id", existing[0].id)
        .select().single(),
    );
  }
  return unwrap(
    await sb.from("check_in_results").insert({
      check_in_id: input.checkInId,
      subject_type: input.subject.type,
      student_id: isStudent ? input.subject.id : null,
      team_id: isStudent ? null : input.subject.id,
      ...fields,
    }).select().single(),
  );
}
export async function deleteResult(id: string): Promise<void> {
  const { error } = await db().from("check_in_results").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
