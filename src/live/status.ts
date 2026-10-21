// Where a live activity stands for one student, for their Assignments list.
//
// The ordinary status reads check_in_results, which a live activity only gets
// when it's scored — so on its own it would say "Not started" right through a
// student answering everything and their team locking every question. This
// reads the session instead, until there's a grade to show.

import type { AssignmentStatus } from "@/checkins/studentData";
import type { LivePhase } from "./types";

export interface LiveProgress {
  phase: LivePhase;
  /** Questions this student has answered on their own. */
  answered: number;
  questions: number;
}

export function liveStatus(
  progress: LiveProgress | undefined,
  /** What the gradebook says, from statusOf. Wins once it's a grade. */
  graded: AssignmentStatus,
  dueAt: string | null,
  now: Date = new Date(),
): AssignmentStatus {
  if (graded === "Graded" || graded === "Excused") return graded;
  if (!progress) return graded;
  const all = progress.questions > 0 && progress.answered >= progress.questions;
  if (progress.phase === "team") return "Discussing";
  if (progress.phase === "closed") return progress.answered > 0 ? "Turned in" : "Not started";
  if (all) return "Turned in";
  const due = dueAt ? Date.parse(dueAt) : NaN;
  return !Number.isNaN(due) && due < now.getTime() ? "Late" : "Not started";
}

/** The row's words, where the plain status would undersell it. */
export function liveStatusLabel(status: AssignmentStatus, progress: LiveProgress | undefined): string | null {
  if (!progress) return null;
  if (status === "Discussing") return "Team mode on";
  if ((status === "Not started" || status === "Late") && progress.answered > 0) {
    return `${progress.answered} of ${progress.questions} answered`;
  }
  return null;
}
