// Projects (0059): the rows as the app reads them.
//
// A project is a rubric the staff take round a project fair. It is not an
// activity: students hand nothing in and see nothing. Each team gets graders
// (slots 1, 2, …); each grader gives every category a 1–5 score and a reason,
// then marks their grading done.

/** Each category is out of this many points. */
export const POINTS_PER_CATEGORY = 5;
/** The longest reason the database keeps (0059). */
export const REASON_MAX = 4000;
/** The most grader slots the database allows on one team (0059). */
export const MAX_SLOTS = 20;

export interface Project {
  id: string;
  course_id: string;
  title: string;
  /** How many grader slots each team shows to begin with. */
  graders_per_team: number;
  /**
   * The teams being graded. Null until the first grade: the project follows
   * the course's current teams until then.
   */
  team_set_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectCategory {
  id: string;
  project_id: string;
  position: number;
  name: string;
  /** What each point means: levels[0] describes a 1, levels[4] a 5. */
  levels: string[];
  created_at: string;
}

/** One grader's go at one team. */
export interface ProjectGrading {
  project_id: string;
  team_id: string;
  slot: number;
  grader_name: string;
  /** Set when the grader marked it done. */
  done_at: string | null;
  updated_by: string | null;
  updated_at: string;
}

/** One category of one grading. */
export interface ProjectScore {
  project_id: string;
  team_id: string;
  slot: number;
  category_id: string;
  /** Null when a reason was written before a score was picked. */
  score: number | null;
  reason: string;
  updated_at: string;
}

/** Everything one project's screens show. */
export interface ProjectSnapshot {
  project: Project;
  categories: ProjectCategory[];
  gradings: ProjectGrading[];
  scores: ProjectScore[];
}

/** The project list: each project with just enough to show its progress. */
export interface ProjectsOverview {
  projects: Project[];
  /** Categories per project id. */
  categoryCount: Map<string, number>;
  gradings: Pick<ProjectGrading, "project_id" | "team_id" | "slot" | "done_at">[];
}

/** Which grading: a team's slot on a project. */
export interface GradingKey {
  projectId: string;
  teamId: string;
  slot: number;
}
