"use client";

// A live-questions assignment, from the student's side. Where it opens
// follows the session: before class, the brief and their own answers; once
// the instructor starts team mode, their team's voting; once it's closed, the
// results. The instructor's move changes this screen on its own (realtime).

import { useMemo, useState } from "react";
import type { Assignment, Enrolment } from "@/checkins/studentData";
import { Ic, LiveDot } from "@/live/ui";
import { Brief, OnYourOwn } from "./OnYourOwn";
import { Results } from "./Results";
import { TeamDone, TeamIntro, TeamQuestion } from "./TeamVote";
import { useAnswerSaver } from "./useAnswerSaver";
import { useLiveSession } from "./useLiveSession";
import "@/live/live.css";

interface Props {
  assignment: Assignment;
  enrolment: Enrolment;
  onBack: () => void;
}

const introKey = (activityId: string) => `lq-intro-${activityId}`;
const seenIntro = (activityId: string): boolean => {
  try {
    return window.localStorage.getItem(introKey(activityId)) === "1";
  } catch {
    return false;
  }
};

function fmtDue(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function LiveAssignment({ assignment, enrolment, onBack }: Props) {
  const { activity } = assignment;
  const me = enrolment.student.id;
  const { model: m, team, loading, failed, reload } = useLiveSession(activity.id, enrolment, assignment.teamId ?? null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [intro, setIntro] = useState(() => seenIntro(activity.id));
  const [error, setError] = useState<string | null>(null);

  const loaded = useMemo(() => {
    const out: Record<string, string> = {};
    m?.questions.forEach((q, i) => {
      const a = m.own(me, i);
      if (a) out[q.id] = a;
    });
    return out;
  }, [m, me]);
  const saver = useAnswerSaver(activity.id, me, loaded);

  const phase = m?.state.phase ?? "individual";
  const due = fmtDue(activity.due_at ?? activity.individual_due_at);
  const mode = phase === "individual" ? "Before class" : phase === "team" ? "Team mode" : "Results";
  const inQuestions = phase === "individual" && cursor !== null;

  const body = () => {
    if (loading) return <div className="lq-sscroll fv-sub">Loading…</div>;
    if (!m) {
      return (
        <div className="lq-sscroll">
          <div className="lq-scard">
            <p className="fv-sub">
              {failed ? "Couldn’t load this — check your connection." : "This isn’t ready yet. Check back soon."}
            </p>
            {failed ? (
              <button type="button" className="fv-btn outline sm" onClick={() => void reload()}>
                Retry
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    if (phase === "individual") {
      if (cursor === null) {
        return (
          <Brief
            m={m}
            team={team}
            title={activity.title}
            due={due}
            answered={(i) => saver.answers[m.questions[i]?.id] !== undefined}
            onStart={setCursor}
          />
        );
      }
      return <OnYourOwn m={m} saver={saver} cursor={cursor} onCursor={setCursor} activityId={activity.id} />;
    }
    if (phase === "team") {
      if (!team) {
        return (
          <div className="lq-sscroll">
            <div className="lq-scard">
              <h2 className="lq-h2">You’re not on a team for this one</h2>
              <p className="fv-sub">Ask your instructor to add you.</p>
            </div>
          </div>
        );
      }
      if (!intro) {
        return (
          <TeamIntro
            team={team}
            rule={m.state.lock_rule}
            onStart={() => {
              setIntro(true);
              try {
                window.localStorage.setItem(introKey(activity.id), "1");
              } catch {
                // Private mode: it shows again next time, which is harmless.
              }
            }}
          />
        );
      }
      return m.current(team.id) ? (
        <TeamQuestion m={m} team={team} onError={setError} />
      ) : (
        <TeamDone m={m} team={team} meId={me} />
      );
    }
    return <Results m={m} team={team} meId={me} />;
  };

  return (
    <div className="lq-stu lq-shost">
      <div className="lq-spanel">
        <header className="lq-sbar">
          <div className="lq-sbartitle">
            <button type="button" className="lq-sback" onClick={inQuestions ? () => setCursor(null) : onBack}>
              <Ic name="chevronLeft" size={14} />
              {inQuestions ? "About this activity" : "All assignments"}
            </button>
            {inQuestions || phase !== "individual" ? <span className="lq-sname">{activity.title}</span> : null}
          </div>
          <span className={`lq-modepill ${phase}`}>
            {phase === "team" ? <LiveDot tone="team" /> : phase === "individual" ? <Ic name="clock" size={13} /> : null}
            {mode}
          </span>
        </header>
        {error ? (
          <div className="lq-serror" role="alert">
            <span>{error}</span>
            <button type="button" className="lq-x" aria-label="Dismiss" onClick={() => setError(null)}>
              <Ic name="close" size={13} />
            </button>
          </div>
        ) : null}
        {body()}
      </div>
    </div>
  );
}
