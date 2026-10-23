"use client";

// Making live questions, in the two steps every new activity goes through
// ("Activity", then "Questions & grading"). Finish saves the questions and
// their keys, and — the first time — puts the activity in front of the class:
// there's no separate "make visible" step to forget.
//
// Opened again later it edits the same activity. Once team mode has started
// the questions themselves are fixed (0047), but the wording, images and keys
// can still change; a fixed key on a scored session is re-scored on save.

import { useMemo, useState } from "react";
import { updateActivity } from "@/checkins/data";
import type { Activity } from "@/checkins/types";
import { TRY_CREDIT, TYPED_TRIES } from "@/live/answers";
import { loadLive, saveLiveQuestions, scoreLive, setLiveSettings } from "@/live/data";
import { fmtPoints } from "@/live/model";
import type { LiveGrading, LiveSnapshot, LockRule, ShowAnswers } from "@/live/types";
import { Ic } from "@/live/ui";
import { fromLocalInput, toLocalInput } from "../ActivityDetail";
import type { FacultyData } from "../FacultyApp";
import { NEW_ACTIVITY_STEPS, Steps } from "../Steps";
import { DraftQuestionCard } from "./DraftQuestionCard";
import { answersAtRisk, blankQuestion, draftsFrom, summarizeProblems, toQuestionDraft, type DraftQuestion } from "./draft";
import { ConfirmDialog } from "../ConfirmDialog";
import { ImportCard, type Imported } from "./ImportCard";
import { leftOutLine, withImported } from "./importDraft";

interface Props {
  data: FacultyData;
  activity: Activity;
  snapshot: LiveSnapshot;
  /** Which step it opens on: 0 for a new one or its details, 1 for "Edit questions". */
  startStep: 0 | 1;
  /** Leaves without finishing; a new activity stays as a hidden draft. */
  onLeave: () => void;
  /** Saved. `published` when this Finish is what put it in front of the class. */
  onDone: (published: boolean) => void;
  onError: (e: unknown) => void;
}

function Seg<T extends string>({ value, options, disabled, onChange }: { value: T; options: [T, string][]; disabled: boolean; onChange: (v: T) => void }) {
  return (
    <div className="fv-seg">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={value === v ? "on" : ""} disabled={disabled} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function LiveBuilder({ data, activity, snapshot, startStep, onLeave, onDone, onError }: Props) {
  const firstTime = snapshot.questions.length === 0;
  const frozen = snapshot.state.phase !== "individual";
  const [step, setStep] = useState<0 | 1>(startStep);
  const [title, setTitle] = useState(firstTime && activity.title === "Untitled" ? "" : activity.title);
  const [week, setWeek] = useState<number | null>(activity.week);
  const [due, setDue] = useState(toLocalInput(activity.due_at ?? activity.individual_due_at));
  const [desc, setDesc] = useState(activity.source_text ?? "");
  /** Once the questions step has been open, its edits ride on its own Save, so
      saving this step must not close the builder under them. */
  const [sawQuestions, setSawQuestions] = useState(startStep === 1);
  const [questions, setQuestions] = useState<DraftQuestion[]>(() =>
    firstTime ? [blankQuestion()] : draftsFrom(snapshot.questions, snapshot.keys),
  );
  const [rule, setRule] = useState<LockRule>(snapshot.state.lock_rule);
  const [show, setShow] = useState<ShowAnswers>(snapshot.state.show_answers);
  const [grading, setGrading] = useState<LiveGrading>(snapshot.state.grading);
  const [busy, setBusy] = useState(false);
  /** What the last PDF import brought in, for the summary lines. */
  const [imported, setImported] = useState<Imported | null>(null);
  /** Sentences about answers this save would lose, while she decides. */
  const [risk, setRisk] = useState<string[] | null>(null);

  const problem = summarizeProblems(questions);
  const weeks = useMemo(() => [...data.weeks].sort((a, b) => a.week - b.week), [data.weeks]);
  const replace = (i: number, next: DraftQuestion) => setQuestions((qs) => qs.map((q, j) => (j === i ? next : q)));
  // For changes that land later (an image upload): applied to the question as
  // it is then, not as it was when the upload started.
  const patch = (id: string, change: Partial<DraftQuestion>) =>
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...change } : q)));
  const saved = useMemo(() => draftsFrom(snapshot.questions, snapshot.keys), [snapshot.questions, snapshot.keys]);
  const answered = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of snapshot.responses) n.set(r.question_id, (n.get(r.question_id) ?? 0) + 1);
    return n;
  }, [snapshot.responses]);

  const saveBasics = async () => {
    setBusy(true);
    try {
      await updateActivity(activity.id, {
        title: title.trim(),
        week,
        due_at: fromLocalInput(due),
        // Whitespace-only is no description; null, as ActivityDetail writes it.
        source_text: desc.trim() ? desc.trim() : null,
      });
      // Opened from the page just to change these: done, back to the page.
      if (!firstTime && !sawQuestions) {
        onDone(false);
        return;
      }
      setStep(1);
      setSawQuestions(true);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const basicsOnly = !firstTime && !sawQuestions;

  const finish = async (confirmed = false) => {
    if (problem) return;
    const atRisk = answersAtRisk(saved, questions, answered);
    if (atRisk.length && !confirmed) {
      setRisk(atRisk);
      return;
    }
    setRisk(null);
    setBusy(true);
    try {
      await saveLiveQuestions(activity.id, questions.map(toQuestionDraft), frozen);
      if (!frozen) await setLiveSettings(activity.id, { lock_rule: rule, show_answers: show, grading });
      const n = questions.length;
      await updateActivity(activity.id, {
        title: title.trim() || activity.title,
        // Own + team is a point a question twice; team only, once (0047).
        points_total: grading === "team" ? n : 2 * n,
        ...(firstTime ? { opens_at: null } : {}),
      });
      // A key fixed after the session was scored: the gradebook follows it.
      if (snapshot.state.scored_at && data.can.grade) {
        const fresh = await loadLive(activity.id);
        if (fresh) await scoreLive(fresh);
      }
      onDone(firstTime);
    } catch (e) {
      onError(e);
      setBusy(false);
    }
  };

  const weekName = (w: number | null) => {
    const row = weeks.find((x) => x.week === w);
    return row?.title || (w === null ? "No week" : `Week ${w}`);
  };

  return (
    <div className="fv-panel lq-panel">
      <div className="fv-topbar">
        <button
          type="button"
          className="fv-back"
          aria-label={step === 1 && firstTime ? "Back to the first step" : "Back"}
          onClick={step === 1 && firstTime ? () => setStep(0) : onLeave}
        >
          <Ic name="chevronLeft" size={16} />
        </button>
        <span className="fv-sub">
          {step === 0 ? `${firstTime ? "New activity" : title || "Untitled"} · ${weekName(week)}` : `${title || "Untitled"} · ${weekName(week)}`}
        </span>
        {step === 1 ? (
          <button
            type="button"
            className="fv-btn primary sm"
            style={{ marginLeft: "auto" }}
            disabled={!!problem || busy}
            title={problem ?? undefined}
            onClick={() => void finish()}
          >
            {firstTime ? "Finish" : "Save"}
          </button>
        ) : null}
      </div>
      <Steps steps={NEW_ACTIVITY_STEPS} current={step} onGo={() => setStep(0)} />

      <div className="fv-scroll lq-scroll">
        {step === 0 ? (
          <div className="lq-bstep1">
            {frozen ? null : imported ? (
              <div className="lq-imported" role="status">
                <Ic name="sparkle" size={15} />
                <span>
                  <b>
                    {imported.questions.length} question{imported.questions.length === 1 ? "" : "s"} drafted
                  </b>
                  {(() => {
                    const n = imported.questions.filter((q) => q.source?.needsPick).length;
                    return n ? ` · ${n} need${n === 1 ? "s" : ""} an answer` : "";
                  })()}
                  {imported.figuresMissed ? ` · ${imported.figuresMissed} figure${imported.figuresMissed === 1 ? "" : "s"} to add by hand` : ""}
                </span>
              </div>
            ) : (
              <ImportCard
                courseId={activity.course_id}
                activityId={activity.id}
                onImported={(result) => {
                  setImported(result);
                  setQuestions((qs) => withImported(qs, result.questions));
                  if (!title.trim() && result.title) setTitle(result.title);
                }}
              />
            )}
            <input
              className="fv-display fv-titlein lq-titlein"
              value={title}
              placeholder="What are they working on?"
              aria-label="Activity title"
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="lq-descin"
              rows={3}
              value={desc}
              placeholder="Add a description"
              aria-label="Description"
              onChange={(e) => setDesc(e.target.value)}
            />
            <div className="fv-fields">
              <label className="fv-field">
                <span className="fv-eyebrow">Week</span>
                <select
                  className="fv-in quiet"
                  value={week ?? ""}
                  onChange={(e) => setWeek(e.target.value === "" ? null : Number(e.target.value))}
                >
                  {week === null ? <option value="">No week</option> : null}
                  {weeks.map((w) => (
                    <option key={w.id} value={w.week}>
                      {w.title || `Week ${w.week}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fv-field">
                <span className="fv-eyebrow">Answer on their own by</span>
                <input className="fv-in quiet" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
            </div>

            <div className="fv-editbar">
              <button type="button" className="fv-btn primary sm" disabled={!title.trim() || busy} onClick={() => void saveBasics()}>
                {basicsOnly ? "Save" : "Save and continue"}
              </button>
              <button type="button" className="fv-btn ghost sm" onClick={onLeave}>
                Not now
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="lq-builder">
              <section className="lq-bmain">
                <h1 className="fv-display" style={{ fontSize: 24 }}>
                  Questions & grading
                </h1>
                <div className="lq-step2gap" />

                {questions.map((q, i) => (
                  <DraftQuestionCard
                    key={q.id}
                    q={q}
                    n={i + 1}
                    activityId={activity.id}
                    onlyOne={questions.length === 1}
                    locked={frozen}
                    onChange={(next) => replace(i, next)}
                    onPatch={(change) => patch(q.id, change)}
                    onRemove={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                    onError={onError}
                  />
                ))}

                {imported && leftOutLine(imported.leftOut) ? (
                  <p className="lq-leftline" title={imported.leftOut.map((l) => `p.${l.page}: ${l.reason}`).join("\n")}>
                    Left out: {leftOutLine(imported.leftOut)}
                  </p>
                ) : null}

                {frozen ? null : (
                  <div className="lq-addrow">
                    <button type="button" className="lq-addq" onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}>
                      <Ic name="add" size={16} /> Add a question
                    </button>
                  </div>
                )}
              </section>

              <aside className="lq-bside">
                <div className="fv-card lq-bcard">
                  <div className="fv-field">
                    <span className="fv-eyebrow">Team answer locks when</span>
                    <Seg value={rule} disabled={frozen} onChange={setRule} options={[["any", "Anyone submits"], ["all", "Everyone agrees"]]} />
                  </div>
                  <div className="fv-field">
                    <span className="fv-eyebrow">Show answers</span>
                    <Seg value={show} disabled={frozen} onChange={setShow} options={[["close", "When I close"], ["lock", "As teams finish each"]]} />
                  </div>
                  <div className="fv-field">
                    <span className="fv-eyebrow">Grade</span>
                    <Seg value={grading} disabled={frozen} onChange={setGrading} options={[["both", "Own + team"], ["team", "Team only"]]} />
                  </div>
                  {/* The same either way: grading only decides what own answers count for (0049). */}
                  <p className="lq-bnote">
                    {grading === "both" ? "Own answers score a point each when right. " : "Own answers count for completion. "}
                    Teams see right or wrong as soon as they submit and try again until they have it:{" "}
                    {TRY_CREDIT.map((c, i) => `${fmtPoints(c)} on try ${i + 1}`).join(", ")}, nothing after. Typed answers get{" "}
                    {TYPED_TRIES} tries.
                  </p>
                </div>
              </aside>
            </div>
            <div className="fv-editbar lq-step2bar">
              <button type="button" className="fv-btn outline sm" onClick={firstTime ? () => setStep(0) : onLeave}>
                <Ic name="chevronLeft" size={14} /> Back
              </button>
              <button type="button" className="fv-btn primary sm" disabled={!!problem || busy} title={problem ?? undefined} onClick={() => void finish()}>
                {busy ? "Saving…" : firstTime ? "Finish" : "Save"}
              </button>
              {problem ? <span className="fv-sub">{problem}</span> : null}
            </div>
          </>
        )}
      </div>
      {risk ? (
        <ConfirmDialog
          title="Students have already answered these"
          body={
            <>
              {risk.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </>
          }
          confirmLabel="Save anyway"
          busy={busy}
          busyLabel="Saving…"
          onConfirm={() => void finish(true)}
          onCancel={() => setRisk(null)}
        />
      ) : null}
    </div>
  );
}
