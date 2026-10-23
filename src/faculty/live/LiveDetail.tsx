"use client";

// The detail screen for a live-questions activity: loads its rows, keeps them
// current, and shows either the builder or the activity page.
//
// Current means three things. Realtime wakes it on any change to the session
// state, a vote or a lock (watchLive) — the in-class part. Own answers aren't
// published (an autosave per keystroke from a whole class), so while students
// are still answering at home it re-reads every 20 s instead. And during team
// mode the clock ticks every second so "Q3 · 2:14" counts up.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { teamsOf } from "@/checkins/rosters";
import type { Activity } from "@/checkins/types";
import { expressionVerdicts } from "@/live/answers";
import { loadLive, watchLive } from "@/live/data";
import { buildLiveModel } from "@/live/model";
import type { LiveSnapshot } from "@/live/types";
import type { FacultyData } from "../FacultyApp";
import { LiveBuilder } from "./LiveBuilder";
import { LivePage } from "./LivePage";
import "@/live/live.css";

const POLL_MS = 20_000;

interface Props {
  data: FacultyData;
  activity: Activity;
  /** Just created: open the builder on its first step. */
  fresh: boolean;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}

type Loaded = { kind: "loading" } | { kind: "failed" } | { kind: "missing" } | { kind: "ready"; snap: LiveSnapshot };

export function LiveDetail({ data, activity, fresh, onBack, onChanged, onError }: Props) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [building, setBuilding] = useState<0 | 1 | null>(null);
  const [justPublished, setJustPublished] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, Record<string, boolean>>>({});
  const [now, setNow] = useState(() => Date.now());
  const errorRef = useRef(onError);
  errorRef.current = onError;

  // Reads overlap — realtime, the poll, a move made here — and the slowest
  // isn't the newest. Each read is numbered; one older than the last applied
  // is dropped, so a lock can't vanish under a poll that started before it.
  const issued = useRef(0);
  const applied = useRef(0);
  // One message per run of failures, not one per poll.
  const failing = useRef(false);

  const reload = useCallback(async () => {
    const n = ++issued.current;
    try {
      const snap = await loadLive(activity.id);
      if (n < applied.current) return;
      applied.current = n;
      failing.current = false;
      setLoaded(snap ? { kind: "ready", snap } : { kind: "missing" });
    } catch (e) {
      if (n < applied.current) return;
      // Nothing on screen yet: say so there, with a retry. Otherwise keep what's
      // shown and report it once.
      setLoaded((l) => (l.kind === "ready" ? l : { kind: "failed" }));
      if (!failing.current) errorRef.current(e);
      failing.current = true;
    }
  }, [activity.id]);

  useEffect(() => {
    setLoaded({ kind: "loading" });
    void reload();
    let timer: number | undefined;
    const unwatch = watchLive(activity.id, () => {
      // A lock lands as a burst (the lock, then the votes it settled): one read.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 250);
    });
    return () => {
      window.clearTimeout(timer);
      unwatch();
    };
  }, [activity.id, reload]);

  const snap = loaded.kind === "ready" ? loaded.snap : null;
  const phase = snap?.state.phase;

  // Polled until the first read lands too, so a failed one recovers on its own.
  useEffect(() => {
    if (phase !== "individual" && loaded.kind !== "failed") return;
    const t = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(t);
  }, [phase, loaded.kind, reload]);

  useEffect(() => {
    if (phase !== "team") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  // The builder opens on its own for a new activity, and for one that was
  // started and left before it had any questions.
  const empty = snap !== null && snap.questions.length === 0;
  useEffect(() => {
    if (!data.can.author || building !== null || !snap) return;
    if (fresh || empty) setBuilding(fresh || activity.title === "Untitled" ? 0 : 1);
    // Only on arrival: once she's left the builder, it stays left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap !== null]);

  // Expressions are decided by algebra, which is async; everything else is instant.
  useEffect(() => {
    if (!snap || !snap.questions.some((q) => q.kind === "expression") || snap.keys.length === 0) {
      setVerdicts({});
      return;
    }
    let live = true;
    void expressionVerdicts(snap.questions, snap.keys, [...snap.responses, ...snap.locks]).then((v) => {
      if (live) setVerdicts(v);
    });
    return () => {
      live = false;
    };
  }, [snap]);

  const model = useMemo(
    () =>
      snap
        ? buildLiveModel({
            snapshot: snap,
            students: data.roster,
            teams: teamsOf(data, activity.id),
            verdicts,
            now,
          })
        : null,
    [snap, data, activity.id, verdicts, now],
  );

  if (loaded.kind === "loading") {
    return (
      <div className="fv-panel lq-panel">
        <div className="fv-sub">Loading…</div>
      </div>
    );
  }
  if (loaded.kind === "failed") {
    return (
      <div className="fv-panel lq-panel">
        <div className="fv-topbar">
          <button type="button" className="fv-back" aria-label="Back to Activities" onClick={onBack}>
            ‹
          </button>
        </div>
        <p className="fv-sub">
          Couldn’t load this activity.{" "}
          <button type="button" className="fv-btn ghost sm" onClick={() => void reload()}>
            Retry
          </button>
        </p>
      </div>
    );
  }
  if (!snap || !model) {
    return (
      <div className="fv-panel lq-panel">
        <div className="fv-topbar">
          <button type="button" className="fv-back" aria-label="Back to Activities" onClick={onBack}>
            ‹
          </button>
        </div>
        <p className="fv-sub">This database hasn’t been set up for live questions yet (migration 0047).</p>
      </div>
    );
  }

  return (
    <div className="lq-fac lq-host">
      {building !== null ? (
        <LiveBuilder
          key={building}
          data={data}
          activity={activity}
          snapshot={snap}
          startStep={building}
          onLeave={() => {
            setBuilding(null);
            if (empty) onBack();
          }}
          onDone={async (published) => {
            await Promise.all([reload(), onChanged()]);
            setJustPublished(published);
            setBuilding(null);
          }}
          onError={onError}
        />
      ) : (
        <LivePage
          data={data}
          activity={activity}
          m={model}
          justPublished={justPublished}
          onDismissPublished={() => setJustPublished(false)}
          onBack={onBack}
          onEdit={() => setBuilding(1)}
          onEditDetails={() => setBuilding(0)}
          reload={async () => {
            await reload();
            // Starting team mode froze the teams; the course data has to see that too.
            await onChanged();
          }}
          onChanged={onChanged}
          onError={onError}
        />
      )}
    </div>
  );
}
