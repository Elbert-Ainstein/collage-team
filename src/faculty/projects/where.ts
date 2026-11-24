// Where you are inside the Projects tab, on the URL beside FacultyApp's own
// ?s=projects: which project, which team, which grader, or the editor. A
// reload halfway through grading a team lands back on that grading, and a
// link to one team's sheet can be sent to the TF standing at it.

export interface ProjectWhere {
  /** The open project. */
  project: string | null;
  /** The open team, on that project. */
  team: string | null;
  /** The open grader slot, on that team. */
  slot: number | null;
  /** The editor: a new project, or the open one's rubric. */
  edit: "new" | "edit" | null;
}

/** The query keys this tab owns. FacultyApp drops them on every other screen. */
export const PROJECT_PARAMS = ["proj", "team", "slot", "edit"] as const;

export const AT_LIST: ProjectWhere = { project: null, team: null, slot: null, edit: null };

export function readProjectWhere(search: string): ProjectWhere {
  const q = new URLSearchParams(search);
  const project = q.get("proj") || null;
  const team = project ? q.get("team") || null : null;
  const n = Number(q.get("slot"));
  const slot = team && Number.isInteger(n) && n >= 1 ? n : null;
  const e = q.get("edit");
  const edit = e === "new" ? "new" : e === "edit" && project ? "edit" : null;
  return { project: edit === "new" ? null : project, team: edit ? null : team, slot: edit ? null : slot, edit };
}

/** The query string for `w`, keeping every key this tab doesn't own. */
export function projectSearch(search: string, w: ProjectWhere): string {
  const q = new URLSearchParams(search);
  for (const k of PROJECT_PARAMS) q.delete(k);
  if (w.project) q.set("proj", w.project);
  if (w.project && w.team) q.set("team", w.team);
  if (w.project && w.team && w.slot) q.set("slot", String(w.slot));
  if (w.edit) q.set("edit", w.edit);
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

export function writeProjectWhere(w: ProjectWhere, mode: "push" | "replace"): void {
  const url = window.location.pathname + projectSearch(window.location.search, w) + window.location.hash;
  const state: unknown = window.history.state;
  if (mode === "push") window.history.pushState(state, "", url);
  else window.history.replaceState(state, "", url);
}
