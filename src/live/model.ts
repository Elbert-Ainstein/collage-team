// One live activity, in the shape the screens ask questions of.
//
// Built from what was loaded — the snapshot (0047's rows, as much as the
// caller may read), the course roster and the activity's teams — plus the
// clock. Pure: every screen on both sides reads the same answers to "what did
// this student say", "where is this team", "how did it score", so a number on
// the instructor's team card and on a student's results can't disagree.

import type { Student, TeamWithMembers } from "@/checkins/types";
import { isRight, optionLetter, tryCredit } from "./answers";
import {
  absentIds,
  explanationFor,
  isAbsent,
  leaderOf,
  leaderTally,
  mayLead,
  teamStage,
  type LeaderTally,
  type TeamStage,
} from "./leader";
import type { AbsenceSource, LiveAttempt, LiveKey, LiveLock, LiveQuestion, LiveSnapshot, LiveState } from "./types";

export interface LiveModelInput {
  snapshot: LiveSnapshot;
  students: Student[];
  /** The activity's teams — frozen ones once it has run (teamsOf in rosters.ts). */
  teams: TeamWithMembers[];
  /** Expression answers decided by algebra: question id → answer → right. */
  verdicts?: Record<string, Record<string, boolean>>;
  /** Milliseconds, for "how long on this question". */
  now: number;
}

export interface TeamCurrent {
  /** Index of the question the team is on: the first one it hasn't locked. */
  q: number;
  /** Seconds on it: since the last lock, or since team mode started. */
  since: number;
  /**
   * Each member's vote on it, in member order. A vote still sitting on an
   * answer the team has tried is no vote: that answer is off the table.
   */
  votes: (string | null)[];
}

export interface LiveModel {
  state: LiveState;
  questions: LiveQuestion[];
  students: Student[];
  teams: TeamWithMembers[];
  key(q: number): LiveKey | undefined;
  /** Right, wrong, or null when the caller can't see the key. */
  right(q: number, answer: string | null): boolean | null;
  own(studentId: string, q: number): string | null;
  answered(studentId: string): number;
  /** Own answers right, or null without the keys. */
  ownScore(studentId: string): number | null;
  teamOf(studentId: string): TeamWithMembers | null;
  /** Each question's lock: the team is done with it — right, out of tries, or moved on. */
  locks(teamId: string): (LiveLock | null)[];
  done(teamId: string): number;
  /** The team's tries at question q, first first. A lock from before 0049 is one try. */
  tries(teamId: string, q: number): LiveAttempt[];
  /** The try the team got q right on; 0 if it hasn't (yet); null when that isn't known. */
  rightOn(teamId: string, q: number): number | null;
  /** What q earned the team (tryCredit), or null when that isn't known. */
  credit(teamId: string, q: number): number | null;
  /** Credit summed over the questions: what the gradebook's team score is. */
  score(teamId: string): number | null;
  /** What team time earned this student: their team's score, or 0 if marked absent. Null with no team. */
  memberScore(studentId: string): number | null;
  current(teamId: string): TeamCurrent | null;
  /** Seconds from team mode starting to the last lock, once every question is locked. */
  finishedAt(teamId: string): number | null;
  /** Seconds each locked question took, in the order they were locked. */
  durations(teamId: string): number[];
  /** What a value looks like on screen: "B", "19.6 m/s", "F/2". */
  label(q: number, answer: string): string;
  /** Picking a leader, taking the roll, or playing (0051); always "play" without it. */
  stage(teamId: string): TeamStage;
  /** Where the team's vote for leader stands, among its members who are there. */
  leaderTally(teamId: string): LeaderTally;
  /** The team's leader; null until picked, or while the one picked is marked absent. */
  leaderOf(teamId: string): string | null;
  /** May this student submit for the team and move it on? */
  mayLead(teamId: string, studentId: string): boolean;
  /** Who on the team is marked absent — by either, or only by the sheet or the roll. */
  absentIds(teamId: string, source?: AbsenceSource): string[];
  isAbsent(studentId: string): boolean;
  /** Question q's explanation, if the caller may read it yet. */
  explanation(q: number): string | null;
}

const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000));

export function buildLiveModel(input: LiveModelInput): LiveModel {
  const { snapshot, students, teams, verdicts = {}, now } = input;
  const questions = [...snapshot.questions].sort((a, b) => a.position - b.position);
  const keys = new Map(snapshot.keys.map((k) => [k.question_id, k]));

  const own = new Map<string, string>();
  const ownCorrect = new Map<string, boolean | null>();
  for (const r of snapshot.responses) {
    own.set(`${r.student_id}:${r.question_id}`, r.answer);
    ownCorrect.set(`${r.student_id}:${r.question_id}`, r.correct);
  }
  const lockOf = new Map<string, LiveLock>();
  for (const l of snapshot.locks) lockOf.set(`${l.team_id}:${l.question_id}`, l);
  const attemptsOf = new Map<string, LiveAttempt[]>();
  for (const a of snapshot.attempts) {
    const k = `${a.team_id}:${a.question_id}`;
    attemptsOf.set(k, [...(attemptsOf.get(k) ?? []), a]);
  }
  for (const list of attemptsOf.values()) list.sort((a, b) => a.attempt - b.attempt);
  const voteOf = new Map<string, string>();
  for (const v of snapshot.votes) voteOf.set(`${v.student_id}:${v.question_id}`, v.answer);
  const teamByStudent = new Map<string, TeamWithMembers>();
  for (const t of teams) for (const s of t.members) teamByStudent.set(s.id, t);

  const started = snapshot.state.team_started_at ? Date.parse(snapshot.state.team_started_at) : null;

  const right = (q: number, answer: string | null, stored?: boolean | null): boolean | null => {
    if (answer === null) return false;
    // Scored: the database decided, and that's what the gradebook says.
    if (stored === true || stored === false) return stored;
    const question = questions[q];
    const key = question && keys.get(question.id);
    if (!question || !key) return null;
    if (question.kind === "expression") {
      const v = verdicts[question.id]?.[answer];
      if (v !== undefined) return v;
      return key.accept.some((a) => a.replace(/\s+/g, "").toLowerCase() === answer.replace(/\s+/g, "").toLowerCase());
    }
    return isRight(question, key, answer);
  };

  const locks = (teamId: string) => questions.map((q) => lockOf.get(`${teamId}:${q.id}`) ?? null);

  const tries = (teamId: string, q: number): LiveAttempt[] => {
    const question = questions[q];
    if (!question) return [];
    const list = attemptsOf.get(`${teamId}:${question.id}`);
    if (list?.length) return list;
    // Locked before 0049, or on a database without it: the lock was the one try.
    const l = lockOf.get(`${teamId}:${question.id}`);
    return l ? [{ ...l, attempt: 1 }] : [];
  };

  const rightOn = (teamId: string, q: number): number | null => {
    for (const t of tries(teamId, q)) {
      const v = right(q, t.answer, t.correct);
      if (v === null) return null;
      if (v) return t.attempt;
    }
    return 0;
  };

  const credit = (teamId: string, q: number): number | null => {
    const on = rightOn(teamId, q);
    return on === null ? null : on === 0 ? 0 : tryCredit(on);
  };

  const sortedLockTimes = (teamId: string) =>
    locks(teamId)
      .filter((l): l is LiveLock => l !== null)
      .map((l) => Date.parse(l.locked_at))
      .sort((a, b) => a - b);

  /** Credit summed over the questions: null while any question's isn't known. */
  const score = (tid: string): number | null => {
    let n = 0;
    for (let i = 0; i < questions.length; i++) {
      const c = credit(tid, i);
      if (c === null) return null;
      n += c;
    }
    return n;
  };

  return {
    state: snapshot.state,
    questions,
    students,
    teams,
    key: (q) => (questions[q] ? keys.get(questions[q].id) : undefined),
    right: (q, answer) => right(q, answer),
    own: (sid, q) => (questions[q] ? own.get(`${sid}:${questions[q].id}`) ?? null : null),
    answered: (sid) => questions.filter((q) => own.has(`${sid}:${q.id}`)).length,
    ownScore: (sid) => {
      let n = 0;
      for (let i = 0; i < questions.length; i++) {
        const k = `${sid}:${questions[i].id}`;
        const v = right(i, own.get(k) ?? null, ownCorrect.get(k));
        if (v === null) return null;
        if (v) n++;
      }
      return n;
    },
    teamOf: (sid) => teamByStudent.get(sid) ?? null,
    locks,
    done: (tid) => locks(tid).filter(Boolean).length,
    tries,
    rightOn,
    credit,
    score,
    memberScore: (sid) => {
      const t = teamByStudent.get(sid);
      if (!t) return null;
      return isAbsent(snapshot, sid) ? 0 : score(t.id);
    },
    current: (tid) => {
      if (snapshot.state.phase !== "team" || started === null) return null;
      const ls = locks(tid);
      const q = ls.findIndex((l) => l === null);
      if (q === -1) return null;
      const team = teams.find((t) => t.id === tid);
      const times = sortedLockTimes(tid);
      const from = times.length ? Math.max(started, times[times.length - 1]) : started;
      const tried = new Set(tries(tid, q).map((t) => t.answer));
      return {
        q,
        since: seconds(now - from),
        votes: (team?.members ?? []).map((m) => {
          const v = voteOf.get(`${m.id}:${questions[q].id}`) ?? null;
          return v !== null && tried.has(v) ? null : v;
        }),
      };
    },
    finishedAt: (tid) => {
      if (started === null || questions.length === 0) return null;
      const times = sortedLockTimes(tid);
      return times.length === questions.length ? seconds(times[times.length - 1] - started) : null;
    },
    durations: (tid) => {
      if (started === null) return [];
      const times = sortedLockTimes(tid);
      return times.map((t, i) => seconds(t - (i === 0 ? started : times[i - 1])));
    },
    label: (q, answer) => {
      const question = questions[q];
      if (!question) return answer;
      if (question.kind === "number" && question.unit) return `${answer} ${question.unit}`;
      return answer;
    },
    stage: (tid) => teamStage(snapshot, tid),
    leaderTally: (tid) =>
      leaderTally(snapshot, tid, (teams.find((t) => t.id === tid)?.members ?? []).map((m) => m.id)),
    leaderOf: (tid) => leaderOf(snapshot, tid),
    mayLead: (tid, sid) => mayLead(snapshot, tid, sid),
    absentIds: (tid, source) => absentIds(snapshot, tid, source),
    isAbsent: (sid) => isAbsent(snapshot, sid),
    explanation: (q) => (questions[q] ? explanationFor(snapshot, questions[q].id) : null),
  };
}

/** The option text behind a letter, for multiple choice. */
export function optionText(question: LiveQuestion, letter: string): string | null {
  const i = letter.charCodeAt(0) - 65;
  return question.kind === "mc" ? question.options[i] ?? null : null;
}

export { optionLetter };

export type OutcomeTone = "good" | "gain" | "warn" | "bad" | "muted";

/**
 * What happened between a student's own answer and their team's, in a few
 * words. `teamRightOn` is the try the team got it right on (rightOn): 0 for
 * never, null when that isn't known.
 */
export function outcomeOf(ownRight: boolean | null, teamRightOn: number | null): { label: string; tone: OutcomeTone } {
  if (ownRight === null || teamRightOn === null) return { label: "Not scored yet", tone: "muted" };
  if (teamRightOn === 1) {
    return ownRight ? { label: "Right both times", tone: "good" } : { label: "Team brought them round", tone: "gain" };
  }
  if (ownRight) return { label: "Was right — team went another way", tone: "warn" };
  if (teamRightOn > 1) return { label: `Team got there on try ${teamRightOn}`, tone: "warn" };
  return { label: "Missed both times", tone: "bad" };
}

/** Points as they're shown: "3", "2.5", "0.75" — two places at most, as team credit (1, 0.5, 0.25) needs. */
export const fmtPoints = (n: number): string => String(Math.round(n * 100) / 100);

export const mmss = (sec: number): string => {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
