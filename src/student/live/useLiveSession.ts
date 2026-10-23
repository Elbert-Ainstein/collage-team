"use client";

// One live activity, from a student's seat: the rows RLS lets them read
// (their own answers; their team's answers, votes and locks once team mode is
// on; the key once it's shown), kept current by realtime with a slow poll
// behind it in case a socket drops on a classroom's wifi.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Enrolment } from "@/checkins/studentData";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { expressionVerdicts } from "@/live/answers";
import { loadLive, watchLive } from "@/live/data";
import { buildLiveModel, type LiveModel } from "@/live/model";
import type { LiveSnapshot } from "@/live/types";

const POLL_MS = 30_000;

export interface LiveSession {
  snap: LiveSnapshot | null;
  /** Null until loaded, and when this database has no live data for it. */
  model: LiveModel | null;
  team: TeamWithMembers | null;
  loading: boolean;
  /** The last read failed (a dropped connection): the screen offers a retry. */
  failed: boolean;
  reload: () => Promise<void>;
}

/**
 * Who's on the team this activity runs with. Before team mode, the team they
 * are on now. After, the frozen one (`teamId`, 0045) — usually the same
 * people; if not, whoever the answers and votes they can read belong to, with
 * the names of the ones they know.
 */
function teamFor(enrolment: Enrolment, teamId: string | null, snap: LiveSnapshot | null): TeamWithMembers | null {
  const id = teamId ?? enrolment.team?.id ?? null;
  if (!id) return null;
  const known = new Map<string, Student>([
    [enrolment.student.id, enrolment.student],
    ...enrolment.teammates.map((s) => [s.id, s] as const),
  ]);
  const sameTeam = enrolment.team?.id === id;
  const ids = new Set<string>([enrolment.student.id]);
  if (sameTeam) for (const s of enrolment.teammates) ids.add(s.id);
  for (const v of snap?.votes ?? []) if (v.team_id === id) ids.add(v.student_id);
  if (snap && snap.state.phase !== "individual") for (const r of snap.responses) ids.add(r.student_id);
  const members = [...ids]
    .map((sid) => known.get(sid) ?? ({ ...enrolment.student, id: sid, name: "Teammate", avatar_tint: null } as Student))
    .sort((a, b) => (a.id === enrolment.student.id ? -1 : b.id === enrolment.student.id ? 1 : a.name.localeCompare(b.name)));
  return {
    ...(enrolment.team ?? { id, name: "Your team" }),
    id,
    name: sameTeam && enrolment.team ? enrolment.team.name : "Your team",
    members,
  } as TeamWithMembers;
}

export function useLiveSession(activityId: string, enrolment: Enrolment, teamId: string | null): LiveSession {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, Record<string, boolean>>>({});
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  // Overlapping reads (realtime, the poll, coming back to the tab): a read
  // older than the last one applied is dropped, so a lock can't vanish under
  // a poll that started before it.
  const issued = useRef(0);
  const applied = useRef(0);

  const reload = useCallback(async () => {
    const n = ++issued.current;
    try {
      const next = await loadLive(activityId);
      if (!alive.current || n < applied.current) return;
      applied.current = n;
      setSnap(next);
      setFailed(false);
    } catch {
      if (alive.current && n >= applied.current) setFailed(true);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [activityId]);

  useEffect(() => {
    alive.current = true;
    void reload();
    let timer: number | undefined;
    const unwatch = watchLive(activityId, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 200);
    });
    const poll = window.setInterval(() => void reload(), POLL_MS);
    const back = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      alive.current = false;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", back);
      unwatch();
    };
  }, [activityId, reload]);

  const phase = snap?.state.phase;
  useEffect(() => {
    if (phase !== "team") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  // Keys are only readable once shown; expressions then need the algebra.
  useEffect(() => {
    if (!snap || snap.keys.length === 0 || !snap.questions.some((q) => q.kind === "expression")) {
      setVerdicts({});
      return;
    }
    let live = true;
    void expressionVerdicts(snap.questions, snap.keys, [...snap.responses, ...snap.locks, ...snap.attempts]).then((v) => {
      if (live) setVerdicts(v);
    });
    return () => {
      live = false;
    };
  }, [snap]);

  const team = useMemo(() => teamFor(enrolment, teamId, snap), [enrolment, teamId, snap]);
  const model = useMemo(
    () =>
      snap
        ? buildLiveModel({ snapshot: snap, students: team?.members ?? [enrolment.student], teams: team ? [team] : [], verdicts, now })
        : null,
    [snap, team, enrolment.student, verdicts, now],
  );

  return { snap, model, team, loading, failed, reload };
}
