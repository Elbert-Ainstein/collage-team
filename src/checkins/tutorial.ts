// The live tutorial sheet: who was absent, who presented, and how it went.
//
// Written by whoever runs check-ins (the course owner, or a TF given the
// permission), read back by the students it is about — their own team only.
// RLS decides both; nothing here re-filters for security.
//
// Needs supabase/migrations/0016_tutorial_check_ins.sql.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError } from "./data";

/** One check-in slot of a session, for one team. */
export interface TutorialMark {
  id: string;
  activity_id: string;
  team_id: string;
  /** 1-based: check-in 1, check-in 2. */
  slot: number;
  presenter_id: string | null;
  accuracy: number | null;
  discussion: number | null;
  updated_at: string;
}

export interface TutorialAbsence {
  activity_id: string;
  team_id: string;
  student_id: string;
}

/** How many check-ins one tutorial carries. Two, per the sheet. */
export const SLOTS = [1, 2] as const;
/** Both scales. */
export const SCALE = [1, 2, 3, 4, 5] as const;

const db = () => requireSupabase();

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

/**
 * A database without 0016 has neither table. The check-in sheet is a feature on
 * top of a working course, so a missing table degrades to an empty sheet with a
 * message rather than taking down the tab — the same call listMyQuestions makes
 * for 0014.
 */
function missingTable(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return /tutorial_marks|tutorial_absences|0016/.test(m);
}

export class TutorialNotInstalledError extends Error {
  constructor() {
    super(
      "This project has no tutorial check-in tables yet — run " +
        "supabase/migrations/0016_tutorial_check_ins.sql in the Supabase SQL editor.",
    );
    this.name = "TutorialNotInstalledError";
  }
}

export interface TutorialSheet {
  marks: TutorialMark[];
  absences: TutorialAbsence[];
}

/** Everything recorded for one activity, across every team. */
export async function getTutorialSheet(activityId: string): Promise<TutorialSheet> {
  try {
    const [marks, absences] = await Promise.all([
      db().from("tutorial_marks").select("*").eq("activity_id", activityId).order("slot"),
      db().from("tutorial_absences").select("*").eq("activity_id", activityId),
    ]);
    return {
      marks: (unwrap(marks) as TutorialMark[] | null) ?? [],
      absences: (unwrap(absences) as TutorialAbsence[] | null) ?? [],
    };
  } catch (e) {
    if (missingTable(e)) throw new TutorialNotInstalledError();
    throw e;
  }
}

/**
 * What one team was given for one activity — the student's side of the sheet.
 *
 * Marks only. Who else was marked absent is a fact about them, and 0016 does not
 * let a student read it at all; asking here would only produce an error.
 */
export async function getMyTeamMarks(activityId: string, teamId: string): Promise<TutorialMark[]> {
  try {
    return (
      (unwrap(
        await db().from("tutorial_marks").select("*")
          .eq("activity_id", activityId).eq("team_id", teamId).order("slot"),
      ) as TutorialMark[] | null) ?? []
    );
  } catch (e) {
    // A student's screen must not break because an optional migration has not
    // been run — they would have no idea what it meant or who to tell.
    if (missingTable(e)) return [];
    throw e;
  }
}

/** Every team's marks for one activity, for the teams this student is on. */
export async function listMyTeamMarks(teamId: string): Promise<TutorialMark[]> {
  try {
    return (
      (unwrap(
        await db().from("tutorial_marks").select("*").eq("team_id", teamId),
      ) as TutorialMark[] | null) ?? []
    );
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

/**
 * Set one field of one slot, creating the row if this is the first thing
 * recorded for it.
 *
 * Upsert on the natural key rather than read-then-write: two people can have the
 * same sheet open during a session (an instructor and a TF), and a read-then-
 * write would have the second insert fail on the unique index instead of
 * updating what the first one made.
 */
export async function setTutorialMark(
  where: { activityId: string; teamId: string; slot: number },
  patch: Partial<Pick<TutorialMark, "presenter_id" | "accuracy" | "discussion">>,
): Promise<TutorialMark> {
  const { activityId, teamId, slot } = where;
  try {
    const rows = unwrap(
      await db().from("tutorial_marks")
        .upsert(
          {
            activity_id: activityId,
            team_id: teamId,
            slot,
            ...patch,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "activity_id,team_id,slot" },
        )
        .select(),
    ) as TutorialMark[];
    return rows[0];
  } catch (e) {
    if (missingTable(e)) throw new TutorialNotInstalledError();
    throw e;
  }
}

/**
 * Replace the whole absence list for one team on one activity.
 *
 * Delete-then-insert for that team alone, so recording Team Helix cannot
 * disturb Team Vesicle. Not a transaction — PostgREST has none — so the window
 * between them is real; it is one team's absences on one activity, and the
 * person who set them is looking at the screen that would show it wrong.
 */
export async function setTutorialAbsences(
  activityId: string,
  teamId: string,
  studentIds: string[],
): Promise<void> {
  try {
    const del = await db().from("tutorial_absences").delete()
      .eq("activity_id", activityId).eq("team_id", teamId);
    if (del.error) throw dbError(del.error);

    const wanted = [...new Set(studentIds.filter(Boolean))];
    if (!wanted.length) return;

    const { error } = await db().from("tutorial_absences")
      .insert(wanted.map((student_id) => ({ activity_id: activityId, team_id: teamId, student_id })));
    if (error) throw dbError(error);
  } catch (e) {
    if (missingTable(e)) throw new TutorialNotInstalledError();
    throw e;
  }
}

/** The mark for one team's slot, or undefined. */
export function markFor(marks: TutorialMark[], teamId: string, slot: number): TutorialMark | undefined {
  return marks.find((m) => m.team_id === teamId && m.slot === slot);
}

/** Whether anything at all has been recorded on a mark — an empty row reads as untouched. */
export function markIsEmpty(m: TutorialMark | undefined): boolean {
  return !m || (m.presenter_id === null && m.accuracy === null && m.discussion === null);
}
