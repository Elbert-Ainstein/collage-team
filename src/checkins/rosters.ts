// Who was on which team, for each activity — frozen by the database (0045).
//
// A check-in mark is written against a team ROW and scored against whoever is
// on it. Reading "whoever is on it" off today's team_members is what credited
// Kelly's earlier weeks to the teams she formed afterwards. The database now
// freezes an activity's teams the first time anything is recorded against
// them, and every screen that says who a mark or a hand-in belongs to asks here
// first, falling back to today's teams only for an activity nothing has been
// recorded on yet.
//
// Nothing here writes a roster except refreezeRoster, which is the sheet's
// explicit "use today's teams" — the freeze itself is the database's, so no
// path that records a mark can forget to make it.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError, selectAll, selectAllIn } from "./data";
import type { Student, Team, TeamWithMembers } from "./types";

/** One student's team for one activity. */
export interface ActivityRoster {
  activity_id: string;
  team_id: string;
  student_id: string;
  /** When the activity's teams were frozen — the first thing recorded on it. */
  frozen_at: string;
}

const db = () => requireSupabase();

/**
 * A database without 0045 has no table. That is the world before this fix —
 * every activity follows today's teams — so it reads as "nothing frozen", not
 * as a broken screen.
 */
function missingTable(e: unknown): boolean {
  return /activity_rosters|refreeze_activity_roster/.test(String((e as Error)?.message ?? e));
}

const COLS = "activity_id,team_id,student_id,frozen_at";

/** Every frozen row for these activities. Staff only — RLS. */
export async function listRosters(activityIds: string[]): Promise<ActivityRoster[]> {
  if (!activityIds.length) return [];
  try {
    return await selectAllIn<ActivityRoster>(activityIds, (chunk, from, to) =>
      db().from("activity_rosters").select(COLS).in("activity_id", chunk)
        .order("activity_id").order("student_id")
        .range(from, to),
    );
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

/** This student's own rows: which team they were on for each activity. */
export async function listMyRosters(studentId: string): Promise<ActivityRoster[]> {
  try {
    return await selectAll<ActivityRoster>((from, to) =>
      db().from("activity_rosters").select(COLS).eq("student_id", studentId)
        .order("activity_id")
        .range(from, to),
    );
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

/** Team rows by id, whichever set they are in. */
export async function listTeamsByIds(ids: string[]): Promise<Team[]> {
  if (!ids.length) return [];
  return selectAllIn<Team>(ids, (chunk, from, to) =>
    db().from("teams").select("*").in("id", chunk).order("id").range(from, to),
  );
}

/**
 * Put today's teams (from `teamSetId`) on an activity's sheet, replacing what
 * was frozen. One call, one transaction — see 0045.
 */
export async function refreezeRoster(activityId: string, teamSetId: string): Promise<void> {
  const { error } = await db().rpc("refreeze_activity_roster", { aid: activityId, set_id: teamSetId });
  if (error) {
    if (missingTable(error)) {
      throw new Error(
        "This needs supabase/migrations/0045_activity_rosters.sql — run it in the Supabase SQL editor.",
      );
    }
    throw dbError(error);
  }
}

// --------------------------------------------------------------- pure parts

const byPosition = (a: Pick<Team, "position" | "name">, b: Pick<Team, "position" | "name">) =>
  a.position - b.position || a.name.localeCompare(b.name);

/**
 * The frozen teams of every activity in `rows`, with their members resolved.
 *
 * A team the rows name but `teamRows` does not hold still appears, under a
 * plain name: its marks are real, and leaving it off the sheet would hide them.
 * A frozen student who has since left the roster is dropped — there is nobody
 * to show — but their team stays.
 */
export function frozenTeams(
  rows: ActivityRoster[],
  teamRows: Team[],
  roster: Student[],
): Map<string, TeamWithMembers[]> {
  const team = new Map(teamRows.map((t) => [t.id, t]));
  const student = new Map(roster.map((s) => [s.id, s]));
  const grouped = new Map<string, Map<string, Student[]>>();
  for (const r of rows) {
    const teams = grouped.get(r.activity_id) ?? new Map<string, Student[]>();
    grouped.set(r.activity_id, teams);
    const members = teams.get(r.team_id) ?? [];
    teams.set(r.team_id, members);
    const s = student.get(r.student_id);
    if (s) members.push(s);
  }
  const out = new Map<string, TeamWithMembers[]>();
  for (const [activityId, teams] of grouped) {
    out.set(
      activityId,
      [...teams].map(([teamId, members], i) => {
        const row: Team = team.get(teamId) ?? {
          id: teamId,
          team_set_id: "",
          name: "Team",
          position: 10_000 + i,
          created_at: "",
        };
        return { ...row, members: [...members].sort((a, b) => a.position - b.position) };
      }).sort(byPosition),
    );
  }
  return out;
}

/**
 * The teams an activity's work belongs to: frozen, or — when nothing has been
 * recorded on it yet — today's.
 */
export function teamsForActivity(
  frozen: Map<string, TeamWithMembers[]> | undefined,
  activityId: string,
  current: TeamWithMembers[],
): TeamWithMembers[] {
  return frozen?.get(activityId) ?? current;
}

/**
 * The same, off the faculty app's data. Every per-activity screen reads teams
 * through this, so an old week keeps showing the teams that did it.
 */
export function teamsOf(
  data: { frozenTeams?: Map<string, TeamWithMembers[]>; teams: TeamWithMembers[] },
  activityId: string,
): TeamWithMembers[] {
  return teamsForActivity(data.frozenTeams, activityId, data.teams);
}

/**
 * Every team any activity's work is filed under — today's, then the frozen
 * ones from earlier sets — each once. For anything that names a team from a
 * bare team id, where a team from last month's set is still a real name.
 */
export function allTeamsOf(data: {
  frozenTeams?: Map<string, TeamWithMembers[]>;
  teams: TeamWithMembers[];
}): TeamWithMembers[] {
  const out = new Map(data.teams.map((t) => [t.id, t]));
  for (const teams of data.frozenTeams?.values() ?? []) {
    for (const t of teams) if (!out.has(t.id)) out.set(t.id, t);
  }
  return [...out.values()];
}

/** Student id → team id, for one list of teams. The first team wins a tie. */
export function teamIdsOf(teams: TeamWithMembers[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of teams) for (const m of t.members) if (!out.has(m.id)) out.set(m.id, t.id);
  return out;
}

/** When this activity's teams were frozen, or null when they are not. */
export function frozenAt(rows: ActivityRoster[], activityId: string): string | null {
  let first: string | null = null;
  for (const r of rows) {
    if (r.activity_id !== activityId) continue;
    if (first === null || Date.parse(r.frozen_at) < Date.parse(first)) first = r.frozen_at;
  }
  return first;
}

/** Who sits differently on today's teams than on the frozen ones. */
export interface RosterDrift {
  /** Every frozen team is still one of today's rows — the same set, membership moved. */
  sameTeams: boolean;
  /** Students whose team today is not the one frozen for the activity. */
  moved: Student[];
}

export function rosterDrift(frozen: TeamWithMembers[], current: TeamWithMembers[]): RosterDrift {
  const today = new Set(current.map((t) => t.id));
  const sameTeams = frozen.length > 0 && frozen.every((t) => today.has(t.id));
  const was = teamIdsOf(frozen);
  const now = teamIdsOf(current);
  const people = new Map<string, Student>();
  for (const t of [...frozen, ...current]) for (const m of t.members) people.set(m.id, m);
  const moved = [...people.values()]
    .filter((s) => was.get(s.id) !== now.get(s.id))
    .sort((a, b) => a.position - b.position);
  return { sameTeams, moved };
}

/**
 * How long after the first mark the sheet still offers "use today's teams".
 *
 * The case it exists for is the session itself: somebody moved after the first
 * team was marked — a late arrival put on a team, a student who sat with the
 * wrong one. A day later the same button would do the opposite of its job: it
 * would hand last week's marks to whoever is on the teams now, which is the bug
 * this whole table was made to stop.
 */
export const RESYNC_WINDOW_MS = 12 * 60 * 60 * 1000;

export function offerResync(frozenAtIso: string | null, now: Date = new Date()): boolean {
  if (!frozenAtIso) return false;
  const at = Date.parse(frozenAtIso);
  return !Number.isNaN(at) && now.getTime() - at <= RESYNC_WINDOW_MS;
}
