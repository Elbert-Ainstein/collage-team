"use client";

// One live activity, from a student's seat: the rows RLS lets them read
// (their own answers; their team's answers, votes and locks once team mode is
// on, its pick of leader and roll (0051); the key and explanations once shown), kept current by realtime with a slow poll
// behind it in case a socket drops on a classroom's wifi — and a quick one
// while the team is picking its leader and taking the roll.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Enrolment } from "@/checkins/studentData";
import type { TeamWithMembers } from "@/checkins/types";
import { expressionVerdicts } from "@/live/answers";
import { loadLive, loadLiveSetup, SETUP_TABLES, watchLive } from "@/live/data";
import { teamStage } from "@/live/leader";
import { buildLiveModel, type LiveModel } from "@/live/model";
import { singleFlight, spread } from "@/live/singleFlight";
import type { LiveSnapshot } from "@/live/types";
import { teamFor } from "./teamFor";

const POLL_MS = 30_000;
/**
 * While the team picks its leader or takes the roll: a minute of everyone
 * tapping at once, where a teammate's tap that waits on the slow poll reads as
 * broken. Realtime still leads; this is how late it can ever be. It reads only
 * the leader and the roll, not the whole activity.
 */
const SETUP_POLL_MS = 2_000;
/** How far a room's reads after one realtime event are spread. */
const REALTIME_SPREAD_MS = 1_000;

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

export function useLiveSession(activityId: string, enrolment: Enrolment, teamId: string | null): LiveSession {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, Record<string, boolean>>>({});
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  // The next read reads everything; otherwise (the setup poll) just the leader
  // and the roll. Reads run one at a time (singleFlight), so a full read and a
  // setup check can never land out of order and undo each other.
  const whole = useRef(true);

  const read = useCallback(async () => {
    const full = whole.current;
    whole.current = false;
    try {
      if (full) {
        const next = await loadLive(activityId);
        if (!alive.current) return;
        setSnap(next);
      } else {
        const parts = await loadLiveSetup(activityId);
        if (!alive.current) return;
        if (parts) setSnap((s) => (s ? { ...s, ...parts } : s));
      }
      setFailed(false);
    } catch {
      // The next read must be a whole one: this one may have been.
      whole.current = whole.current || full;
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [activityId]);
  const flight = useMemo(() => singleFlight(read), [read]);
  const reload = useCallback(() => {
    whole.current = true;
    return flight();
  }, [flight]);

  useEffect(() => {
    alive.current = true;
    void reload();
    let timer: number | undefined;
    let wantAll = false;
    const unwatch = watchLive(activityId, (table) => {
      // A leader vote or a roll moves only the setup; anything else reads it all.
      wantAll = wantAll || !SETUP_TABLES.includes(table);
      // One read for a burst — but not pushed back by every event in it, or a
      // busy room would never read at all. Every phone hears the same event,
      // so their reads are spread out.
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        const all = wantAll;
        wantAll = false;
        void (all ? reload() : flight());
      }, spread(200, REALTIME_SPREAD_MS));
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
  }, [activityId, reload, flight]);

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

  const settingUp = phase === "team" && snap !== null && team !== null && teamStage(snap, team.id) !== "play";
  useEffect(() => {
    if (!settingUp) return;
    const t = window.setInterval(() => void flight(), SETUP_POLL_MS);
    return () => window.clearInterval(t);
  }, [settingUp, flight]);
  const model = useMemo(
    () =>
      snap
        ? buildLiveModel({ snapshot: snap, students: team?.members ?? [enrolment.student], teams: team ? [team] : [], verdicts, now })
        : null,
    [snap, team, enrolment.student, verdicts, now],
  );

  return { snap, model, team, loading, failed, reload };
}
