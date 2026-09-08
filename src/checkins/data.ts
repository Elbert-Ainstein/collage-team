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
 * The widest page this server has actually handed back, learned as we read and
 * shared by every call — the first read of the session pays to measure it and
 * the rest are spared a round trip. It only ever takes a length the server
 * really returned, so it can never exceed the server's true window, which is
 * what makes the short-page test below safe to trust.
 */
let observedWindow = 0;

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
    if (rows.length === 0) return out;
    // A server that ignores the range entirely would loop forever; it cannot
    // return more than it was asked for, so this only fires on a broken server —
    // and it comes first so a length like that never becomes the window.
    if (rows.length > PAGE_SIZE) return out;
    // Do NOT stop merely because a page is shorter than PAGE_SIZE. Supabase's
    // per-project "Max rows" is not pinned in this repo, and if it is ever set
    // below PAGE_SIZE then EVERY page comes back short, first one included — so
    // that test would hand back a fraction of the table and call it the whole
    // thing, which is the bug this exists to kill. Compare against a width the
    // server has proved it will fill instead: a page narrower than one we have
    // already been given is one the server could have filled and didn't, and
    // that only happens when the rows have run out.
    if (rows.length < observedWindow) return out;
    observedWindow = rows.length;
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
/**
 * Rename a course, its section code, or its term.
 *
 * No migration needed: 0003's "own courses" is FOR ALL on owner_id = auth.uid(),
 * so an owner could always have written these columns — nothing ever offered it.
 *
 * The code is what a person reads to tell two sections apart, and 0003's
 * uniq_course_owner_code stops one account holding two of the same. An empty
 * code is stored as NULL rather than "", because that index is partial on
 * `code is not null` and a pile of empty strings would collide.
 */
export async function renameCourse(
  id: string,
  patch: { name?: string; code?: string | null; term?: string | null },
): Promise<void> {
  const next: { name?: string; code?: string | null; term?: string | null } = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    // A course with no name is a blank row in a switcher nobody can identify.
    if (!name) throw new Error("A course needs a name");
    next.name = name;
  }
  if (patch.code !== undefined) next.code = patch.code?.trim() || null;
  if (patch.term !== undefined) next.term = patch.term?.trim() || null;
  if (!Object.keys(next).length) return;

  const { error } = await db().from("courses").update(next).eq("id", id);
  if (error) {
    if (/duplicate key|23505/i.test(error.message)) {
      throw new Error("You already have a course with that code. Give this one a different one.");
    }
    throw dbError(error);
  }
}

export async function deleteCourse(id: string): Promise<void> {
  const { error } = await db().from("courses").delete().eq("id", id);
  if (error) throw dbError(error);
}

/** The course this tool is built for. Its sessions are fixed, not user-created. */
export const COURSE_NAME = "Applied Physics 50";
/**
 * What a brand-new account is given to start with, and nothing more. These were
 * once the only codes the app would show — pickSessions dropped everything else
 * — which is why renaming a course was impossible. A course may now be called
 * whatever its owner calls it.
 */
export const SESSION_CODES = ["AP50A", "AP50B"] as const;


/**
 * The account's courses, oldest first, one per code.
 *
 * It used to KEEP only AP50A and AP50B and drop everything else, which made
 * renaming a course impossible in the worst way: rename the code and the course
 * vanished from the switcher while ensureSessions created a fresh AP50A beside
 * it. The two seeded codes are a starting point, not the set of courses that may
 * exist.
 *
 * Still de-duplicated by code, because 0002 de-duplicates by (owner, code) in
 * the database and a client that disagreed with that would show a row the next
 * reload deletes. A course with no code stands on its own id.
 */
function pickSessions(all: Course[]): Course[] {
  const byKey = new Map<string, Course>();
  for (const c of all) {
    const key = c.code ?? `id:${c.id}`;
    const prev = byKey.get(key);
    if (!prev || c.created_at < prev.created_at) byKey.set(key, c);
  }
  return [...byKey.values()].sort(
    (a, b) => (a.code ?? "").localeCompare(b.code ?? "") || a.created_at.localeCompare(b.created_at),
  );
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
    // getSession, not getUser. getUser() is a NETWORK CALL — auth-js issues
    // GET /user on every invocation with no cache (GoTrueClient _getUser) — and
    // four of them sat in series on the cold path, each returning a user the app
    // was already holding. getSession() reads local storage.
    //
    // Safe because the uid here only SHAPES a query, never authorises one. Every
    // request carries the JWT and Postgres re-derives auth.uid() from it, so a
    // tampered local session buys nothing: it just builds a query RLS refuses.
    const { data: auth } = await sb.auth.getSession();
    const ownerId = auth.session?.user.id;
    if (!ownerId) throw new Error("Not signed in.");

    // RLS already limits reads to this account; owner_id is set explicitly so
    // the row passes the WITH CHECK on insert.
    // OWNED, not merely visible. listCourses reads through three SELECT policies
    // — your own (0003), one you are enrolled on (0006), one you are a TF on
    // (0007) — so "did anything come back" is not the same question as "have you
    // been set up". A new instructor who is already a TF on a colleague's course
    // would otherwise be told she was provisioned and handed that colleague's
    // course as though it were hers.
    const visible = await listCourses();
    const existing = visible.filter((c) => c.owner_id === ownerId);

    // BOOTSTRAP ONCE, not forever. This used to re-provision whichever of
    // AP50A/AP50B it could not see, which meant renaming a course silently grew
    // a replacement for it on the next load — and deleting one you did not want
    // was impossible, because it came straight back.
    //
    // An account that owns any course has been set up. What it owns after that
    // is its own business.
    if (existing.length) return pickSessions(existing);
    const missing = [...SESSION_CODES];

    const { error } = await sb
      .from("courses")
      .insert(missing.map((code) => ({ name: COURSE_NAME, code, term, owner_id: ownerId })));
    // 23505 = unique_violation: another caller won the race, which is fine.
    if (error && !/duplicate key|23505/i.test(error.message)) throw dbError(error);
    // A silent no-op (RLS filtering the insert away) would otherwise show as an
    // empty workspace rather than a problem.
    const after = pickSessions(
      (await listCourses()).filter((c) => c.owner_id === ownerId),
    );
    if (!after.length) {
      throw new Error(
        "Signed in, but the first sessions could not be created. The database refused them — " +
          "check that migrations 0003-0005 have been run in Supabase.",
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
/**
 * Rename a roster row.
 *
 * The name is the one field of a student that nothing else can repair. An
 * address is fixable because it identifies the row, so a later import can find
 * the row and fill it in; a name is only ever displayed, so an import that
 * matches on address leaves whatever is there — and a class list that was not
 * saved as UTF-8 puts a replacement character in the middle of somebody's name
 * for the rest of the term. Deleting the row and re-adding it takes their
 * submissions with it, so this is the repair.
 *
 * user_id is untouched, which is what keeps 0028's identity guard out of it:
 * this renames who the row is CALLED, never whose account it is.
 */
export async function setStudentName(id: string, name: string): Promise<void> {
  const next = name.trim();
  if (!next) throw new Error("A roster row needs a name.");
  const { error } = await db().from("students").update({ name: next }).eq("id", id);
  if (error) throw dbError(error);
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
  // Team 1, Team 2. There was a list of cell-biology names here — Helix,
  // Ribosome, Vesicle — and they read well on a design mock and badly in a room:
  // a TF calling out a team, an instructor reading a roster, and a CSV of team
  // NUMBERS all want the number, and nobody could tell whether Golgi came before
  // or after Plasmid. Renaming one to something meaningful is still there for
  // anyone who wants it; it is just no longer the default nobody chose.
  const chunks: Student[][] = [];
  for (let i = 0; i < roster.length; i += size) chunks.push(roster.slice(i, i + size));
  for (let i = 0; i < chunks.length; i++) {
    const team = await createTeam(teamSetId, `Team ${i + 1}`, i);
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
/**
 * Everything about a result EXCEPT the bulk text.
 *
 * `text` is a student's whole written answer, `transcription` is a whole
 * recording turned into words, and `files` is a JSON blob. Together they are
 * nearly all of a row's width — and the faculty app reads none of them off this
 * list. It reads status, score, whose it is, and when.
 *
 * That matters because this list is re-read by FacultyApp.refresh(), which is
 * wired to onChanged and so fires after every rubric pick, every release, every
 * note save and every visibility toggle. Sending a term of written answers down
 * the wire so a screen can count how many people have handed in is the widest
 * thing this app does, and it did it on a keystroke's worth of provocation.
 *
 * Anything that genuinely needs a student's words fetches that one submission
 * when it opens it, which is the only moment it could display them anyway.
 */
const RESULT_COLS =
  "id,check_in_id,subject_type,student_id,team_id,status,score,is_ci,ci_met," +
  "flagged,feedback,submitted_at,updated_at,transcription_state";

export type ResultRow = Omit<CheckInResult, "text" | "transcription" | "files">;

export async function listResults(checkInIds: string[]): Promise<ResultRow[]> {
  if (!checkInIds.length) return [];
  return selectAllIn<ResultRow>(checkInIds, (chunk, from, to) =>
    // Cast because select() with a runtime string cannot be typed from the
    // literal; RESULT_COLS above is the definition of what comes back.
    db().from("check_in_results").select(RESULT_COLS).in("check_in_id", chunk)
      .order("id")
      .range(from, to) as unknown as PagedRead<ResultRow>,
  );
}

/** The full row, text and all, for the one caller that renders a person's words. */
export async function listResultsFull(checkInIds: string[]): Promise<CheckInResult[]> {
  if (!checkInIds.length) return [];
  return selectAllIn<CheckInResult>(checkInIds, (chunk, from, to) =>
    db().from("check_in_results").select("*").in("check_in_id", chunk).order("id").range(from, to),
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
/**
 * Give every named student a row on this check-in, for a half that is answered
 * on another platform.
 *
 * Grading reads the people who handed something in, which is the right rule
 * everywhere a hand-in is what happens — and no rule at all on an Amplify
 * individual half, where nothing is ever handed in here and the marker is
 * reading the answers on Amplify. Without a row there is nothing for a mark to
 * be filed against, so the screen shows an empty class and the half cannot be
 * graded at all.
 *
 * The rows go in at status "none", which is the same empty row a student makes
 * by opening their hand-in: it holds nothing, it is not "work" to any count or
 * export (those all ask for status <> 'none'), and the first mark fills it in.
 *
 * Only the missing ones, so this is safe to run whenever the screen opens.
 */
export async function openResultsFor(
  checkInId: string,
  studentIds: string[],
): Promise<number> {
  if (!studentIds.length) return 0;
  const sb = db();
  const existing = await selectAllIn<{ student_id: string | null }>(
    studentIds,
    (chunk, from, to) =>
      sb.from("check_in_results").select("student_id")
        .eq("check_in_id", checkInId).in("student_id", chunk)
        .order("student_id").range(from, to),
  );
  const have = new Set(existing.map((r) => r.student_id));
  const missing = studentIds.filter((id) => !have.has(id));
  if (!missing.length) return 0;

  const { error } = await sb.from("check_in_results").insert(
    missing.map((student_id) => ({
      check_in_id: checkInId,
      subject_type: "student",
      student_id,
      team_id: null,
      status: "none",
    })),
  );
  if (error) throw dbError(error);
  return missing.length;
}

export async function deleteResult(id: string): Promise<void> {
  const { error } = await db().from("check_in_results").delete().eq("id", id);
  if (error) throw dbError(error);
}
