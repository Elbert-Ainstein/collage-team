// Where a team evaluation stands for one student, for their Assignments list.
//
// The ordinary status reads check_in_results, which a team evaluation only
// gets when it's sent to the gradebook — so on its own it would say "Not
// started" for someone who submitted days ago. This reads their submission
// instead, until there's a grade to show.

import type { AssignmentStatus } from "@/checkins/studentData";
import type { TeamEvalProgress } from "./data";

export function teamEvalStatus(
  progress: TeamEvalProgress | undefined,
  /** What the gradebook says, from statusOf. Wins once it's a grade. */
  graded: AssignmentStatus,
  dueAt: string | null,
  now: Date = new Date(),
): AssignmentStatus {
  if (graded === "Graded" || graded === "Excused") return graded;
  if (!progress) return graded;
  if (progress.submitted) return "Turned in";
  const due = dueAt ? Date.parse(dueAt) : NaN;
  return !Number.isNaN(due) && due < now.getTime() ? "Late" : "Not started";
}

/** The row's words, where the plain status would undersell it. */
export function teamEvalStatusLabel(status: AssignmentStatus, progress: TeamEvalProgress | undefined): string | null {
  if (!progress) return null;
  if (progress.released) return "Results are out";
  if (status === "Late") return "Late — still open";
  return null;
}
