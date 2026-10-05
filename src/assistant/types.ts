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

export type Proposal = SeatProposal | ImportProposal;

export type AssistantReply =
  | { kind: "message"; text: string }
  | { kind: "proposal"; text: string; proposal: Proposal };

/** The envelope every response from the route comes in. */
export type AssistantResponse =
  | { ok: true; reply: AssistantReply }
  | { ok: false; error: string };
