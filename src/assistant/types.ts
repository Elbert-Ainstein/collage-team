// What the faculty assistant sends and gets back.
//
// The assistant is a drafter, not an actor. The server reads the instructor's
// request and answers with either a sentence or a PROPOSAL — a description of
// a change — and never touches the database: it holds the model key and no
// Supabase rights at all. Every write happens in the browser, under the
// instructor's own session and row-level security, after she has looked at the
// proposal and pressed the button that applies it. So the worst a confused
// model can do is draft something wrong, and the preview is where that shows.
//
// Students and teams travel as short refs ("s12", "t3") rather than row ids.
// A ref is shorter for the model to copy, and a ref it invents is a ref the
// browser cannot find — refused by name in the preview, not written somewhere
// unexpected. The browser is the only side that knows which row a ref means.

/** One student as the model sees them. */
export interface SnapshotStudent {
  ref: string;
  name: string;
  email: string | null;
}

/** One team as the model sees it, with its members by ref. */
export interface SnapshotTeam {
  ref: string;
  name: string;
  members: string[];
}

/** The course as it stands, sent with every request so the answer is about now. */
export interface Snapshot {
  course: { name: string; code: string | null; term: string | null };
  students: SnapshotStudent[];
  teams: SnapshotTeam[];
}

/**
 * One column of a file the instructor attached — a SUMMARY, never its cells.
 * Categories carry their values and counts; numbers their range; names and
 * addresses nothing but that they are names and addresses. The rows stay in
 * the browser, where code forms the teams (src/faculty/assistant/formTeams.ts).
 */
export interface AttachmentColumn {
  name: string;
  kind: "number" | "category" | "text";
  filled: number;
  distinct: number;
  values?: { value: string; count: number }[];
  min?: number;
  max?: number;
  mean?: number;
  looksLike?: "email" | "name";
}

export interface AttachmentSummary {
  name: string;
  rows: number;
  columns: AttachmentColumn[];
}

/** An earlier turn of the conversation, as plain text. */
export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantRequest {
  courseId: string;
  message: string;
  history: Turn[];
  snapshot: Snapshot;
  /** The file attached to this message, summarised. */
  attachment?: AttachmentSummary;
}

/** One student moved onto a team: an existing one by ref, or a new one by name. */
export interface SeatMove {
  student: string;
  toTeam: string | null;
  toNewTeam: string | null;
}

/** Targeted changes: moves, new teams, renames. */
export interface SeatProposal {
  kind: "seat";
  summary: string;
  moves: SeatMove[];
  renames: { team: string; name: string }[];
  /** Things the request named that the model could not pin to one student. */
  unresolved: { entry: string; reason: string }[];
}

/** A class list rewritten as rows for the Teams screen's own importer. */
export interface ImportRow {
  name: string;
  email: string | null;
  team: number | null;
}

export interface ImportProposal {
  kind: "import";
  summary: string;
  rows: ImportRow[];
}

/**
 * A whole new set of teams, formed by code from rules. The model only says
 * which columns matter and how; formTeams.ts decides who goes where.
 */
export interface FormProposal {
  kind: "form";
  summary: string;
  teamSize: number;
  /**
   * When the class does not divide by teamSize: make the odd teams one SMALLER
   * (teams of 4 and a few of 3), one LARGER (a few of 5), or EITHER — whichever
   * mixes the rules better. Kelly asked for 4s with the leftovers in 3s, and
   * "either" kept choosing 5s because a team of 3 is harder to mix; it is her
   * call, not the optimiser's.
   */
  leftovers: Leftovers;
  /** "Make 20 teams": the class split as evenly as it goes. Overrides teamSize. */
  teamCount: number | null;
  /** An exact layout — 16 of 4 and 2 of 3. Overrides both. Empty when not given. */
  layout: { size: number; count: number }[];
  /** Keep apart anyone on the same team now. */
  avoidCurrent: boolean;
  /** Keep apart anyone sharing a value in these columns (earlier teams in the file). */
  avoidColumns: string[];
  /** The column(s) holding each student's name — two for First and Last. */
  nameColumns: string[];
  emailColumn: string | null;
  balance: { column: string; kind: "category" | "number"; values: string[] }[];
  /** Columns where nobody may be the only one of their value on a team (gender). */
  noIsolation: string[];
  /** No team holds more than `max` whose column is one of `values` (one first-year). */
  atMost: { column: string; values: string[]; max: number }[];
  /** Rules she gave that these settings cannot express, said out loud. */
  notApplied: string[];
}

export type Leftovers = "smaller" | "larger" | "either";

/** The attached file is a class list: open it in the Teams importer as it is. */
export interface FileImportProposal {
  kind: "import-file";
  summary: string;
}

export type Proposal = SeatProposal | ImportProposal | FormProposal | FileImportProposal;

export type AssistantReply =
  | { kind: "message"; text: string }
  | { kind: "proposal"; text: string; proposal: Proposal };

/** The envelope every response from the route comes in. */
export type AssistantResponse =
  | { ok: true; reply: AssistantReply }
  | { ok: false; error: string };
