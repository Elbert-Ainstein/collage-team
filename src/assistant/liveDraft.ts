// What the PDF import hands the live-questions builder, and how it asks.
//
// Shared by the route (src/assistant/server/liveImport*.ts) and the browser
// (src/faculty/live/importClient.ts), so there is one place that says what a
// draft is. Nothing here is written anywhere: a draft is a suggestion the
// builder shows, and the instructor edits and saves it as she would questions
// she typed herself. That is also why the keys in it are only ever SUGGESTED —
// the PDF usually has no answer key, so the model works them out, and grading
// is never done by AI anywhere in this app.

/** What a question becomes in the activity. Free response stays free response. */
export type LiveKind = "mc" | "number" | "expression";

/**
 * What the question was in the PDF. Drawing an arrow and clicking on a figure
 * come back converted to multiple choice; ranking and instruction pages are
 * left out.
 */
export type SourceKind =
  | "mc"
  | "numerical"
  | "expression"
  | "direction"
  | "click"
  | "ranking"
  | "instructions"
  | "other";

/** A rectangle on a page, as fractions of the page: 0,0 is its top left. */
export interface FigureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a question's figure is, so the browser can render that page and crop it. */
export interface DraftFigure {
  /** 1-based page of the PDF. */
  page: number;
  box: FigureBox;
}

export interface DraftItem {
  /** 1-based page of the PDF the question is on. */
  page: number;
  kind: LiveKind;
  /** What it was in the PDF, when the model said. */
  source?: SourceKind;
  /** The question, in the PDF's own words. */
  stem: string;
  /** mc only: 2–8 options, in the PDF's order. */
  options?: string[];
  /** mc only: index into options of the suggested answer, or null when there is none. */
  correctOption?: number | null;
  /** number only: the suggested answer, as a plain decimal ("0.25", "-3", "1.2e3"). */
  answer?: string;
  /** number only: its unit ("N", "m/s"), when it has one. */
  unit?: string;
  /** number only: how far off still counts, ± in the answer's unit. Never negative. */
  tolerance?: string;
  /** expression only: the forms that count as right, e.g. ["2*m*g", "2mg"]. */
  accept?: string[];
  figure?: DraftFigure;
  /** The working behind the suggested key. */
  why?: string;
  /** An assumption the key rests on, or a caveat for the instructor. */
  note?: string;
  /**
   * No suggested key: the instructor has to choose it. Always true when the
   * answer depends on a figure the model could not read, and whenever the key
   * fields above are empty — so the builder never has to work that out itself.
   */
  needsPick: boolean;
}

/** A page the import did not turn into a question, and why. */
export interface LeftOut {
  page: number;
  kind: SourceKind;
  reason: string;
}

export interface LiveDraft {
  /** A name for the activity, when the PDF has one. */
  title?: string;
  items: DraftItem[];
  leftOut: LeftOut[];
}

/** The bucket's own limit (0047), checked on both sides so neither has to find out from the other. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** The file's part of an import path: what importPath makes of the name she chose. */
const IMPORT_FILE = /^\d{1,16}-[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.pdf$/;

/**
 * Where a PDF goes in the "imports" bucket: <courseId>/<activityId>/<time>-<name>.
 *
 * The course comes first because the bucket's policies (0047) read it from the
 * path to decide who may touch the object. The name is cut down to letters,
 * digits, dots, dashes and underscores — a name with a slash or a space in it
 * is a different path, or a URL that needs escaping — and the time in front
 * keeps a second upload of the same file from colliding with the first.
 */
export function importPath(courseId: string, activityId: string, fileName: string, now: number): string {
  const base = fileName.replace(/\.pdf$/i, "");
  const safe =
    base
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
      .slice(0, 80)
      .replace(/[^A-Za-z0-9]+$/, "") || "questions";
  return `${courseId}/${activityId}/${Math.floor(now)}-${safe}.pdf`;
}

/** Whether a path is one importPath could have made for this course and activity — nothing else is fetched. */
export function isImportPath(path: string, courseId: string, activityId: string): boolean {
  const prefix = `${courseId}/${activityId}/`;
  return path.startsWith(prefix) && IMPORT_FILE.test(path.slice(prefix.length));
}

/** POST /api/live-import. `path` is the PDF's object in the private "imports" bucket. */
export interface LiveImportRequest {
  courseId: string;
  activityId: string;
  /** "<courseId>/<activityId>/<file>.pdf" */
  path: string;
}

export type LiveImportResponse = { ok: true; draft: LiveDraft } | { ok: false; error: string };
