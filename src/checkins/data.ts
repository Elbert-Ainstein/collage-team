// Supabase data access for Class Check-ins. Every read and write is scoped to
// the signed-in account by row-level security (see supabase/migrations/0003+).
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

/**
 * Turns Postgres constraint errors into something a person can act on.
 * The common one: the page holds students that have since been deleted (another
 * tab, another person), so writing team membership trips the foreign key.
 */
export function dbError(error: { message: string }): Error {
  const m = error.message;
  if (/foreign key constraint/i.test(m)) {
    if (/team_members_student_id/i.test(m)) {
      return new Error(
        "Some of these students are no longer on the roster — it changed somewhere else. " +
          "Reload the page and try again.",
      );
    }
    return new Error("That referred to something that no longer exists. Reload and try again.");
  }
  if (/duplicate key|23505/i.test(m)) {
    return new Error("That already exists.");
  }
  if (/row-level security policy for table "courses"/i.test(m)) {
    return new Error(
      "Couldn't create your AP 50 sessions. This usually means the page is an " +
        "older build that predates accounts, or the sign-in has lapsed — reload, " +
        "and sign out and back in if it persists.",
    );
  }
  if (/row-level security|permission denied|JWT/i.test(m)) {
    return new Error("You don't have access to that — try signing out and back in.");
  }
  return new Error(m);
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

// ---------------- paging ----------------
//
// PostgREST answers any select with at most 1000 rows and says NOTHING when it
// truncates: no error, no flag, just a short array that looks like the whole
// table. That ceiling is not theoretical for this app. check_in_results grows as
// students x check-ins: 16 students x 2 check-ins per activity x 4 activities a
// week x 12 weeks = 1536 rows for ONE session, and every account is provisioned
// two sessions (AP50A and AP50B), so ~3072. A gradebook built on an unbounded
// read would quietly lose a third of the term partway through the first course,
// and the "this will delete N submissions" confirms would undercount — which
// makes a safety prompt lie about what it is about to destroy.

/** The server's per-request row ceiling; a response this long may be truncated. */
const PAGE_SIZE = 1000;

/**
 * Longest id list allowed in one `.in(...)`. The filter travels in the URL and a
 * uuid costs ~39 bytes there, so 100 keeps a request near 4 KB — well inside the
 * 8 KB request-line limit that proxies in front of PostgREST commonly enforce.
 */
const IN_CHUNK = 100;

type PagedRead<Row> = PromiseLike<{
  data: Row[] | null;
  error: { message: string } | null;
}>;

type CountRead = PromiseLike<{
  count: number | null;
  error: { message: string } | null;
}>;

/**
 * Reads every row of a select, a window at a time, until a short page proves the
 * end.
 *
 * The caller supplies a factory rather than a query because a PostgREST builder
 * can only be awaited once — each page needs a fresh one.
 *
 * Every paged query must end in a totally-ordered sort. Rows tied on the sort
 * key can land on either side of a page boundary and so be fetched twice or
 * skipped, which is why each call site finishes its `.order()` chain with `id`.
 */
export async function selectAll<Row>(
  page: (from: number, to: number) => PagedRead<Row>,
): Promise<Row[]> {
  const out: Row[] = [];
  for (;;) {
    const res = await page(out.length, out.length + PAGE_SIZE - 1);
    if (res.error) throw dbError(res.error);
    const rows = res.data ?? [];
    out.push(...rows);
    // Stop on an EMPTY page, not a short one. Supabase's per-project "Max rows"
    // is not pinned in this repo, and if it is ever set below PAGE_SIZE the
    // very first page comes back short — a short-page test would then return
    // early and silently truncate again, which is the bug this exists to kill.
    if (rows.length === 0) return out;
    // A server that ignores the range entirely would loop forever; it cannot
    // return more than it was asked for, so this only fires on a broken server.
    if (rows.length > PAGE_SIZE) return out;
  }
}

/**
 * Splits an id list into `.in(...)` filters short enough to survive the URL.
 *
 * De-duplicated first: a single `.in(...)` is duplicate-safe, but chunking is
 * not — the same id in two chunks returns its rows twice and counts them twice,
 * and these counts gate destructive confirms, so a wrong number lies to the
 * person about what they are about to delete.
 */
function chunkIds(ids: string[]): string[][] {
  const unique = Array.from(new Set(ids));
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) out.push(unique.slice(i, i + IN_CHUNK));
  return out;
}

/** `selectAll` over a chunked `.in(...)` list; each chunk is paged in full. */
export async function selectAllIn<Row>(
  ids: string[],
  page: (chunk: string[], from: number, to: number) => PagedRead<Row>,
): Promise<Row[]> {
  const out: Row[] = [];
  for (const chunk of chunkIds(ids)) {
    out.push(...(await selectAll<Row>((from, to) => page(chunk, from, to))));
  }
  return out;
}

/**
 * An exact row count from the server. Counts gate destructive confirms, so they
 * are asked for with head+count rather than fetched and measured with `.length`:
 * one round trip, and nothing that can be truncated on the way back.
 */
export async function countAll(query: CountRead): Promise<number> {
  const res = await query;
  if (res.error) throw dbError(res.error);
  if (res.count === null) {
    // Reporting a missing count as 0 would tell someone "this deletes nothing".
    throw new Error("The database didn't return a count for that. Reload and try again.");
  }
  return res.count;
}

/**
 * `countAll` over a chunked `.in(...)` list. Summing is exact because the chunks
 * partition the id list and each row matches on a single id, so no row is
 * counted twice.
 */
export async function countAllIn(
  ids: string[],
  query: (chunk: string[]) => CountRead,
): Promise<number> {
  let total = 0;
  for (const chunk of chunkIds(ids)) total += await countAll(query(chunk));
  return total;
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
  if (error) throw dbError(error);
}

/** The course this tool is built for. Its sessions are fixed, not user-created. */
export const COURSE_NAME = "Applied Physics 50";
export const SESSION_CODES = ["AP50A", "AP50B"] as const;

const isSessionCode = (code: string | null): code is (typeof SESSION_CODES)[number] =>
  SESSION_CODES.includes((code ?? "") as (typeof SESSION_CODES)[number]);

/** One row per code, oldest wins — mirrors the DB rule in migration 0002. */
function pickSessions(all: Course[]): Course[] {
  const byCode = new Map<string, Course>();
  for (const c of all) {
    if (!isSessionCode(c.code)) continue;
    const prev = byCode.get(c.code);
    if (!prev || c.created_at < prev.created_at) byCode.set(c.code, c);
  }
  return SESSION_CODES.map((code) => byCode.get(code)).filter((c): c is Course => Boolean(c));
}

/** In-flight provisioning, so concurrent callers share one attempt. */
let sessionsInFlight: Promise<Course[]> | null = null;

/**
 * Guarantees the two AP 50 sessions exist and returns them in order. The app is
 * single-course, so sessions are provisioned rather than created by hand.
 *
 * Concurrent callers are a real case (React's dev double-invoke, two tabs, two
 * people opening at once). Three guards: callers share one in-flight promise, a
 * duplicate-key rejection from the DB is treated as success, and the read
 * de-duplicates by code — so a race can never surface two AP50A sessions.
 */
export async function ensureSessions(term = "Fall"): Promise<Course[]> {
  if (sessionsInFlight) return sessionsInFlight;
  sessionsInFlight = (async () => {
    const sb = db();
    const { data: auth } = await sb.auth.getUser();
    const ownerId = auth.user?.id;
    if (!ownerId) throw new Error("Not signed in.");

    // RLS already limits reads to this account; owner_id is set explicitly so
    // the row passes the WITH CHECK on insert.
    const existing = await listCourses();
    const missing = SESSION_CODES.filter((code) => !existing.some((c) => c.code === code));
    if (!missing.length) return pickSessions(existing);

    const { error } = await sb
      .from("courses")
      .insert(missing.map((code) => ({ name: COURSE_NAME, code, term, owner_id: ownerId })));
    // 23505 = unique_violation: another caller won the race, which is fine.
    if (error && !/duplicate key|23505/i.test(error.message)) throw dbError(error);
    // A silent no-op (RLS filtering the insert away) would otherwise show as an
    // empty workspace rather than a problem.
    const after = pickSessions(await listCourses());
    if (!after.length) {
      throw new Error(
        "Signed in, but no AP 50 sessions came back. The database rejected them — " +
          "check that migrations 0003–0005 have been run in Supabase.",
      );
    }
    return after;
  })();
  try {
    return await sessionsInFlight;
  } finally {
    sessionsInFlight = null;
  }
}

// ---------------- students ----------------
export async function listStudents(courseId: string): Promise<Student[]> {
  return selectAll<Student>((from, to) =>
    db().from("students").select("*").eq("course_id", courseId)
      .order("position").order("created_at").order("id")
      .range(from, to),
  );
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
/** Set or clear a student's email — the address their account links against. */
export async function setStudentEmail(id: string, email: string | null): Promise<void> {
  const { error } = await db()
    .from("students")
    .update({ email: email && email.trim() ? email.trim() : null })
    .eq("id", id);
  if (error) throw dbError(error);
}

export async function removeStudent(id: string): Promise<void> {
  const { error } = await db().from("students").delete().eq("id", id);
  if (error) throw dbError(error);
}

// ---------------- activities (one per week) ----------------
export async function listActivities(courseId: string): Promise<Activity[]> {
  return selectAll<Activity>((from, to) =>
    db().from("activities").select("*").eq("course_id", courseId)
      .order("week", { nullsFirst: false }).order("position").order("id")
      .range(from, to),
  );
}
export async function createActivity(input: {
  courseId: string; week: number; title: string; topic?: string; datesLabel?: string;
  resubmitMode?: "team" | "individual" | "choice"; sourceText?: string; position?: number;
  /**
   * When students may see it. Set on the INSERT, never on a follow-up write:
   * the column default is NULL, NULL means visible, so an activity created
   * without it is in front of the whole class for the length of a round trip —
   * and stays there permanently if that second write fails.
   */
  opensAt?: string | null;
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
      opens_at: input.opensAt ?? null,
    }).select().single(),
  );
}
export async function updateActivity(id: string, patch: Partial<Activity>): Promise<void> {
  const { error } = await db().from("activities").update(patch).eq("id", id);
  if (error) throw dbError(error);
}
export async function deleteActivity(id: string): Promise<void> {
  const { error } = await db().from("activities").delete().eq("id", id);
  if (error) throw dbError(error);
}

// ---------------- team sets / teams / membership ----------------
export async function listTeamSets(courseId: string): Promise<TeamSet[]> {
  return selectAll<TeamSet>((from, to) =>
    db().from("team_sets").select("*").eq("course_id", courseId)
      .order("created_at").order("id")
      .range(from, to),
  );
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
/**
 * Removes the set, its teams and their memberships (FK cascade). Any team-level
 * results recorded against those teams go with them — callers must say so.
 */
export async function deleteTeamSet(id: string): Promise<void> {
  const { error } = await db().from("team_sets").delete().eq("id", id);
  if (error) throw dbError(error);
}

export async function setTeamSetLocked(id: string, locked: boolean): Promise<void> {
  const { error } = await db().from("team_sets").update({ locked }).eq("id", id);
  if (error) throw dbError(error);
}
export async function setTeamSetSize(id: string, teamSize: number): Promise<void> {
  const { error } = await db().from("team_sets").update({ team_size: teamSize }).eq("id", id);
  if (error) throw dbError(error);
}

/** Teams of a set with their members resolved, ordered. */
export async function listTeams(teamSetId: string, roster: Student[]): Promise<TeamWithMembers[]> {
  const teams = await selectAll<Team>((from, to) =>
    db().from("teams").select("*").eq("team_set_id", teamSetId)
      .order("position").order("id")
      .range(from, to),
  );
  if (!teams.length) return [];
  const links = await selectAllIn<{ team_id: string; student_id: string }>(
    teams.map((t) => t.id),
    (chunk, from, to) =>
      db().from("team_members").select("team_id,student_id")
        .in("team_id", chunk).order("team_id").order("student_id")
        .range(from, to),
  );
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
  if (error) throw dbError(error);
}
export async function deleteTeam(id: string): Promise<void> {
  const { error } = await db().from("teams").delete().eq("id", id);
  if (error) throw dbError(error);
}
export async function deleteTeamsOfSet(teamSetId: string): Promise<void> {
  const { error } = await db().from("teams").delete().eq("team_set_id", teamSetId);
  if (error) throw dbError(error);
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
    if (error) throw dbError(error);
  }
  if (teamId) {
    const { error } = await sb.from("team_members")
      .insert(studentIds.map((student_id) => ({ team_id: teamId, student_id })));
    if (error) throw dbError(error);
  }
}
/**
 * How many recorded results are attached to this set's teams. Re-forming teams
 * deletes the team rows, and check_in_results.team_id cascades — so this is what
 * a re-form would destroy.
 */
/** Recorded results for ONE team — what a per-team delete would cascade away. */
export async function countOneTeamResults(teamId: string): Promise<number> {
  return countAll(
    db().from("check_in_results").select("id", { count: "exact", head: true })
      .eq("team_id", teamId).neq("status", "none"),
  );
}

export async function countTeamResults(teamSetId: string): Promise<number> {
  const teams = await selectAll<{ id: string }>((from, to) =>
    db().from("teams").select("id").eq("team_set_id", teamSetId).order("id").range(from, to),
  );
  if (!teams.length) return 0;
  return countAllIn(teams.map((t) => t.id), (chunk) =>
    db().from("check_in_results").select("id", { count: "exact", head: true })
      .in("team_id", chunk).neq("status", "none"),
  );
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
  const rows = await selectAllIn<CheckIn>(activityIds, (chunk, from, to) =>
    db().from("check_ins").select("*").in("activity_id", chunk)
      .order("position").order("id")
      .range(from, to),
  );
  // Chunking the id list splits the query, so the server's ordering only holds
  // within a chunk. Callers were handed one list ordered by position; keep that.
  return rows.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
  if (error) throw dbError(error);
}
export async function setCheckInsPosted(ids: string[], posted: boolean): Promise<void> {
  if (!ids.length) return;
  const { error } = await db().from("check_ins").update({ posted }).in("id", ids);
  if (error) throw dbError(error);
}

// ---------------- results (gradebook cells) ----------------
export async function listResults(checkInIds: string[]): Promise<CheckInResult[]> {
  if (!checkInIds.length) return [];
  return selectAllIn<CheckInResult>(checkInIds, (chunk, from, to) =>
    db().from("check_in_results").select("*").in("check_in_id", chunk)
      .order("id")
      .range(from, to),
  );
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

  // An UPDATE must carry ONLY what the caller supplied. This used to send a
  // full row with `?? null` defaults for everything omitted, so any caller that
  // did not mention `score` silently erased a released grade — and the same for
  // flagged, transcription and is_ci. Two live callers pass an incomplete set,
  // which made re-saving a submission wipe the mark on it.
  const patch: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  };
  if (input.score !== undefined) patch.score = input.score;
  if (input.isCi !== undefined) patch.is_ci = input.isCi;
  if (input.text !== undefined) patch.text = input.text;
  if (input.transcription !== undefined) patch.transcription = input.transcription;
  if (input.transcriptionState !== undefined) patch.transcription_state = input.transcriptionState;
  if (input.flagged !== undefined) patch.flagged = input.flagged;

  // A new row still wants the full shape, so the columns land at their defaults
  // rather than as nulls the readers would have to cope with.
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
      await sb.from("check_in_results").update(patch).eq("id", existing[0].id)
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
  if (error) throw dbError(error);
}
