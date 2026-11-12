// One class day where a course running a live activity shows students only its
// live activities.
//
// The full assignment list reads every result in the course to show statuses
// and grades. That read takes about 2 s on a quiet day and passed the 8 s
// statement timeout for 1 in 20 loads with ~40 students on (Nov 11). The list
// reloads on every phase change of a live session, so a full room starting team
// mode would all run it at once. With only live activities listed, it reads
// just their results.
//
// It ends on its own at LIVE_ONLY_UNTIL. Remove this file and its callers
// (listAssignments, AssignmentsList) after that.

/** When the live-only day ends: 5am Central the morning after class. */
export const LIVE_ONLY_UNTIL = "2026-11-13T05:00:00-06:00";

/** Whether the live-only day is still on. An unreadable end turns it off. */
export function liveOnlyActive(now: Date, until: string = LIVE_ONLY_UNTIL): boolean {
  const end = Date.parse(until);
  return !Number.isNaN(end) && now.getTime() < end;
}

/**
 * The activities a student sees today: only the live ones while the day is on
 * and the course has any, otherwise all of them. Returns a new array.
 */
export function liveOnly<T extends { type: string }>(
  activities: readonly T[],
  now: Date,
  until: string = LIVE_ONLY_UNTIL,
): T[] {
  if (!liveOnlyActive(now, until)) return [...activities];
  const live = activities.filter((a) => a.type === "live");
  return live.length > 0 ? live : [...activities];
}
