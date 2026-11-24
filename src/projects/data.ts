// Reads and writes for projects (0059).
//
// Straight to the tables, under RLS: staff read, the owner writes projects
// and their rubric, graders write gradings and scores. The rules the
// database keeps — a reason for every score before done, nothing cleared
// while done, one team set per project — come back as errors worded for the
// person who hit them, and are passed on as they are.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError, selectAll, selectAllIn } from "@/checkins/data";
import type { CategoryDraft } from "./defaults";
import type {
  GradingKey,
  Project,
  ProjectCategory,
  ProjectGrading,
  ProjectScore,
  ProjectSnapshot,
  ProjectsOverview,
} from "./types";

const db = () => requireSupabase();

type Paged<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/** A database without 0059: the tables aren't there. */
export class ProjectsNotInstalledError extends Error {
  constructor() {
    super(
      "This database has no project tables yet — run supabase/migrations/0059_projects.sql " +
        "in the Supabase SQL editor.",
    );
    this.name = "ProjectsNotInstalledError";
  }
}

const TABLES = /\b(projects|project_categories|project_gradings|project_scores)\b/;

function notInstalled(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return TABLES.test(m) && /does not exist|schema cache|could not find/i.test(m);
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (notInstalled(e)) throw new ProjectsNotInstalledError();
    throw e;
  }
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

const asCategory = (row: Record<string, unknown>): ProjectCategory => {
  const levels = Array.isArray(row.levels) ? (row.levels as unknown[]).map((l) => String(l ?? "")) : [];
  while (levels.length < 5) levels.push("");
  return { ...(row as unknown as ProjectCategory), levels: levels.slice(0, 5) };
};

/**
 * Every row of one project's table, a page at a time. `order` is the table's
 * whole key: pages are only stable when no two rows tie, and a tie at a page
 * edge is a row read twice or not at all (see selectAll).
 */
function byProject<Row>(table: string, projectId: string, order: string[]): Promise<Row[]> {
  return selectAll<Row>((from, to) => {
    let q = db().from(table).select("*").eq("project_id", projectId);
    for (const col of order) q = q.order(col);
    return q.range(from, to) as unknown as Paged<Row>;
  });
}

// ------------------------------------------------------------------ reads

/** A course's projects, with what the list shows about each. */
export function listProjects(courseId: string): Promise<ProjectsOverview> {
  return guarded(async () => {
    const projects = await selectAll<Project>(
      (from, to) =>
        db()
          .from("projects")
          .select("*")
          .eq("course_id", courseId)
          .order("position")
          .order("created_at")
          .order("id")
          .range(from, to) as unknown as Paged<Project>,
    );
    const ids = projects.map((p) => p.id);
    const [cats, gradings] = ids.length
      ? await Promise.all([
          selectAllIn<{ project_id: string }>(
            ids,
            (chunk, from, to) =>
              db()
                .from("project_categories")
                .select("project_id,id")
                .in("project_id", chunk)
                .order("project_id")
                .order("id")
                .range(from, to) as unknown as Paged<{ project_id: string }>,
          ),
          selectAllIn<ProjectsOverview["gradings"][number]>(
            ids,
            (chunk, from, to) =>
              db()
                .from("project_gradings")
                .select("project_id,team_id,slot,done_at")
                .in("project_id", chunk)
                .order("project_id")
                .order("team_id")
                .order("slot")
                .range(from, to) as unknown as Paged<ProjectsOverview["gradings"][number]>,
          ),
        ])
      : [[], []];
    const categoryCount = new Map<string, number>();
    for (const c of cats) categoryCount.set(c.project_id, (categoryCount.get(c.project_id) ?? 0) + 1);
    return { projects, categoryCount, gradings };
  });
}

/** One project and everything graded on it. Null when it's gone. */
export function loadProject(projectId: string): Promise<ProjectSnapshot | null> {
  return guarded(async () => {
    const { data, error } = await db().from("projects").select("*").eq("id", projectId).maybeSingle();
    if (error) throw dbError(error);
    if (!data) return null;
    const [categories, gradings, scores] = await Promise.all([
      byProject<Record<string, unknown>>("project_categories", projectId, ["position", "id"]),
      byProject<ProjectGrading>("project_gradings", projectId, ["team_id", "slot"]),
      byProject<ProjectScore>("project_scores", projectId, ["team_id", "slot", "category_id"]),
    ]);
    return {
      project: data as Project,
      categories: categories
        .map(asCategory)
        .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)),
      gradings,
      scores,
    };
  });
}

/**
 * The signed-in TF's own name on this course's roster, or "". A TF can always
 * read their own row (0007), even where the rest of the TF list is closed.
 */
export async function myTFName(courseId: string): Promise<string> {
  const { data: auth } = await db().auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) return "";
  const { data, error } = await db()
    .from("course_tfs")
    .select("name")
    .eq("course_id", courseId)
    .eq("user_id", uid)
    .limit(1);
  if (error) return "";
  return ((data?.[0] as { name?: string | null } | undefined)?.name ?? "").trim();
}

// ------------------------------------------------------- the owner's rows

const categoryRow = (projectId: string, c: CategoryDraft, position: number) => ({
  id: c.id,
  project_id: projectId,
  position,
  name: c.name.trim(),
  levels: c.levels.map((l) => l.trim()),
});

export function createProject(
  input: { courseId: string; title: string; gradersPerTeam: number; position: number },
  categories: CategoryDraft[],
): Promise<Project> {
  return guarded(async () => {
    const project = unwrap(
      await db()
        .from("projects")
        .insert({
          course_id: input.courseId,
          title: input.title.trim(),
          graders_per_team: input.gradersPerTeam,
          position: input.position,
        })
        .select()
        .single(),
    ) as Project;
    if (categories.length) {
      const { error } = await db()
        .from("project_categories")
        .insert(categories.map((c, i) => categoryRow(project.id, c, i)));
      if (error) {
        // Half a project is worse than none: the next try starts clean.
        await db().from("projects").delete().eq("id", project.id);
        throw dbError(error);
      }
    }
    return project;
  });
}

export function updateProject(
  projectId: string,
  patch: Partial<Pick<Project, "title" | "graders_per_team">>,
): Promise<void> {
  return guarded(async () => {
    const { error } = await db().from("projects").update(patch).eq("id", projectId);
    if (error) throw dbError(error);
  });
}

export function deleteProject(projectId: string): Promise<void> {
  return guarded(async () => {
    const { error } = await db().from("projects").delete().eq("id", projectId);
    if (error) throw dbError(error);
  });
}

/**
 * Make the rubric what the editor shows: categories taken out are deleted
 * (their scores with them), the rest written in the order shown. New ones
 * reopen any done grading, in the database.
 */
export function saveCategories(projectId: string, drafts: CategoryDraft[], existing: string[]): Promise<void> {
  return guarded(async () => {
    const keep = new Set(drafts.map((c) => c.id));
    const gone = existing.filter((id) => !keep.has(id));
    if (gone.length) {
      const { error } = await db().from("project_categories").delete().in("id", gone);
      if (error) throw dbError(error);
    }
    if (drafts.length) {
      const { error } = await db()
        .from("project_categories")
        .upsert(drafts.map((c, i) => categoryRow(projectId, c, i)), { onConflict: "id" });
      if (error) throw dbError(error);
    }
  });
}

// ------------------------------------------------------------ the grading

const keyOf = (k: GradingKey) => ({ project_id: k.projectId, team_id: k.teamId, slot: k.slot });

/** Set who's grading, opening the grading if this is the first thing said. */
export function saveGraderName(k: GradingKey, name: string): Promise<ProjectGrading> {
  return guarded(async () => {
    const rows = unwrap(
      await db()
        .from("project_gradings")
        .upsert({ ...keyOf(k), grader_name: name.trim() }, { onConflict: "project_id,team_id,slot" })
        .select(),
    ) as ProjectGrading[];
    return rows[0];
  });
}

/**
 * Write one category of a grading: its score and its reason, both, so an
 * existing row never has one blanked by a write about the other. The first
 * one opens the grading (0059).
 */
export function saveScore(
  k: GradingKey,
  categoryId: string,
  value: { score: number | null; reason: string },
): Promise<ProjectScore> {
  return guarded(async () => {
    const rows = unwrap(
      await db()
        .from("project_scores")
        .upsert(
          { ...keyOf(k), category_id: categoryId, score: value.score, reason: value.reason },
          { onConflict: "project_id,team_id,slot,category_id" },
        )
        .select(),
    ) as ProjectScore[];
    return rows[0];
  });
}

/** Mark a grading done, or reopen it. The database checks it's complete. */
export function setGradingDone(k: GradingKey, done: boolean): Promise<ProjectGrading> {
  return guarded(async () => {
    const rows = unwrap(
      await db()
        .from("project_gradings")
        .update({ done_at: done ? new Date().toISOString() : null })
        .eq("project_id", k.projectId)
        .eq("team_id", k.teamId)
        .eq("slot", k.slot)
        .select(),
    ) as ProjectGrading[];
    if (!rows.length) throw new Error("That grading isn't there any more. Reload and try again.");
    return rows[0];
  });
}

/** Throw a grading away, scores and all. */
export function clearGrading(k: GradingKey): Promise<void> {
  return guarded(async () => {
    const { error } = await db()
      .from("project_gradings")
      .delete()
      .eq("project_id", k.projectId)
      .eq("team_id", k.teamId)
      .eq("slot", k.slot);
    if (error) throw dbError(error);
  });
}

// --------------------------------------------------------------- realtime

const LIVE = ["project_categories", "project_gradings", "project_scores"] as const;

/**
 * Say when anyone writes to this project, so a copy open on another grader's
 * phone fills in as they go. The caller re-reads. Returns the unsubscribe; a
 * database without realtime simply never calls.
 */
export function watchProject(projectId: string, onChange: () => void): () => void {
  const channel = db().channel(`project:${projectId}`);
  for (const table of LIVE) {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` },
      () => onChange(),
    );
  }
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "projects", filter: `id=eq.${projectId}` },
    () => onChange(),
  );
  channel.subscribe();
  return () => {
    void db().removeChannel(channel);
  };
}
