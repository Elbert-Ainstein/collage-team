// Projects: everything worked out from the rows, with no reads or writes —
// progress, a team's averages, what a grader has left, and the reasons they
// gave before.

import {
  MAX_SLOTS,
  POINTS_PER_CATEGORY,
  type Project,
  type ProjectCategory,
  type ProjectGrading,
  type ProjectScore,
  type ProjectSnapshot,
} from "./types";

export type GradingState = "empty" | "started" | "done";

type Slotted = Pick<ProjectGrading, "team_id" | "slot">;

export function gradingOf<G extends Slotted>(gradings: G[], teamId: string, slot: number): G | undefined {
  return gradings.find((g) => g.team_id === teamId && g.slot === slot);
}

export function scoresOf(scores: ProjectScore[], teamId: string, slot: number): ProjectScore[] {
  return scores.filter((s) => s.team_id === teamId && s.slot === slot);
}

/** No row: nobody has started. A row: started, or done once marked. */
export function stateOf(grading: Pick<ProjectGrading, "done_at"> | undefined): GradingState {
  if (!grading) return "empty";
  return grading.done_at ? "done" : "started";
}

/**
 * The grader slots a team shows: as many as the project asks for, and any
 * past that somebody has used.
 */
export function slotsFor(project: Pick<Project, "graders_per_team">, gradings: Slotted[], teamId: string): number[] {
  const used = gradings.filter((g) => g.team_id === teamId).map((g) => g.slot);
  const n = Math.min(MAX_SLOTS, Math.max(project.graders_per_team, 0, ...used));
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** What a grader is called on screen: their name, or the slot until they give one. */
export function graderLabel(grading: Pick<ProjectGrading, "grader_name"> | undefined, slot: number): string {
  return grading?.grader_name.trim() || `Grader ${slot}`;
}

export const outOf = (categories: unknown[]): number => POINTS_PER_CATEGORY * categories.length;

/** One category as a grader has it on screen. */
export interface Draft {
  score: number | null;
  reason: string;
}

export interface Left {
  /** No grader's name yet. */
  name: boolean;
  /** Category ids with no score. */
  unscored: string[];
  /** Category ids with a score but nothing said about why. */
  unexplained: string[];
}

/** What stands between a grading and marking it done. */
export function whatsLeft(
  categories: Pick<ProjectCategory, "id">[],
  drafts: ReadonlyMap<string, Draft>,
  graderName: string,
): Left {
  const unscored: string[] = [];
  const unexplained: string[] = [];
  for (const c of categories) {
    const d = drafts.get(c.id);
    if (!d || d.score === null) unscored.push(c.id);
    else if (!d.reason.trim()) unexplained.push(c.id);
  }
  return { name: !graderName.trim(), unscored, unexplained };
}

export const nothingLeft = (left: Left): boolean =>
  !left.name && left.unscored.length === 0 && left.unexplained.length === 0;

/** "Add your name · Score Time · Say why for Robustness", or null when done-able. */
export function leftText(left: Left, categories: Pick<ProjectCategory, "id" | "name">[]): string | null {
  const name = (id: string) => categories.find((c) => c.id === id)?.name || "a category";
  const list = (ids: string[]) =>
    ids.length > 2 ? `${ids.length} categories` : ids.map(name).join(" and ");
  const parts: string[] = [];
  if (left.name) parts.push("Add your name");
  if (left.unscored.length) parts.push(`Score ${list(left.unscored)}`);
  if (left.unexplained.length) parts.push(`Say why for ${list(left.unexplained)}`);
  return parts.length ? parts.join(" · ") : null;
}

/** The sum of the scores given. */
export function total(scores: Pick<ProjectScore, "score">[]): number {
  return scores.reduce((n, s) => n + (s.score ?? 0), 0);
}

export interface TeamResult {
  /** Done gradings, which are the only ones counted. */
  graders: number;
  /** Each category's average across them; null when none scored it. */
  byCategory: Map<string, number | null>;
  /** The sum of those averages; null until a grading is done. */
  total: number | null;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * A team's result: each category averaged over the graders who marked their
 * grading done. Gradings still in progress don't count — half a grading
 * would drag an average about while somebody is still standing at the table.
 */
export function teamResult(snap: Pick<ProjectSnapshot, "categories" | "gradings" | "scores">, teamId: string): TeamResult {
  const done = snap.gradings.filter((g) => g.team_id === teamId && g.done_at);
  const slots = new Set(done.map((g) => g.slot));
  const counted = snap.scores.filter((s) => s.team_id === teamId && slots.has(s.slot) && s.score !== null);
  const byCategory = new Map<string, number | null>();
  for (const c of snap.categories) {
    byCategory.set(c.id, mean(counted.filter((s) => s.category_id === c.id).map((s) => s.score as number)));
  }
  const avgs = [...byCategory.values()].filter((v): v is number => v !== null);
  return { graders: done.length, byCategory, total: done.length ? avgs.reduce((a, b) => a + b, 0) : null };
}

/** 17.5, 18, 3.33 — at most two places, none when they'd be zeros. */
export function fmt(n: number | null): string {
  if (n === null) return "—";
  return String(Math.round(n * 100) / 100);
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export interface EarlierReason {
  reason: string;
  /** The score it was given with. */
  score: number | null;
  /** Given by a grader with the same name as this one. */
  mine: boolean;
}

/**
 * Reasons already given in this category on this project, for the grader to
 * use again: their own first, then ones given with the score they've picked,
 * then the newest. The grading being written is left out, and so is whatever
 * its box says now.
 */
export function earlierReasons(
  scores: ProjectScore[],
  gradings: Pick<ProjectGrading, "team_id" | "slot" | "grader_name">[],
  opts: {
    categoryId: string;
    teamId: string;
    slot: number;
    graderName: string;
    score: number | null;
    current: string;
    limit?: number;
  },
): EarlierReason[] {
  const me = norm(opts.graderName);
  const seen = new Map<string, EarlierReason & { at: string }>();
  for (const s of scores) {
    if (s.category_id !== opts.categoryId) continue;
    if (s.team_id === opts.teamId && s.slot === opts.slot) continue;
    const key = norm(s.reason);
    if (!key || key === norm(opts.current)) continue;
    const by = gradingOf(gradings, s.team_id, s.slot);
    const mine = Boolean(me) && norm(by?.grader_name ?? "") === me;
    const was = seen.get(key);
    if (!was || s.updated_at > was.at) {
      seen.set(key, { reason: s.reason.trim(), score: s.score, mine: mine || Boolean(was?.mine), at: s.updated_at });
    } else if (mine) {
      was.mine = true;
    }
  }
  const rank = (r: EarlierReason) => (r.mine ? 0 : 2) + (opts.score !== null && r.score === opts.score ? 0 : 1);
  return [...seen.values()]
    .sort((a, b) => rank(a) - rank(b) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, opts.limit ?? 6)
    .map(({ reason, score, mine }) => ({ reason, score, mine }));
}

export interface Progress {
  /** Gradings marked done. */
  done: number;
  /** Gradings started and not yet done. */
  started: number;
  /** Teams with at least as many done gradings as the project asks for. */
  teamsComplete: number;
}

/** How far along a project is, over the given teams. */
export function progressOf(
  gradings: Pick<ProjectGrading, "project_id" | "team_id" | "done_at">[],
  project: Pick<Project, "id" | "graders_per_team">,
  teamIds: string[],
): Progress {
  const teams = new Set(teamIds);
  const mine = gradings.filter((g) => g.project_id === project.id && teams.has(g.team_id));
  const doneBy = new Map<string, number>();
  for (const g of mine) if (g.done_at) doneBy.set(g.team_id, (doneBy.get(g.team_id) ?? 0) + 1);
  return {
    done: mine.filter((g) => g.done_at).length,
    started: mine.filter((g) => !g.done_at).length,
    teamsComplete: [...doneBy.values()].filter((n) => n >= project.graders_per_team).length,
  };
}

/**
 * The results as spreadsheet rows: one per team, each category averaged over
 * the done gradings, and every done grader's reasons so the numbers can be
 * explained later.
 */
export function resultsRows(
  snap: ProjectSnapshot,
  teams: { id: string; name: string; members: { name: string }[] }[],
): (string | number | null)[][] {
  const cats = snap.categories;
  const head = ["Team", "Members", "Graded by", ...cats.map((c) => c.name), "Total", "Out of", "Reasons"];
  const rows = teams.map((t) => {
    const r = teamResult(snap, t.id);
    const done = snap.gradings
      .filter((g) => g.team_id === t.id && g.done_at)
      .sort((a, b) => a.slot - b.slot);
    const reasons = done.map((g) => {
      const mine = scoresOf(snap.scores, t.id, g.slot);
      const each = cats.map((c) => {
        const s = mine.find((x) => x.category_id === c.id);
        return `${c.name} ${s?.score ?? "—"}: ${s?.reason.trim() || "—"}`;
      });
      return `${graderLabel(g, g.slot)} — ${each.join("; ")}`;
    });
    const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
    return [
      t.name,
      t.members.map((m) => m.name).join("; "),
      done.map((g) => graderLabel(g, g.slot)).join("; "),
      ...cats.map((c) => round(r.byCategory.get(c.id) ?? null)),
      round(r.total),
      outOf(cats),
      reasons.join(" | "),
    ];
  });
  return [head, ...rows];
}

/**
 * A spreadsheet reads a cell starting with = + - @ as a formula, and "-3 for
 * wobbling" is an ordinary reason. Those get a leading apostrophe; a plain
 * number is left alone so it stays a number.
 */
function cell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  const formula = /^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s));
  const safe = formula ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows as CSV text: CRLF, a trailing newline. */
export function toProjectCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
