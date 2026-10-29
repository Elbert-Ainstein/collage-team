// Reads and writes for live questions (0047).
//
// Everything a client may change goes one of two ways. The instructor's own
// rows — questions, keys, settings — are written directly, under RLS. Anything
// that has to be checked against someone else's rows or the clock — moving the
// phase, a vote, a team's try, scoring — goes through an RPC that checks for
// itself. A database that hasn't run 0047 reads as "no live data" rather than
// failing the page; one that hasn't run 0049 reads as every lock being a
// single try, told nothing until the session closes; one that hasn't run 0051
// reads as teams with no leader, no roll and no explanations.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError, selectAll, selectAllIn } from "@/checkins/data";
import { answerPrint, expressionPrint, expressionVerdicts, type ExpressionPrint } from "./answers";
import type {
  LiveAbsence,
  LiveAttempt,
  LiveExplanation,
  LiveGrading,
  LiveKey,
  LiveKind,
  LiveLeaderVote,
  LiveLock,
  LiveQuestion,
  LiveResponse,
  LiveRosterMember,
  LiveSnapshot,
  LiveState,
  LiveTeamSetup,
  LiveVote,
  LockRule,
  ShowAnswers,
} from "./types";

const db = () => requireSupabase();

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

/** 0047 not run here: the tables simply aren't there. */
const missing = (m: string) => /live_(state|questions|keys|responses|votes|locks|attempts)|schema cache|does not exist/i.test(m);

/** 0049 not run here: no live_attempts, no prints, the one-argument lock_team_answer. */
const before0049 = (m: string) => /live_attempts|prints|lock_team_answer|schema cache|does not exist/i.test(m);

/** 0051 not run here: no leader votes, no setup, no explanations, none of their RPCs. */
const before0051 = (m: string) =>
  /live_leader_votes|live_team_setup|live_explanations|vote_live_leader|confirm_live_leader|set_live_absences|schema cache|does not exist/i.test(m);

/** The longest explanation the database keeps (0051's check). */
export const EXPLANATION_MAX = 8000;

const QUESTION_COLS = "id, activity_id, position, kind, stem, options, unit, figure_path, created_at";
const KEY_COLS = "question_id, activity_id, correct_option, answer, tolerance, accept";

// numeric columns come back as strings from PostgREST on some setups.
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const asKey = (row: Record<string, unknown>): LiveKey => ({
  question_id: row.question_id as string,
  activity_id: row.activity_id as string,
  correct_option: num(row.correct_option),
  answer: num(row.answer),
  tolerance: num(row.tolerance),
  accept: Array.isArray(row.accept) ? (row.accept as string[]) : [],
});
const asQuestion = (row: Record<string, unknown>): LiveQuestion => ({
  ...(row as unknown as LiveQuestion),
  options: Array.isArray(row.options) ? (row.options as string[]) : [],
});

// ------------------------------------------------------------------ read

/** A read that is simply empty on a database without the migration that made it. */
function orEmpty<T>(read: Promise<T[]>, before: (m: string) => boolean): Promise<T[]> {
  return read.catch((e: unknown) => {
    if (e instanceof Error && before(e.message)) return [] as T[];
    throw e;
  });
}

const asAbsence = (row: Record<string, unknown>): LiveAbsence => ({
  activity_id: row.activity_id as string,
  team_id: row.team_id as string,
  student_id: row.student_id as string,
  source: row.source === "roll" ? "roll" : "sheet",
});

/** A roster row, with the name embedded through students' own RLS. */
const asRosterMember = (row: Record<string, unknown>): LiveRosterMember => {
  const who = (Array.isArray(row.students) ? row.students[0] : row.students) as
    | { name?: string | null; avatar_tint?: string | null }
    | null
    | undefined;
  return {
    team_id: row.team_id as string,
    student_id: row.student_id as string,
    name: who?.name ?? null,
    avatar_tint: who?.avatar_tint ?? null,
  };
};

/** Leader votes, setups, absences, roster and explanations (0051); `present` is false without it. */
async function loadTeamSetup(activityId: string): Promise<{
  present: boolean;
  leaderVotes: LiveLeaderVote[];
  setups: LiveTeamSetup[];
  absences: LiveAbsence[];
  roster: LiveRosterMember[];
  explanations: LiveExplanation[];
}> {
  const setupRes = await db().from("live_team_setup").select("*").eq("activity_id", activityId).order("team_id");
  const present = !setupRes.error;
  if (setupRes.error && !before0051(setupRes.error.message)) throw dbError(setupRes.error);
  const [leaderVotes, absences, roster, explanations] = await Promise.all([
    present
      ? selectAll<LiveLeaderVote>((from, to) =>
          db().from("live_leader_votes").select("*").eq("activity_id", activityId)
            .order("team_id").order("student_id").range(from, to),
        )
      : Promise.resolve([] as LiveLeaderVote[]),
    // tutorial_absences is 0016's, and RLS decides how much of it comes back.
    orEmpty(
      selectAll<Record<string, unknown>>((from, to) => {
        // `source` is 0051's column; asking for it without 0051 would fail the read.
        const absences = db().from("tutorial_absences");
        return (present
          ? absences.select("activity_id, team_id, student_id, source")
          : absences.select("activity_id, team_id, student_id")
        ).eq("activity_id", activityId).order("team_id").order("student_id").range(from, to);
      }),
      (m) => /tutorial_absences|schema cache|does not exist/i.test(m),
    ).then((rows) => rows.map(asAbsence)),
    present
      ? selectAll<Record<string, unknown>>((from, to) =>
          db().from("activity_rosters").select("team_id, student_id, students(name, avatar_tint)")
            .eq("activity_id", activityId).order("team_id").order("student_id").range(from, to),
        ).then((rows) => rows.map(asRosterMember))
      : Promise.resolve([] as LiveRosterMember[]),
    present
      ? selectAll<LiveExplanation>((from, to) =>
          db().from("live_explanations").select("question_id, activity_id, body").eq("activity_id", activityId)
            .order("question_id").range(from, to),
        )
      : Promise.resolve([] as LiveExplanation[]),
  ]);
  return {
    present,
    leaderVotes,
    setups: present ? ((setupRes.data ?? []) as LiveTeamSetup[]) : [],
    absences,
    roster,
    explanations,
  };
}

/** One live activity, as much of it as the caller may see; null if it has no live data. */
export async function loadLive(activityId: string): Promise<LiveSnapshot | null> {
  const stateRes = await db().from("live_state").select("*").eq("activity_id", activityId).maybeSingle();
  if (stateRes.error) {
    if (missing(stateRes.error.message)) return null;
    throw dbError(stateRes.error);
  }
  if (!stateRes.data) return null;

  const [questions, keys, responses, votes, locks, attempts, setup] = await Promise.all([
    selectAll<Record<string, unknown>>((from, to) =>
      db().from("live_questions").select(QUESTION_COLS).eq("activity_id", activityId)
        .order("position").order("id").range(from, to),
    ),
    selectAll<Record<string, unknown>>((from, to) =>
      db().from("live_keys").select(KEY_COLS).eq("activity_id", activityId).order("question_id").range(from, to),
    ),
    selectAll<LiveResponse>((from, to) =>
      db().from("live_responses").select("*").eq("activity_id", activityId)
        .order("question_id").order("student_id").range(from, to),
    ),
    selectAll<LiveVote>((from, to) =>
      db().from("live_votes").select("*").eq("activity_id", activityId)
        .order("question_id").order("student_id").range(from, to),
    ),
    selectAll<LiveLock>((from, to) =>
      db().from("live_locks").select("*").eq("activity_id", activityId)
        .order("question_id").order("team_id").range(from, to),
    ),
    orEmpty(
      selectAll<LiveAttempt>((from, to) =>
        db().from("live_attempts").select("*").eq("activity_id", activityId)
          .order("question_id").order("team_id").order("attempt").range(from, to),
      ),
      before0049,
    ),
    loadTeamSetup(activityId),
  ]);

  return {
    state: stateRes.data as LiveState,
    questions: questions.map(asQuestion),
    keys: keys.map(asKey),
    responses,
    votes,
    locks,
    attempts,
    teamSetup: setup.present,
    leaderVotes: setup.leaderVotes,
    setups: setup.setups,
    absences: setup.absences,
    roster: setup.roster,
    explanations: setup.explanations,
  };
}

/** The parts of a snapshot that move while a team picks its leader and takes the roll. */
export type LiveSetupParts = Pick<LiveSnapshot, "leaderVotes" | "setups" | "absences">;

/**
 * Just the leader votes, setups and roll (0051) — three small reads in place of
 * loadLive's dozen, so a room of phones can check every couple of seconds
 * without reading every answer each time. Null without 0051.
 */
export async function loadLiveSetup(activityId: string): Promise<LiveSetupParts | null> {
  const setupRes = await db().from("live_team_setup").select("*").eq("activity_id", activityId).order("team_id");
  if (setupRes.error) {
    if (before0051(setupRes.error.message)) return null;
    throw dbError(setupRes.error);
  }
  const [leaderVotes, absences] = await Promise.all([
    selectAll<LiveLeaderVote>((from, to) =>
      db().from("live_leader_votes").select("*").eq("activity_id", activityId)
        .order("team_id").order("student_id").range(from, to),
    ),
    selectAll<Record<string, unknown>>((from, to) =>
      db().from("tutorial_absences").select("activity_id, team_id, student_id, source").eq("activity_id", activityId)
        .order("team_id").order("student_id").range(from, to),
    ).then((rows) => rows.map(asAbsence)),
  ]);
  return { leaderVotes, setups: (setupRes.data ?? []) as LiveTeamSetup[], absences };
}

/** States and own-answer progress for many activities at once — the Activities list. */
export async function listLiveProgress(activityIds: string[]): Promise<{
  states: LiveState[];
  answers: Array<Pick<LiveResponse, "activity_id" | "student_id" | "question_id">>;
  questionCounts: Map<string, number>;
}> {
  if (activityIds.length === 0) return { states: [], answers: [], questionCounts: new Map() };
  try {
    const [states, answers, questions] = await Promise.all([
      selectAllIn<LiveState>(activityIds, (chunk, from, to) =>
        db().from("live_state").select("*").in("activity_id", chunk).order("activity_id").range(from, to),
      ),
      selectAllIn<Pick<LiveResponse, "activity_id" | "student_id" | "question_id">>(activityIds, (chunk, from, to) =>
        db().from("live_responses").select("activity_id, student_id, question_id").in("activity_id", chunk)
          .order("question_id").order("student_id").range(from, to),
      ),
      selectAllIn<{ id: string; activity_id: string }>(activityIds, (chunk, from, to) =>
        db().from("live_questions").select("id, activity_id").in("activity_id", chunk).order("id").range(from, to),
      ),
    ]);
    const questionCounts = new Map<string, number>();
    for (const q of questions) questionCounts.set(q.activity_id, (questionCounts.get(q.activity_id) ?? 0) + 1);
    return { states, answers, questionCounts };
  } catch (e) {
    if (e instanceof Error && missing(e.message)) return { states: [], answers: [], questionCounts: new Map() };
    throw e;
  }
}

// --------------------------------------------------------- the builder

export interface QuestionDraft {
  /** Kept across saves, so a student's answer stays attached to its question. */
  id: string;
  kind: LiveKind;
  stem: string;
  options: string[];
  unit: string | null;
  figure_path: string | null;
  correct_option: number | null;
  answer: number | null;
  tolerance: number | null;
  accept: string[];
  /**
   * Why the answer is the answer (0051). Blank removes it; left out, whatever
   * is saved stays as it is.
   */
  explanation?: string;
}

/** Every accepted form's print: what a team's answer is held to as it submits (0049). */
async function printsOf(accept: string[]): Promise<ExpressionPrint[]> {
  const prints = await Promise.all(accept.map((form) => expressionPrint(form)));
  return prints.filter((p): p is ExpressionPrint => p !== null);
}

const keyRows = (activityId: string, drafts: QuestionDraft[]) =>
  Promise.all(
    drafts.map(async (d) => ({
      question_id: d.id,
      activity_id: activityId,
      correct_option: d.kind === "mc" ? d.correct_option : null,
      answer: d.kind === "number" ? d.answer : null,
      tolerance: d.kind === "number" ? d.tolerance : null,
      accept: d.kind === "expression" ? d.accept : [],
      prints: d.kind === "expression" ? await printsOf(d.accept) : [],
    })),
  );

type KeyRow = Awaited<ReturnType<typeof keyRows>>[number];

async function upsertKeys(rows: KeyRow[]): Promise<void> {
  const res = await db().from("live_keys").upsert(rows).select("question_id");
  if (res.error && before0049(res.error.message)) {
    // Before 0049: no prints column, and nothing that would read one.
    unwrap(await db().from("live_keys").upsert(rows.map(({ prints: _, ...row }) => row)).select("question_id"));
    return;
  }
  unwrap(res);
}

/** Refuse an explanation the database would, before anything is written. */
function checkExplanations(drafts: QuestionDraft[]): void {
  if (drafts.some((d) => (d.explanation ?? "").trim().length > EXPLANATION_MAX)) {
    throw new Error(`An explanation can be at most ${EXPLANATION_MAX.toLocaleString()} characters.`);
  }
}

/**
 * A written explanation needs 0051. Asked before anything is saved, so a
 * database without it refuses the whole save rather than half of it.
 */
async function checkExplanationsFit(activityId: string, drafts: QuestionDraft[]): Promise<void> {
  if (!drafts.some((d) => (d.explanation ?? "").trim() !== "")) return;
  const res = await db().from("live_explanations").select("question_id").eq("activity_id", activityId).limit(1);
  if (!res.error) return;
  if (before0051(res.error.message)) {
    throw new Error("Explanations need 0051_live_team_leader.sql run on the database first. Nothing was saved.");
  }
  throw dbError(res.error);
}

/**
 * Each draft's explanation, written or removed (0051). Drafts without one are
 * left alone. On a database without 0051 blank ones are nothing to do, and a
 * written one is an error rather than quietly dropped.
 */
async function saveExplanations(activityId: string, drafts: QuestionDraft[]): Promise<void> {
  const given = drafts.filter((d): d is QuestionDraft & { explanation: string } => d.explanation !== undefined);
  const rows = given
    .filter((d) => d.explanation.trim() !== "")
    .map((d) => ({ question_id: d.id, activity_id: activityId, body: d.explanation.trim() }));
  const cleared = given.filter((d) => d.explanation.trim() === "").map((d) => d.id);
  try {
    if (rows.length > 0) {
      unwrap(await db().from("live_explanations").upsert(rows).select("question_id"));
    }
    if (cleared.length > 0) {
      unwrap(
        await db().from("live_explanations").delete().eq("activity_id", activityId).in("question_id", cleared)
          .select("question_id"),
      );
    }
  } catch (e) {
    if (!(e instanceof Error) || !before0051(e.message)) throw e;
    if (rows.length > 0) {
      throw new Error("Questions saved, but explanations need 0051_live_team_leader.sql run on the database first.");
    }
  }
}

/**
 * Make the activity's questions exactly `drafts`, in that order.
 *
 * Upserted by id rather than deleted and re-inserted: a question students have
 * already answered keeps its answers when its wording changes. Questions no
 * longer in the list are removed — and their answers with them, which the
 * builder says before it lets that happen.
 */
export async function saveLiveQuestions(
  activityId: string,
  drafts: QuestionDraft[],
  /**
   * Team mode has started: the set of questions and their options are fixed
   * (0047's guard). Each one is UPDATED in place — an upsert fires the insert
   * trigger first, which refuses — and nothing is removed.
   */
  frozen = false,
): Promise<void> {
  checkExplanations(drafts);
  await checkExplanationsFit(activityId, drafts);
  if (frozen) {
    for (const d of drafts) {
      const rows = unwrap(
        await db()
          .from("live_questions")
          .update({ stem: d.stem, unit: d.kind === "number" ? d.unit : null, figure_path: d.figure_path })
          .eq("id", d.id)
          .eq("activity_id", activityId)
          .select("id"),
      ) as unknown[];
      if (rows.length === 0) throw new Error("A question has gone since this page loaded. Reload and try again.");
    }
    await upsertKeys(await keyRows(activityId, drafts));
    await saveExplanations(activityId, drafts);
    return;
  }
  if (drafts.length > 0) {
    unwrap(
      await db()
        .from("live_questions")
        .upsert(
          drafts.map((d, i) => ({
            id: d.id,
            activity_id: activityId,
            position: i,
            kind: d.kind,
            stem: d.stem,
            options: d.kind === "mc" ? d.options : [],
            unit: d.kind === "number" ? d.unit : null,
            figure_path: d.figure_path,
          })),
        )
        .select("id"),
    );
    await upsertKeys(await keyRows(activityId, drafts));
  }

  const keep = drafts.map((d) => d.id);
  let remove = db().from("live_questions").delete().eq("activity_id", activityId);
  if (keep.length > 0) remove = remove.not("id", "in", `(${keep.join(",")})`);
  unwrap(await remove.select("id"));
  // Last: the questions are as they should be whatever happens here.
  await saveExplanations(activityId, drafts);
}

export async function setLiveSettings(
  activityId: string,
  settings: Partial<{ lock_rule: LockRule; show_answers: ShowAnswers; grading: LiveGrading }>,
): Promise<void> {
  const rows = unwrap(
    await db().from("live_state").update(settings).eq("activity_id", activityId).select("activity_id"),
  ) as unknown[];
  if (rows.length === 0) throw new Error("Only the instructor can change these settings.");
}

// -------------------------------------------------------- the student

/**
 * Save the caller's own answer to one question. Update first, insert if there
 * was nothing to update: an upsert would ask to update every column it sends,
 * and a student may only ever update `answer` (0047's column grants).
 */
export async function saveMyAnswer(input: {
  activityId: string;
  questionId: string;
  studentId: string;
  answer: string;
}): Promise<void> {
  const updated = unwrap(
    await db()
      .from("live_responses")
      .update({ answer: input.answer })
      .eq("question_id", input.questionId)
      .eq("student_id", input.studentId)
      .select("question_id"),
  ) as unknown[];
  if (updated.length > 0) return;
  const res = await db().from("live_responses").insert({
    question_id: input.questionId,
    activity_id: input.activityId,
    student_id: input.studentId,
    answer: input.answer,
  });
  if (res.error) {
    // Two saves of a first answer racing each other: the second finds the row.
    if (/duplicate key|23505/i.test(res.error.message)) return saveMyAnswer(input);
    throw dbError(res.error);
  }
}

export async function castVote(questionId: string, answer: string): Promise<void> {
  unwrap(await db().rpc("cast_vote", { qid: questionId, ans: answer }));
}

/**
 * Submit the caller's vote as the team's next try, and hear at once whether
 * it's right (0049). `answer` is the vote as this screen has it; for an
 * expression its print goes along, since the database can't do the algebra,
 * and the database uses the print only if it is of the answer it holds.
 */
export async function lockTeamAnswer(question: LiveQuestion, answer: string | null): Promise<LiveAttempt> {
  const print = question.kind === "expression" && answer ? await answerPrint(answer) : null;
  if (print) {
    const res = await db().rpc("lock_team_answer", { qid: question.id, print });
    if (!res.error || !before0049(res.error.message)) return unwrap(res) as LiveAttempt;
  }
  const lock = unwrap(await db().rpc("lock_team_answer", { qid: question.id })) as LiveLock | LiveAttempt;
  return { attempt: 1, ...lock };
}

/** Done with a question the team hasn't got, once another try is worth nothing (0050). */
export async function moveTeamOn(questionId: string): Promise<LiveLock> {
  return unwrap(await db().rpc("move_team_on", { qid: questionId })) as LiveLock;
}

/**
 * The caller's pick for their team's leader (0051): anyone on the team who is
 * there, themselves included. The database sets the leader itself once
 * everyone there has picked the same person. Returns the team's setup row.
 */
export async function voteLeader(activityId: string, candidateId: string): Promise<LiveTeamSetup> {
  return unwrap(await db().rpc("vote_live_leader", { aid: activityId, candidate: candidateId })) as LiveTeamSetup;
}

/** "Confirm <name>": settle on the one name every vote is for, once two have voted (0051). */
export async function confirmLeader(activityId: string): Promise<LiveTeamSetup> {
  return unwrap(await db().rpc("confirm_live_leader", { aid: activityId })) as LiveTeamSetup;
}

/**
 * The leader's roll (0051): exactly these teammates are absent, the rest of
 * the team is here. Taking it again replaces it. Each tap is saved with
 * `done` false (0052), so the team watches the roll being taken; the team
 * moves on to play once it's saved done. `done` is sent only when false, so
 * finishing the roll still works on a database without 0052.
 */
export async function setAbsences(activityId: string, absentIds: string[], done = true): Promise<LiveTeamSetup> {
  const absent = [...new Set(absentIds)];
  const args = done ? { aid: activityId, absent } : { aid: activityId, absent, done: false };
  return unwrap(await db().rpc("set_live_absences", args)) as LiveTeamSetup;
}

// ------------------------------------------------------- in the room

export async function startTeamMode(activityId: string): Promise<LiveState> {
  return unwrap(await db().rpc("start_live_team", { aid: activityId })) as LiveState;
}

/**
 * Give prints to expression keys saved before 0049, which have none — so a
 * team's "0.5F" for "F/2" would be told wrong until the session was scored.
 * The owner's, on the way into team mode (only she writes keys); quiet on a
 * database without 0049.
 */
export async function printOldKeys(activityId: string, questions: LiveQuestion[]): Promise<void> {
  const ids = questions.filter((q) => q.kind === "expression").map((q) => q.id);
  if (ids.length === 0) return;
  const res = await db().from("live_keys").select("question_id, accept, prints").eq("activity_id", activityId).in("question_id", ids);
  if (res.error) {
    if (before0049(res.error.message)) return;
    throw dbError(res.error);
  }
  for (const row of (res.data ?? []) as { question_id: string; accept: unknown; prints: unknown }[]) {
    const accept = Array.isArray(row.accept) ? (row.accept as string[]) : [];
    if (accept.length === 0 || (Array.isArray(row.prints) && row.prints.length > 0)) continue;
    const prints = await printsOf(accept);
    if (prints.length === 0) continue;
    unwrap(await db().from("live_keys").update({ prints }).eq("question_id", row.question_id).select("question_id"));
  }
}

export async function closeLive(activityId: string): Promise<LiveState> {
  return unwrap(await db().rpc("close_live", { aid: activityId })) as LiveState;
}

/** Close it without team mode (0053): students read the key and the why, and only their own answers are scored. */
export async function releaseLiveIndividual(activityId: string): Promise<LiveState> {
  return unwrap(await db().rpc("release_live_individual", { aid: activityId })) as LiveState;
}

export async function addLiveMember(activityId: string, studentId: string, teamId: string): Promise<void> {
  unwrap(await db().rpc("add_live_member", { aid: activityId, sid: studentId, tid: teamId }));
}

/**
 * Score a closed session into the gradebook. Expression answers are decided
 * here first (the database doesn't do algebra) and handed to score_live with
 * everything else left to SQL.
 */
export async function scoreLive(snapshot: LiveSnapshot): Promise<{ students: number; teams: number; status: string }> {
  const verdicts = await expressionVerdicts(snapshot.questions, snapshot.keys, [
    ...snapshot.responses,
    ...snapshot.locks,
    ...snapshot.attempts,
  ]);
  return unwrap(
    await db().rpc("score_live", { aid: snapshot.state.activity_id, verdicts }),
  ) as { students: number; teams: number; status: string };
}

// ------------------------------------------------------------- live

/**
 * Wake on any change to this activity's state, votes, tries or locks — or a
 * team's leader votes, setup and roll (0051) — from anyone. Filtered on activity_id server-side and limited by RLS to rows the
 * caller may read (a team sees only its own votes). Rows that BECOME readable
 * — a teammate's own answers once team mode starts, keys once it closes — are
 * not re-sent by realtime, so the caller reloads the whole snapshot on any
 * event. Returns the unsubscribe.
 */
let watchers = 0;

export type LiveTable =
  | "live_state"
  | "live_votes"
  | "live_locks"
  | "live_attempts"
  | "live_leader_votes"
  | "live_team_setup"
  | "tutorial_absences";

/** 0051's tables, and the sheet's absences its roll writes to. */
export const SETUP_TABLES: readonly LiveTable[] = ["live_leader_votes", "live_team_setup", "tutorial_absences"];

export function watchLive(
  activityId: string,
  /** Told which table moved, so a screen can read less for some of them. */
  onChange: (table: LiveTable) => void,
  /** Fewer, for a screen that only cares when the session moves (live_state). */
  tables: readonly LiveTable[] = ["live_state", "live_votes", "live_locks", "live_attempts", ...SETUP_TABLES],
): () => void {
  // Its own topic per watcher: the student list and the open activity both
  // watch the same session, and removing one shared channel would deafen both.
  // live_attempts on a channel of its own, and 0051's on another: a database
  // without 0049 or 0051 has no such tables, and refusing them mustn't take
  // the others down with them.
  const later = (t: LiveTable) => t === "live_attempts" || SETUP_TABLES.includes(t);
  const groups = [
    tables.filter((t) => !later(t)),
    tables.filter((t) => t === "live_attempts"),
    tables.filter((t) => SETUP_TABLES.includes(t)),
  ];
  const channels = groups
    .filter((group) => group.length > 0)
    .map((group) => {
      const channel = db().channel(`live:${activityId}:${++watchers}`);
      for (const table of group) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `activity_id=eq.${activityId}` },
          () => onChange(table),
        );
      }
      channel.subscribe();
      return channel;
    });
  return () => {
    for (const channel of channels) void db().removeChannel(channel);
  };
}

// ------------------------------------------------------------ duplicate

/**
 * Copy one live activity's questions, keys, explanations and settings into
 * another (a duplicate made by duplicateActivity). Nothing about how it went —
 * answers, votes, locks, leaders, the roll — comes along. Figures are copied
 * as new objects under the new activity: two rows naming one object would lose
 * it for both when either activity is deleted (see duplicateActivity on
 * attachments).
 */
export async function copyLive(fromId: string, toId: string): Promise<number> {
  const source = await loadLive(fromId);
  if (!source) return 0;
  const idFor = new Map(source.questions.map((q) => [q.id, crypto.randomUUID()]));

  const figureFor = new Map<string, string | null>();
  for (const q of source.questions) {
    if (!q.figure_path) continue;
    const name = q.figure_path.split("/").pop() ?? "figure.png";
    const to = `${toId}/${name.replace(/^live-[0-9a-f-]{36}-/, `live-${idFor.get(q.id)}-`)}`;
    const res = await db().storage.from("activity-files").copy(q.figure_path, to);
    // A figure that can't be copied is left off rather than shared.
    figureFor.set(q.id, res.error ? null : to);
  }

  const drafts: QuestionDraft[] = source.questions.map((q) => {
    const k = source.keys.find((x) => x.question_id === q.id);
    return {
      id: idFor.get(q.id)!,
      kind: q.kind,
      stem: q.stem,
      options: q.options,
      unit: q.unit,
      figure_path: figureFor.get(q.id) ?? null,
      correct_option: k?.correct_option ?? null,
      answer: k?.answer ?? null,
      tolerance: k?.tolerance ?? null,
      accept: k?.accept ?? [],
      // Left out without 0051, where there's nowhere to put one.
      ...(source.teamSetup
        ? { explanation: source.explanations.find((e) => e.question_id === q.id)?.body ?? "" }
        : {}),
    };
  });
  await saveLiveQuestions(toId, drafts);
  await setLiveSettings(toId, {
    lock_rule: source.state.lock_rule,
    show_answers: source.state.show_answers,
    grading: source.state.grading,
  });
  return drafts.length;
}
