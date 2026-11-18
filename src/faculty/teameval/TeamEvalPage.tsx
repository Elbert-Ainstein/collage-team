"use client";

// A team evaluation's overview: what it is and how it's set up — due date,
// visibility, instructions, settings, edit and delete — and how many have
// submitted, with the way into the results. The results have their own page
// (TeamEvalResults): reviewing them is a different job, and the table needs
// the whole screen.

import { useMemo, useState } from "react";
import { deleteActivity, updateActivity } from "@/checkins/data";
import { isOpenToStudents } from "@/checkins/studentData";
import { HIDDEN_INSTANT, type Activity } from "@/checkins/types";
import { teamsOf } from "@/checkins/rosters";
import { BriefText } from "@/checkins/BriefText";
import { buildResults, fmtPoints } from "@/teameval/model";
import type { TeamEvalSnapshot } from "@/teameval/types";
import { Ic } from "@/live/ui";
import { ConfirmDialog } from "../ConfirmDialog";
import type { FacultyData } from "../FacultyApp";
import { fmtWhen } from "./format";

interface Props {
  data: FacultyData;
  activity: Activity;
  snap: TeamEvalSnapshot;
  justPublished: boolean;
  onDismissPublished: () => void;
  onBack: () => void;
  onEdit: () => void;
  onEditDetails: () => void;
  onResults: () => void;
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}

export function TeamEvalPage(props: Props) {
  const { data, activity, snap, justPublished, onDismissPublished, onBack, onEdit, onEditDetails, onResults, onChanged, onError } = props;
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<null | "ask" | "busy">(null);

  const dueAt = activity.due_at ?? activity.individual_due_at;
  const due = fmtWhen(dueAt);
  const visible = isOpenToStudents(activity);
  const teams = useMemo(() => teamsOf(data, activity.id), [data, activity.id]);
  const onTeams = useMemo(
    () =>
      buildResults({ snapshot: snap, teams, roster: data.roster, dueAt, pointsTotal: activity.points_total })
        .filter((g) => g.team)
        .flatMap((g) => g.rows),
    [snap, teams, data.roster, dueAt, activity.points_total],
  );
  const submitted = onTeams.filter((r) => r.submission).length;
  const pct = onTeams.length ? (100 * submitted) / onTeams.length : 0;

  const setVisible = async (on: boolean) => {
    setBusy(true);
    try {
      await updateActivity(activity.id, { opens_at: on ? null : HIDDEN_INSTANT });
      await onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setDeleting("busy");
    try {
      await deleteActivity(activity.id);
      await onChanged();
      onBack();
    } catch (e) {
      onError(e);
      setDeleting(null);
    }
  };

  const brief = activity.source_text?.trim() ?? "";

  return (
    <div className="fv-panel lq-panel te-fac">
      <div className="fv-topbar">
        <button type="button" className="fv-back" aria-label="Back to Activities" onClick={onBack}>
          <Ic name="chevronLeft" size={16} />
        </button>
        <span className="fv-sub">{activity.week === null ? "Team evaluation" : `Week ${activity.week} · Team evaluation`}</span>
      </div>

      <div className="fv-scroll lq-scroll">
        {justPublished && visible ? (
          <div className="lq-published" role="status">
            <Ic name="check" size={15} />
            <b>Published</b>
            <button type="button" className="lq-x" aria-label="Dismiss" onClick={onDismissPublished}>
              <Ic name="close" size={13} />
            </button>
          </div>
        ) : null}

        <div className="te-pagehead">
          <div className="te-pagemain">
            <h1 className="fv-display lq-pagetitle">{activity.title}</h1>
            {due ? (
              <div className="fv-sub" style={{ marginTop: 8 }}>
                Due {due}
              </div>
            ) : null}
            {data.can.author ? (
              <div className="lq-vis" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className={`fv-switch${visible ? " on" : ""}`}
                  role="switch"
                  aria-checked={visible}
                  aria-label="Visible to students"
                  disabled={busy}
                  onClick={() => void setVisible(!visible)}
                />
                <span className="fv-sub" style={visible ? undefined : { color: "var(--fv-amber)" }}>
                  {visible ? "Visible" : "Hidden"}
                </span>
              </div>
            ) : null}
            {brief ? (
              <p className="lq-desc">
                <BriefText text={brief} />
              </p>
            ) : null}
            {data.can.author ? (
              <button type="button" className="lq-linkish lq-descedit" onClick={onEditDetails}>
                {brief ? "Edit details" : "+ Instructions"}
              </button>
            ) : null}
            <div className="lq-badges">
              <span className="fv-badge secondary">{fmtPoints(activity.points_total)} pts</span>
              <span className="fv-badge secondary">−{fmtPoints(snap.settings.late_penalty)}% late</span>
              {snap.settings.anonymize ? <span className="fv-badge secondary">Anonymous</span> : null}
              {!snap.settings.peer_comments ? <span className="fv-badge secondary">No peer comments</span> : null}
              {snap.settings.peer_comments && !snap.settings.release_comments ? (
                <span className="fv-badge secondary">Comments private</span>
              ) : null}
              {snap.settings.released_at ? <span className="fv-badge secondary">Results released</span> : null}
            </div>
            {data.can.author ? (
              <div className="lq-pagebtns">
                <button type="button" className="fv-btn outline sm" onClick={onEdit}>
                  <Ic name="edit" size={15} /> Edit
                </button>
                <button type="button" className="fv-btn ghost sm" onClick={() => setDeleting("ask")}>
                  Delete
                </button>
              </div>
            ) : null}
          </div>

          <div className="fv-card te-statcard">
            <div className="lq-bigcount">
              <span className="fv-display fv-num">{submitted}</span>
              <span className="fv-sub">of {onTeams.length} submitted</span>
            </div>
            <div className="fv-track" style={{ marginTop: 10 }}>
              <i style={{ width: `${pct}%`, background: "var(--fv-emerald)" }} />
            </div>
            {/* Nothing to look at until someone submits. */}
            {submitted > 0 ? (
              <button type="button" className="fv-btn primary te-viewresults" onClick={onResults}>
                View results <Ic name="arrowRight" size={15} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {deleting ? (
        <ConfirmDialog
          title={`Delete “${activity.title}”?`}
          body={snap.ratings.length ? "All ratings and comments go with it." : "Nobody has started it."}
          confirmLabel="Delete"
          busy={deleting === "busy"}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
