// The live tutorial sheet: who was absent, who presented, and how it went.
//
// Written by whoever runs check-ins (the course owner, or a TF given the
// permission), read back by the students it is about — their own team's marks,
// and their own absence. RLS decides both; nothing here re-filters for security.
//
// A mark is recorded against a TEAM and scored against a STUDENT: the two tables
// below are the only copy of that, and studentMarks is the only place the
// per-person number is worked out.
//
// Needs supabase/migrations/0016_tutorial_check_ins.sql, and 0031 for the
// student's own absence.

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

/**
 * Who is grading one team's work on one CHECK-IN (0040, per-slot in 0041).
 *
 * Per slot because the room is split per check-in: teams present their sections
 * one at a time and the staff swap between them, so one team's two check-ins
 * can be graded by two different people.
 */
export interface TutorialGrader {
  activity_id: string;
  team_id: string;
  /** Which check-in, 1 or 2 — the same slot tutorial_marks is keyed on. */
  slot: number;
  /**
   * A course_tfs row — the TF as the TFs tab manages them, signed up or not —
   * or null when the grader is the instructor, who has no row on that roster.
   */
  tf_id: string | null;
  /** The course's instructor is grading this one. Exactly one of the two. */
  instructor: boolean;
}

/**
 * What a pick is, on the sheet: a course_tfs id, or the instructor.
 *
 * The instructor is a sentinel rather than an id because the owner is not on
 * the TF roster and has no row to name — and the app cannot read their profile
 * either, so "Instructor" is also all a TF could be shown.
 */
export const INSTRUCTOR = "instructor";
export type GraderPick = string;

/** How many check-ins one tutorial carries. Two, per the sheet. */
export const SLOTS = [1, 2] as const;
/** Both scales. */
export const SCALE = [1, 2, 3, 4, 5] as const;

/**
 * What the two scales are CALLED. The columns they write are still accuracy and
 * discussion — the words on a sheet are not a schema, and renaming a column to
 * change a heading would be a migration and a rewrite of every reader for no
 * gain. Faculty and student both read the names from here so the sheet and the
 * card a student sees can never end up calling one scale two things.
 */
export const SCALE_LABEL = {
  accuracy: "Preparation and understanding",
  discussion: "Engagement and reflection",
} as const;

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
  graders: TutorialGrader[];
}

/**
 * The graders for one activity, degrading on an older database.
 *
 * Three shapes are live: 0041's, 0040's one-pick-per-team, and no table at all.
 * A 0040 row was one pick meant for the whole activity — the same reading the
 * migration takes — so it is shown against BOTH check-ins rather than vanishing
 * from the second one. No table means no column, not a broken sheet.
 */
async function readGraders(activityId: string): Promise<TutorialGrader[]> {
  const fresh = await db()
    .from("tutorial_graders")
    .select("activity_id,team_id,slot,tf_id,instructor")
    .eq("activity_id", activityId)
    .then(
      (r) => (r.error ? null : ((r.data as TutorialGrader[] | null) ?? [])),
      () => null,
    );
  if (fresh) return fresh;

  const legacy = await db()
    .from("tutorial_graders")
    .select("activity_id,team_id,tf_id")
    .eq("activity_id", activityId)
    .then(
      (r) =>
        r.error ? [] : ((r.data as { activity_id: string; team_id: string; tf_id: string }[] | null) ?? []),
      () => [] as { activity_id: string; team_id: string; tf_id: string }[],
    );
  return legacy.flatMap((g) =>
    SLOTS.map((slot) => ({ ...g, slot, instructor: false })),
  );
}

/** Everything recorded for one activity, across every team. */
export async function getTutorialSheet(activityId: string): Promise<TutorialSheet> {
  try {
    const [marks, absences, graders] = await Promise.all([
      db().from("tutorial_marks").select("*").eq("activity_id", activityId).order("slot"),
      db().from("tutorial_absences").select("*").eq("activity_id", activityId),
      // Newer than the sheet itself (0040/0041): on a database without it the
      // sheet still works, minus the Grader column, rather than telling a TF
      // mid-session the whole tab is not installed.
      readGraders(activityId),
    ]);
    return {
      marks: (unwrap(marks) as TutorialMark[] | null) ?? [],
      absences: (unwrap(absences) as TutorialAbsence[] | null) ?? [],
      graders,
    };
  } catch (e) {
    if (missingTable(e)) throw new TutorialNotInstalledError();
    throw e;
  }
}

/**
 * What ONE STUDENT was given for one slot.
 *
 * The team is what gets marked — that is the right interaction, one row per team
 * filled in while the room is being walked — but the score belongs to a person.
 * Everyone who was in the room gets the team's numbers; anyone ticked absent for
 * that activity gets 0, because they were not there to earn them.
 *
 * Field-compatible with TutorialMark on purpose: the screens that already render
 * a slot read presenter_id, accuracy and discussion, and swapping the team's
 * numbers for the student's should not be a rewrite of how a slot looks.
 */
export interface StudentMark {
  slot: number;
  student_id: string;
  /** Ticked absent for this activity, so the two scores below read 0. */
  absent: boolean;
  presenter_id: string | null;
  /** The team's number, 0 when this student was away, null when unmarked. */
  accuracy: number | null;
  discussion: number | null;
}

/**
 * A team's mark, resolved for one member.
 *
 * An untouched field stays null rather than becoming 0. The team not having been
 * marked yet is not the same fact as a student having missed it, and a card that
 * says 0 the moment an instructor opens the sheet is telling everyone they
 * failed something nobody has looked at.
 */
function forStudent(teamValue: number | null, absent: boolean): number | null {
  if (teamValue === null) return null;
  return absent ? 0 : teamValue;
}

/** Who was ticked absent on one team — the ids, in no particular order. */
export function absentIds(absences: TutorialAbsence[], teamId: string): string[] {
  return absences.filter((a) => a.team_id === teamId).map((a) => a.student_id);
}

/**
 * One student's slots, derived from the team sheet.
 *
 * Derived and never stored. tutorial_marks and tutorial_absences already carry
 * every fact this needs, and a stored per-student copy would have to be rewritten
 * on every mark and every absence tick — including the ticks that happen after a
 * mark, which is the case that would be missed.
 */
export function studentMarks(
  marks: TutorialMark[],
  absences: TutorialAbsence[],
  teamId: string,
  studentId: string,
): StudentMark[] {
  const absent = absences.some((a) => a.team_id === teamId && a.student_id === studentId);
  return marks
    .filter((m) => m.team_id === teamId)
    .sort((a, b) => a.slot - b.slot)
    .map((m) => ({
      slot: m.slot,
      student_id: studentId,
      absent,
      presenter_id: m.presenter_id,
      accuracy: forStudent(m.accuracy, absent),
      discussion: forStudent(m.discussion, absent),
    }));
}

/**
 * What THIS student was given for one activity — the student's side of the sheet.
 *
 * Two reads in parallel, not one: there is no relationship between the two tables
 * for PostgREST to embed, and the team's marks alone are not this student's score
 * — an absent student's team can be sitting on a 5 they were not in the room for.
 * The absence read is theirs alone; 0031 grants exactly their own rows, so who
 * ELSE was away stays as invisible as 0016 made it.
 *
 * Without 0031 that second read comes back EMPTY rather than failing — RLS
 * filters, it does not raise — so an absent student would quietly go on seeing
 * their team's number. There is nothing the browser can check to tell the two
 * apart; the migration has to be run.
 */
export async function getMyMarks(
  activityId: string,
  teamId: string,
  studentId: string,
): Promise<StudentMark[]> {
  try {
    const [marks, absences] = await Promise.all([
      db().from("tutorial_marks").select("*")
        .eq("activity_id", activityId).eq("team_id", teamId).order("slot"),
      db().from("tutorial_absences").select("*")
        .eq("activity_id", activityId).eq("team_id", teamId).eq("student_id", studentId),
    ]);
    return studentMarks(
      (unwrap(marks) as TutorialMark[] | null) ?? [],
      (unwrap(absences) as TutorialAbsence[] | null) ?? [],
      teamId,
      studentId,
    );
  } catch (e) {
    // A student's screen must not break because an optional migration has not
    // been run — they would have no idea what it meant or who to tell.
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

/**
 * Set — or clear, with null — who is grading one team on one check-in.
 *
 * Upsert on the natural key for the same reason setTutorialMark is: two people
 * can have the sheet open, and read-then-write would fail the second one on
 * the primary key instead of updating what the first one wrote.
 */
export async function setTutorialGrader(
  activityId: string,
  teamId: string,
  slot: number,
  pick: GraderPick | null,
): Promise<void> {
  try {
    if (pick === null) {
      const { error } = await db()
        .from("tutorial_graders")
        .delete()
        .eq("activity_id", activityId)
        .eq("team_id", teamId)
        .eq("slot", slot);
      if (error) throw dbError(error);
      return;
    }
    const { error } = await db().from("tutorial_graders").upsert(
      {
        activity_id: activityId,
        team_id: teamId,
        slot,
        tf_id: pick === INSTRUCTOR ? null : pick,
        instructor: pick === INSTRUCTOR,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "activity_id,team_id,slot" },
    );
    if (error) throw dbError(error);
  } catch (e) {
    if (/tutorial_graders|\bslot\b|instructor/.test(String((e as Error)?.message ?? e))) {
      throw new Error(
        "The Grading TF column needs supabase/migrations/0040_checkin_graders.sql " +
          "and 0041_checkin_graders_per_slot.sql — run them in the Supabase SQL editor.",
      );
    }
    throw e;
  }
}

/** Who is grading one team's check-in, or null when nobody is picked. */
export function graderFor(
  graders: TutorialGrader[],
  teamId: string,
  slot: number,
): GraderPick | null {
  const row = graders.find((g) => g.team_id === teamId && g.slot === slot);
  if (!row) return null;
  return row.instructor ? INSTRUCTOR : row.tf_id;
}

/** The mark for one team's slot, or undefined. */
export function markFor(marks: TutorialMark[], teamId: string, slot: number): TutorialMark | undefined {
  return marks.find((m) => m.team_id === teamId && m.slot === slot);
}

/** Whether anything at all has been recorded on a mark — an empty row reads as untouched. */
export function markIsEmpty(m: TutorialMark | undefined): boolean {
  return !m || (m.presenter_id === null && m.accuracy === null && m.discussion === null);
}
