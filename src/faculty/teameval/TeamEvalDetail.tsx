"use client";

// The detail screen for a team evaluation: loads its rows, and shows either
// the builder or the activity page. Submissions trickle in over days, not
// seconds, so it re-reads every 30 s rather than subscribing to anything.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Activity } from "@/checkins/types";
import { loadTeamEval } from "@/teameval/data";
import type { TeamEvalSnapshot } from "@/teameval/types";
import { singleFlight } from "@/live/singleFlight";
import { Ic } from "@/live/ui";
import type { FacultyData } from "../FacultyApp";
import { TeamEvalBuilder } from "./TeamEvalBuilder";
import { TeamEvalPage } from "./TeamEvalPage";
import { TeamEvalResults } from "./TeamEvalResults";
import "@/live/live.css";
import "@/teameval/teameval.css";

const POLL_MS = 30_000;

interface Props {
  data: FacultyData;
  activity: Activity;
  /** Just created: open the builder on its first step. */
  fresh: boolean;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}

type Loaded = { kind: "loading" } | { kind: "failed" } | { kind: "missing" } | { kind: "ready"; snap: TeamEvalSnapshot };

export function TeamEvalDetail({ data, activity, fresh, onBack, onChanged, onError }: Props) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [building, setBuilding] = useState<0 | 1 | null>(null);
  const [justPublished, setJustPublished] = useState(false);
  /** On the results page rather than the overview. */
  const [viewing, setViewing] = useState(false);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const failing = useRef(false);
  const open = useRef(activity.id);
  open.current = activity.id;

  const read = useCallback(async () => {
    try {
      const snap = await loadTeamEval(activity.id);
      if (open.current !== activity.id) return;
      failing.current = false;
      setLoaded(snap ? { kind: "ready", snap } : { kind: "missing" });
    } catch (e) {
      if (open.current !== activity.id) return;
      setLoaded((l) => (l.kind === "ready" ? l : { kind: "failed" }));
      if (!failing.current) errorRef.current(e);
      failing.current = true;
    }
  }, [activity.id]);
  // The poll, a press of Refresh and a save can overlap; one read at a time.
  const reload = useMemo(() => singleFlight(read), [read]);

  useEffect(() => {
    setLoaded({ kind: "loading" });
    void reload();
    const t = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(t);
  }, [reload]);

  const snap = loaded.kind === "ready" ? loaded.snap : null;
  const empty = snap !== null && snap.categories.length === 0;
  useEffect(() => {
    if (!data.can.author || building !== null || !snap) return;
    if (fresh || empty) setBuilding(fresh || activity.title === "Untitled" ? 0 : 1);
    // Only on arrival: once she's left the builder, it stays left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap !== null]);

  const back = (
    <div className="fv-topbar">
      <button type="button" className="fv-back" aria-label="Back to Activities" onClick={onBack}>
        <Ic name="chevronLeft" size={16} />
      </button>
    </div>
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
        {back}
        <p className="fv-sub">
          Couldn’t load this evaluation.{" "}
          <button type="button" className="fv-btn ghost sm" onClick={() => void reload()}>
            Retry
          </button>
        </p>
      </div>
    );
  }
  if (!snap) {
    return (
      <div className="fv-panel lq-panel">
        {back}
        <p className="fv-sub">This database hasn’t been set up for team evaluations yet (migration 0058).</p>
      </div>
    );
  }

  return (
    <div className="lq-fac lq-host">
      {building !== null ? (
        <TeamEvalBuilder
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
      ) : viewing ? (
        <TeamEvalResults
          data={data}
          activity={activity}
          snap={snap}
          onBack={() => setViewing(false)}
          reload={reload}
          onChanged={onChanged}
          onError={onError}
        />
      ) : (
        <TeamEvalPage
          data={data}
          activity={activity}
          snap={snap}
          justPublished={justPublished}
          onDismissPublished={() => setJustPublished(false)}
          onBack={onBack}
          onEdit={() => setBuilding(1)}
          onEditDetails={() => setBuilding(0)}
          onResults={() => setViewing(true)}
          onChanged={onChanged}
          onError={onError}
        />
      )}
    </div>
  );
}
