-- A question can be worth its own points.
--
-- Run in Supabase → SQL Editor, after 0033. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS FOR.
--
-- 0014 gave an activity ONE total and made its questions structure only: label
-- and position, no points. That reads every question as an equal share of the
-- total, and Kelly's combo is not that shape. Hers is 20 points across six
-- marked questions worth different amounts:
--
--   Challenge Problem 1: At Home Effort   3
--   Challenge Problem 1: Mark-up          2
--   Challenge Problem 2: At Home Effort   3
--   Challenge Problem 2: Mark-up          2
--   Tutorial Screen 1                     5
--   Tutorial Screen 2                     5
--
-- The worth matters because a ladder is WRITTEN as awards and STORED as
-- deductions: score = points_total - sum of the deductions picked. "+1 pt" on
-- the 3-point At Home Effort question is a deduction of 2; the same "+1" on the
-- 2-point Mark-up question is a deduction of 1. Without a per-question worth
-- there is no number to do that subtraction against, so the app cannot write
-- her rubric down. The conversion itself lives in src/faculty/model.ts, in one
-- place, with a test.
--
-- ---------------------------------------------------------------------------
-- WHAT NULL MEANS, AND WHY IT IS THE DEFAULT.
--
-- NULL is UNSET, and it is not zero. A question with no worth of its own has
-- criteria that deduct from the ACTIVITY total, which is what every criterion
-- in this course has always done. So the column arrives null on every row that
-- exists and every one of those activities keeps behaving exactly as it did
-- yesterday, on the app side as well as here.
--
-- ---------------------------------------------------------------------------
-- WHAT HAPPENS WHEN THE QUESTIONS DO NOT ADD UP TO points_total.
--
-- Nothing. On purpose, and it is worth being explicit because it is a state
-- faculty reach by typing — the moment she has entered four of her six
-- questions, they add to 10 and the activity is out of 20.
--
--   * points_total is NOT derived from the questions. It stays the one number
--     faculty chose and stays what recompute_result_score subtracts from. That
--     trigger is the single path every grade in the course goes through, and
--     making its input depend on a second table would put every score on the
--     activity one keystroke away from moving.
--   * There is no constraint here that the questions sum to the total, and
--     there cannot usefully be one: it would fire on the half-typed rubric and
--     refuse the fifth question because the sixth is not in yet.
--   * Nothing is rescaled to fit. Silently stretching her numbers would change
--     what every criterion awards without her having typed it.
--
-- What a gap actually does, since the app has to tell her the truth about it:
-- scores still come off points_total, so if the questions add to less than the
-- total, a submission that loses every point still scores the difference; if
-- they add to more, it reaches 0 with points still to lose. Every score moves
-- by the same constant. src/faculty/model.ts (tallyQuestionPoints) computes the
-- gap and words it; the database's job is to hold what she typed.
--
-- ---------------------------------------------------------------------------
-- WHY NO EXISTING SCORE CAN MOVE. Four reasons, and if any one of them were
-- false this file would not ship.
--
--   1. The column is nullable with no default, so the ALTER writes no value
--      into any existing row and no row's meaning changes.
--   2. Nothing on the scoring path reads it. recompute_result_score (0014)
--      selects activities.points_total and sums rubric_items.deduction; this
--      file alters neither table and defines no function or trigger.
--   3. This file contains no INSERT, UPDATE or DELETE at all. So it cannot
--      fire trg_marks_rescore (submission_marks) or activity_points_rescore
--      (activities.points_total) — the only two triggers that re-score.
--   4. The check constraint is satisfied by NULL, which is what every existing
--      row holds, so adding it validates clean and cannot force anybody to
--      edit data to get this migration in.
--
-- RLS needs nothing: 0014's "own activity_questions" policy is FOR ALL and is
-- row-scoped, so the owner can write the new column and a TF still cannot; the
-- TF and student SELECT policies are row-scoped too, so both simply see it.
-- ---------------------------------------------------------------------------

alter table activity_questions add column if not exists points numeric;

alter table activity_questions drop constraint if exists activity_questions_points_nonneg;
alter table activity_questions add constraint activity_questions_points_nonneg
  check (points is null or points >= 0);

comment on column activity_questions.points is
  'What this question is out of, for a rubric whose questions are worth different amounts. NULL is UNSET, not zero: its criteria deduct from the activity total, as they always have. Deliberately not constrained to sum to activities.points_total - the total is still the one number scores come off, and a mismatch is reported to faculty rather than fixed behind them.';

-- 0014's comment on the table says questions deliberately carry no points. That
-- was true of 0014 and is the thing this migration changes, so it is restated
-- rather than left to contradict the column above.
comment on table activity_questions is
  'The questions of an activity, in order. A question may carry its own points (0034); a question with none is worth the activity total to its criteria. What the activity is OUT OF stays one number on activities.points_total, and that is what recompute_result_score subtracts from.';
