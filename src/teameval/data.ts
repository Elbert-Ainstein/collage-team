// Reads and writes for team evaluation (0058).
//
// The instructor's own rows — settings, categories, questions — are written
// directly, under RLS. Everything a student writes goes through
// save_team_eval, which checks it against their team and the clock; what they
// read about themselves comes back from team_eval_results, never from the
// tables. A database without 0058 reads as "no evaluation data" rather than
// failing the page.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError, selectAll, selectAllIn } from "@/checkins/data";
import type { CategoryDraft, QuestionDraft } from "./defaults";
import type { EvalDraft } from "./model";
import { draftPayload } from "./model";
import type {
  StudentTeamEval,
  TeamEvalCategory,
  TeamEvalComment,
  TeamEvalMember,
  TeamEvalQuestion,
  TeamEvalRating,
  TeamEvalResults,
  TeamEvalSettings,
  TeamEvalSnapshot,
  TeamEvalSubmission,
} from "./types";

const db = () => requireSupabase();

/** 0058 not run here: the tables simply aren't there. */
const missing = (m: string) => /te_(settings|categories|questions|ratings|comments|submissions)|schema cache|does not exist/i.test(m);

// numeric columns can come back as strings from PostgREST.
const asSettings = (row: Record<string, unknown>): TeamEvalSettings => ({
  ...(row as unknown as TeamEvalSettings),
  late_penalty: Number(row.late_penalty ?? 0),
});
const asCategory = (row: Record<string, unknown>): TeamEvalCategory => {
  const levels = Array.isArray(row.levels) ? (row.levels as unknown[]).map((l) => String(l ?? "")) : [];
  while (levels.length < 5) levels.push("");
  return { ...(row as unknown as TeamEvalCategory), levels: levels.slice(0, 5) };
};

function byActivity<Row>(table: string, activityId: string, order: string): Promise<Row[]> {
  return selectAll<Row>((from, to) =>
    db().from(table).select("*").eq("activity_id", activityId).order(order).range(from, to) as unknown as PromiseLike<{
      data: Row[] | null;
      error: { message: string } | null;
    }>,
  );
}

async function settingsOf(activityId: string): Promise<TeamEvalSettings | null> {
  const { data, error } = await db().from("te_settings").select("*").eq("activity_id", activityId).maybeSingle();
  if (error) throw dbError(error);
  return data ? asSettings(data as Record<string, unknown>) : null;
}

async function shapeOf(activityId: string): Promise<{ categories: TeamEvalCategory[]; questions: TeamEvalQuestion[] }> {
  const [categories, questions] = await Promise.all([
    byActivity<Record<string, unknown>>("te_categories", activityId, "position"),
    byActivity<TeamEvalQuestion>("te_questions", activityId, "position"),
  ]);
  return { categories: categories.map(asCategory), questions };
}

// ------------------------------------------------------------- instructor

/** Everything the instructor's screens show. Null on a database without 0058. */
export async function loadTeamEval(activityId: string): Promise<TeamEvalSnapshot | null> {
  try {
    const settings = await settingsOf(activityId);
    if (!settings) return null;
    const [shape, ratings, comments, submissions] = await Promise.all([
      shapeOf(activityId),
      byActivity<TeamEvalRating>("te_ratings", activityId, "rater_id"),
      byActivity<TeamEvalComment>("te_comments", activityId, "author_id"),
      byActivity<TeamEvalSubmission>("te_submissions", activityId, "student_id"),
    ]);
    return { settings, ...shape, ratings, comments, submissions };
  } catch (e) {
    if (e instanceof Error && missing(e.message)) return null;
    throw e;
  }
}

/**
 * Save the categories and questions as drafted: removed ones deleted, the rest
 * written in order. Removing comes first, so a full rewrite never trips over
 * an old row. Once anyone has submitted, the database refuses to add or remove
 * any (0058) — the builder doesn't offer it then.
 */
export async function saveTeamEvalShape(activityId: string, categories: CategoryDraft[], questions: QuestionDraft[]): Promise<void> {
  const before = await shapeOf(activityId);
  const goneCats = before.categories.filter((c) => !categories.some((d) => d.id === c.id)).map((c) => c.id);
  const goneQs = before.questions.filter((q) => !questions.some((d) => d.id === q.id)).map((q) => q.id);
  if (goneCats.length) {
    const { error } = await db().from("te_categories").delete().in("id", goneCats);
    if (error) throw dbError(error);
  }
  if (goneQs.length) {
    const { error } = await db().from("te_questions").delete().in("id", goneQs);
    if (error) throw dbError(error);
  }
  if (categories.length) {
    const { error } = await db()
      .from("te_categories")
      .upsert(
        categories.map((c, i) => ({
          id: c.id,
          activity_id: activityId,
          position: i,
          name: c.name.trim(),
          levels: c.levels.map((l) => l.trim()),
        })),
        { onConflict: "id" },
      );
    if (error) throw dbError(error);
  }
  if (questions.length) {
    const { error } = await db()
      .from("te_questions")
      .upsert(
        questions.map((q, i) => ({ id: q.id, activity_id: activityId, position: i, audience: q.audience, prompt: q.prompt.trim() })),
        { onConflict: "id" },
      );
    if (error) throw dbError(error);
  }
}

export type SettingsPatch = Partial<
  Pick<TeamEvalSettings, "peer_comments" | "release_comments" | "anonymize" | "explain_ratings" | "late_penalty">
>;

export async function setTeamEvalSettings(activityId: string, patch: SettingsPatch): Promise<void> {
  const { error } = await db().from("te_settings").update(patch).eq("activity_id", activityId);
  if (error) throw dbError(error);
}

/** Let students see their results, or take them back. */
export async function releaseTeamEval(activityId: string, released: boolean): Promise<void> {
  const { error } = await db()
    .from("te_settings")
    .update({ released_at: released ? new Date().toISOString() : null })
    .eq("activity_id", activityId);
  if (error) throw dbError(error);
}

/** Mark a submission late or on time; null goes back to the clock. */
export async function setTeamEvalLate(activityId: string, studentId: string, late: boolean | null): Promise<void> {
  const { error } = await db().rpc("set_team_eval_late", { aid: activityId, sid: studentId, late });
  if (error) throw dbError(error);
}

/** Write it into the gradebook (score_team_eval). */
export async function scoreTeamEval(activityId: string): Promise<{ students: number; status: string }> {
  const { data, error } = await db().rpc("score_team_eval", { aid: activityId });
  if (error) throw dbError(error);
  return data as { students: number; status: string };
}

/** A duplicate gets the same categories, questions and settings — never anyone's answers. */
export async function copyTeamEval(fromId: string, toId: string): Promise<number> {
  const source = await loadTeamEval(fromId);
  if (!source) return 0;
  await saveTeamEvalShape(
    toId,
    source.categories.map((c) => ({ id: crypto.randomUUID(), name: c.name, levels: c.levels })),
    source.questions.map((q) => ({ id: crypto.randomUUID(), audience: q.audience, prompt: q.prompt })),
  );
  const { peer_comments, release_comments, anonymize, explain_ratings, late_penalty } = source.settings;
  await setTeamEvalSettings(toId, { peer_comments, release_comments, anonymize, explain_ratings, late_penalty });
  return source.categories.length + source.questions.length;
}

// ----------------------------------------------------------------- student

/** What a student needs to fill theirs in: the form, their team, their own rows. */
export async function loadStudentTeamEval(activityId: string, studentId: string): Promise<StudentTeamEval | null> {
  try {
    const settings = await settingsOf(activityId);
    if (!settings) return null;
    const [shape, team, ratings, comments, submission] = await Promise.all([
      shapeOf(activityId),
      db()
        .rpc("team_eval_team", { aid: activityId })
        .then(({ data, error }) => {
          if (error) throw dbError(error);
          return (data as TeamEvalMember[] | null) ?? [];
        }),
      // RLS returns only their own; the filter says so out loud.
      byActivity<TeamEvalRating>("te_ratings", activityId, "category_id").then((rs) => rs.filter((r) => r.rater_id === studentId)),
      byActivity<TeamEvalComment>("te_comments", activityId, "question_id").then((cs) => cs.filter((c) => c.author_id === studentId)),
      db()
        .from("te_submissions")
        .select("*")
        .eq("activity_id", activityId)
        .eq("student_id", studentId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) throw dbError(error);
          return (data as TeamEvalSubmission | null) ?? null;
        }),
    ]);
    return { settings, ...shape, team, ratings, comments, submission };
  } catch (e) {
    if (e instanceof Error && missing(e.message)) return null;
    throw e;
  }
}

/** Save their evaluation; with `submit`, hand it in. Returns the submission, if there is one. */
export async function saveMyTeamEval(activityId: string, draft: EvalDraft, submit: boolean): Promise<TeamEvalSubmission | null> {
  const { ratings, comments } = draftPayload(draft);
  const { data, error } = await db().rpc("save_team_eval", { aid: activityId, ratings, comments, submit });
  if (error) throw dbError(error);
  const row = data as TeamEvalSubmission | null;
  return row && row.student_id ? row : null;
}

export async function loadMyTeamEvalResults(activityId: string): Promise<TeamEvalResults> {
  const { data, error } = await db().rpc("team_eval_results", { aid: activityId });
  if (error) throw dbError(error);
  const r = (data as TeamEvalResults | null) ?? { released: false };
  return {
    ...r,
    categories: r.categories?.map((c) => ({ ...c, average: c.average === null ? null : Number(c.average) })),
  };
}

export interface TeamEvalProgress {
  submitted: boolean;
  submittedAt: string | null;
  lateOverride: boolean | null;
  released: boolean;
}

/** For the assignment list: has this student submitted each one, and is it out? */
export async function listTeamEvalProgress(activityIds: string[], studentId: string): Promise<Map<string, TeamEvalProgress>> {
  const out = new Map<string, TeamEvalProgress>();
  if (!activityIds.length) return out;
  try {
    const [subs, settings] = await Promise.all([
      selectAllIn<TeamEvalSubmission>(activityIds, (chunk, from, to) =>
        db().from("te_submissions").select("*").in("activity_id", chunk).eq("student_id", studentId).order("activity_id").range(from, to),
      ),
      selectAllIn<{ activity_id: string; released_at: string | null }>(activityIds, (chunk, from, to) =>
        db().from("te_settings").select("activity_id, released_at").in("activity_id", chunk).order("activity_id").range(from, to),
      ),
    ]);
    for (const id of activityIds) {
      const sub = subs.find((s) => s.activity_id === id);
      out.set(id, {
        submitted: Boolean(sub),
        submittedAt: sub?.submitted_at ?? null,
        lateOverride: sub?.late_override ?? null,
        released: Boolean(settings.find((s) => s.activity_id === id)?.released_at),
      });
    }
  } catch (e) {
    if (e instanceof Error && missing(e.message)) return out;
    throw e;
  }
  return out;
}
