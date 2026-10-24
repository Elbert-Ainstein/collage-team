// Reads and writes for live questions (0047).
//
// Everything a client may change goes one of two ways. The instructor's own
// rows — questions, keys, settings — are written directly, under RLS. Anything
// that has to be checked against someone else's rows or the clock — moving the
// phase, a vote, a team's try, scoring — goes through an RPC that checks for
// itself. A database that hasn't run 0047 reads as "no live data" rather than
// failing the page; one that hasn't run 0049 reads as every lock being a
// single try, told nothing until the session closes.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError, selectAll, selectAllIn } from "@/checkins/data";
import { answerPrint, expressionPrint, expressionVerdicts, type ExpressionPrint } from "./answers";
import type {
  LiveAttempt,
  LiveGrading,
  LiveKey,
  LiveKind,
  LiveLock,
  LiveQuestion,
  LiveResponse,
  LiveSnapshot,
  LiveState,
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

/** One live activity, as much of it as the caller may see; null if it has no live data. */
export async function loadLive(activityId: string): Promise<LiveSnapshot | null> {
  const stateRes = await db().from("live_state").select("*").eq("activity_id", activityId).maybeSingle();
  if (stateRes.error) {
    if (missing(stateRes.error.message)) return null;
    throw dbError(stateRes.error);
  }
  if (!stateRes.data) return null;

  const [questions, keys, responses, votes, locks, attempts] = await Promise.all([
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
    selectAll<LiveAttempt>((from, to) =>
      db().from("live_attempts").select("*").eq("activity_id", activityId)
        .order("question_id").order("team_id").order("attempt").range(from, to),
    ).catch((e: unknown) => {
      if (e instanceof Error && before0049(e.message)) return [] as LiveAttempt[];
      throw e;
    }),
  ]);

  return {
    state: stateRes.data as LiveState,
    questions: questions.map(asQuestion),
    keys: keys.map(asKey),
    responses,
    votes,
    locks,
    attempts,
  };
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
 * Wake on any change to this activity's state, votes, tries or locks, from
 * anyone. Filtered on activity_id server-side and limited by RLS to rows the
 * caller may read (a team sees only its own votes). Rows that BECOME readable
 * — a teammate's own answers once team mode starts, keys once it closes — are
 * not re-sent by realtime, so the caller reloads the whole snapshot on any
 * event. Returns the unsubscribe.
 */
let watchers = 0;

type LiveTable = "live_state" | "live_votes" | "live_locks" | "live_attempts";

export function watchLive(
  activityId: string,
  onChange: () => void,
  /** Fewer, for a screen that only cares when the session moves (live_state). */
  tables: readonly LiveTable[] = ["live_state", "live_votes", "live_locks", "live_attempts"],
): () => void {
  // Its own topic per watcher: the student list and the open activity both
  // watch the same session, and removing one shared channel would deafen both.
  // live_attempts on a channel of its own: a database without 0049 has no
  // such table, and refusing it mustn't take the others down with it.
  const groups = [tables.filter((t) => t !== "live_attempts"), tables.filter((t) => t === "live_attempts")];
  const channels = groups
    .filter((group) => group.length > 0)
    .map((group) => {
      const channel = db().channel(`live:${activityId}:${++watchers}`);
      for (const table of group) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `activity_id=eq.${activityId}` },
          () => onChange(),
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
 * Copy one live activity's questions, keys and settings into another (a
 * duplicate made by duplicateActivity). Nothing about how it went — answers,
 * votes, locks — comes along. Figures are copied as new objects under the new
 * activity: two rows naming one object would lose it for both when either
 * activity is deleted (see duplicateActivity on attachments).
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
