"use client";

// Making a team evaluation, in two steps: the activity (title, description,
// week, due date), then what students fill in — the rating categories, each a
// 1–5 scale with a sentence for every point, and the open-ended questions,
// some about each teammate and some about themselves. Finish saves both and,
// the first time, puts it in front of the class.
//
// Opened again later it edits the same evaluation. Once anyone has submitted,
// categories and questions can't be added or removed (0058) — wording can.

import { useMemo, useState } from "react";
import { updateActivity } from "@/checkins/data";
import type { Activity } from "@/checkins/types";
import { saveTeamEvalShape, setTeamEvalSettings } from "@/teameval/data";
import {
  blankCategory,
  blankQuestion,
  defaultCategories,
  defaultQuestions,
  problemWith,
  type CategoryDraft,
  type QuestionDraft,
} from "@/teameval/defaults";
import { fmtPoints } from "@/teameval/model";
import type { QuestionAudience, TeamEvalSnapshot } from "@/teameval/types";
import { Ic } from "@/live/ui";
import { fromLocalInput, toLocalInput } from "../ActivityDetail";
import { DescriptionEditor } from "../DescriptionEditor";
import type { FacultyData } from "../FacultyApp";
import { Steps } from "../Steps";

const STEPS = [
  { key: "activity", label: "Activity" },
  { key: "form", label: "Categories & questions" },
];

interface Props {
  data: FacultyData;
  activity: Activity;
  snapshot: TeamEvalSnapshot;
  /** 0 for a new one or its details, 1 for "Edit categories & questions". */
  startStep: 0 | 1;
  onLeave: () => void;
  /** Saved. `published` when this Finish is what put it in front of the class. */
  onDone: (published: boolean) => void;
  onError: (e: unknown) => void;
}

function Switch({ on, label, disabled, title, onChange }: { on: boolean; label: string; disabled?: boolean; title?: string; onChange: (on: boolean) => void }) {
  return (
    <div className="te-switchrow" title={title}>
      <button
        type="button"
        className={`fv-switch${on ? " on" : ""}`}
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
      />
      <span>{label}</span>
    </div>
  );
}

export function TeamEvalBuilder({ data, activity, snapshot, startStep, onLeave, onDone, onError }: Props) {
  const firstTime = snapshot.categories.length === 0;
  /** Anyone has submitted: the shape is fixed, the words aren't. */
  const fixed = snapshot.submissions.length > 0;
  const [step, setStep] = useState<0 | 1>(startStep);
  const [title, setTitle] = useState(firstTime && activity.title === "Untitled" ? "" : activity.title);
  const [week, setWeek] = useState<number | null>(activity.week);
  const [due, setDue] = useState(toLocalInput(activity.due_at ?? activity.individual_due_at));
  const [desc, setDesc] = useState(activity.source_text ?? "");
  const [sawForm, setSawForm] = useState(startStep === 1);
  const [categories, setCategories] = useState<CategoryDraft[]>(() =>
    firstTime ? defaultCategories() : snapshot.categories.map((c) => ({ id: c.id, name: c.name, levels: [...c.levels] })),
  );
  const [questions, setQuestions] = useState<QuestionDraft[]>(() =>
    firstTime && snapshot.questions.length === 0
      ? defaultQuestions()
      : snapshot.questions.map((q) => ({ id: q.id, audience: q.audience, prompt: q.prompt })),
  );
  const [peer, setPeer] = useState(snapshot.settings.peer_comments);
  const [release, setRelease] = useState(snapshot.settings.release_comments);
  const [anon, setAnon] = useState(snapshot.settings.anonymize);
  const [explain, setExplain] = useState(snapshot.settings.explain_ratings);
  const [points, setPoints] = useState(String(activity.points_total || 10));
  const [penalty, setPenalty] = useState(String(snapshot.settings.late_penalty));
  const [busy, setBusy] = useState(false);

  const weeks = useMemo(() => [...data.weeks].sort((a, b) => a.week - b.week), [data.weeks]);
  const weekName = (w: number | null) => weeks.find((x) => x.week === w)?.title || (w === null ? "No week" : `Week ${w}`);

  const pts = Number(points);
  const pen = Number(penalty);
  const problem =
    problemWith(categories, questions) ??
    (!points.trim() || !Number.isFinite(pts) || pts <= 0 ? "Points must be above 0" : null) ??
    (!penalty.trim() || !Number.isFinite(pen) || pen < 0 || pen > 100 ? "Late penalty: 0–100%" : null);
  // Turning anonymity off after students wrote under it is refused (0058).
  const anonLocked = fixed && snapshot.settings.anonymize;

  const setCat = (id: string, change: Partial<CategoryDraft>) => setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, ...change } : c)));
  const setLevel = (id: string, score: number, text: string) =>
    setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, levels: c.levels.map((l, i) => (i === score - 1 ? text : l)) } : c)));
  const setQ = (id: string, prompt: string) => setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, prompt } : q)));

  const saveBasics = async () => {
    setBusy(true);
    try {
      await updateActivity(activity.id, {
        title: title.trim(),
        week,
        due_at: fromLocalInput(due),
        source_text: desc.trim() ? desc.trim() : null,
      });
      if (!firstTime && !sawForm) {
        onDone(false);
        return;
      }
      setStep(1);
      setSawForm(true);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const basicsOnly = !firstTime && !sawForm;

  const finish = async () => {
    if (problem) return;
    setBusy(true);
    try {
      await saveTeamEvalShape(activity.id, categories, questions);
      await setTeamEvalSettings(activity.id, {
        peer_comments: peer,
        release_comments: release,
        anonymize: anon,
        explain_ratings: explain,
        late_penalty: pen,
      });
      await updateActivity(activity.id, {
        title: title.trim() || activity.title,
        points_total: pts,
        ...(firstTime ? { opens_at: null } : {}),
      });
      onDone(firstTime);
    } catch (e) {
      onError(e);
      setBusy(false);
    }
  };

  const questionColumn = (audience: QuestionAudience, heading: string, off: boolean) => {
    const list = questions.filter((q) => q.audience === audience);
    return (
      <div className={`te-qcol${off ? " off" : ""}`}>
        <div className="te-qcolhead">
          <span className="fv-eyebrow">{heading}</span>
          {off ? <span className="fv-sub">Off</span> : null}
        </div>
        {list.map((q, i) => (
          <div key={q.id} className="te-qrow">
            <textarea
              className="fv-in te-qin"
              rows={2}
              value={q.prompt}
              placeholder="Question"
              aria-label={`${heading} question ${i + 1}`}
              disabled={off}
              onChange={(e) => setQ(q.id, e.target.value)}
            />
            {fixed ? null : (
              <button
                type="button"
                className="fv-iconbtn"
                aria-label="Remove question"
                onClick={() => setQuestions((qs) => qs.filter((x) => x.id !== q.id))}
              >
                <Ic name="close" size={14} />
              </button>
            )}
          </div>
        ))}
        {fixed || off ? null : (
          <button type="button" className="te-addq" onClick={() => setQuestions((qs) => [...qs, blankQuestion(audience)])}>
            <Ic name="add" size={15} /> Add question
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="fv-panel lq-panel te-fac">
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
          {title || "Untitled"} · {weekName(week)}
        </span>
        {step === 1 ? (
          <>
            <span className="te-problem">{problem}</span>
            <button type="button" className="fv-btn primary sm" disabled={!!problem || busy} onClick={() => void finish()}>
              {busy ? "Saving…" : firstTime ? "Finish" : "Save"}
            </button>
          </>
        ) : null}
      </div>
      <Steps steps={STEPS} current={step} onGo={() => setStep(0)} />

      <div className="fv-scroll lq-scroll">
        {step === 0 ? (
          <div className="lq-bstep1">
            <input
              className="fv-display fv-titlein lq-titlein"
              value={title}
              placeholder="Title"
              aria-label="Activity title"
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
            />
            <DescriptionEditor initial={desc} files={[]} onChange={setDesc} placeholder="Instructions" />
            <div className="fv-fields">
              <label className="fv-field">
                <span className="fv-eyebrow">Week</span>
                <select className="fv-in quiet" value={week ?? ""} onChange={(e) => setWeek(e.target.value === "" ? null : Number(e.target.value))}>
                  {week === null ? <option value="">No week</option> : null}
                  {weeks.map((w) => (
                    <option key={w.id} value={w.week}>
                      {w.title || `Week ${w.week}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fv-field">
                <span className="fv-eyebrow">Due</span>
                <input className="fv-in quiet" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
            </div>

            <div className="fv-editbar">
              <button type="button" className="fv-btn primary sm" disabled={!title.trim() || busy} onClick={() => void saveBasics()}>
                {basicsOnly ? "Save" : "Continue"}
              </button>
              <button type="button" className="fv-btn ghost sm" onClick={onLeave}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="lq-builder">
              <section className="lq-bmain">
                {fixed ? (
                  <div className="te-note" role="status">
                    <Ic name="lock" size={14} />
                    <span>{snapshot.submissions.length} submitted — wording edits only</span>
                  </div>
                ) : null}

                <div className="te-catgrid">
                  {categories.map((c, i) => (
                    <div key={c.id} className="fv-card te-catcard">
                      <div className="te-cathead">
                        <input
                          className="fv-in te-catname"
                          value={c.name}
                          placeholder="Category"
                          aria-label={`Category ${i + 1} name`}
                          onChange={(e) => setCat(c.id, { name: e.target.value })}
                        />
                        {fixed ? null : (
                          <button
                            type="button"
                            className="fv-iconbtn"
                            aria-label={`Remove ${c.name || `category ${i + 1}`}`}
                            onClick={() => setCategories((cs) => cs.filter((x) => x.id !== c.id))}
                          >
                            <Ic name="trash" size={14} />
                          </button>
                        )}
                      </div>
                      <div className="te-levels">
                        {[5, 4, 3, 2, 1].map((score) => (
                          <label key={score} className="te-level">
                            <span className={`te-score s${score}`}>{score}</span>
                            <textarea
                              className="fv-in te-levelin"
                              rows={2}
                              value={c.levels[score - 1] ?? ""}
                              aria-label={`${c.name || `Category ${i + 1}`}: what ${score} means`}
                              onChange={(e) => setLevel(c.id, score, e.target.value)}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {fixed ? null : (
                    <button type="button" className="te-addcat" onClick={() => setCategories((cs) => [...cs, blankCategory()])}>
                      <span className="te-addcircle">
                        <Ic name="add" size={20} />
                      </span>
                      Add category
                    </button>
                  )}
                </div>

                <h2 className="te-h2">Questions</h2>
                <div className="te-qcols">
                  {questionColumn("peer", "Each teammate", !peer)}
                  {questionColumn("self", "Self reflection", false)}
                </div>
              </section>

              <aside className="lq-bside">
                <div className="fv-card lq-bcard">
                  <span className="lq-bcardtitle">Peer feedback</span>
                  <Switch on={peer} label="Evaluate peer to peer" onChange={setPeer} />
                  <Switch on={release} label="Release to students" onChange={setRelease} />
                  <Switch
                    on={anon}
                    label="Anonymize"
                    disabled={anonLocked}
                    title={anonLocked ? "Locked: students submitted anonymously" : undefined}
                    onChange={setAnon}
                  />
                  <Switch on={explain} label="Require a reason per rating" onChange={setExplain} />
                </div>
                <div className="fv-card lq-bcard">
                  <span className="lq-bcardtitle">Grade</span>
                  <div className="te-numrow">
                    <label className="fv-field">
                      <span className="fv-eyebrow">Points</span>
                      <input className="fv-in" type="number" min={0} step="any" value={points} onChange={(e) => setPoints(e.target.value)} />
                    </label>
                    <label className="fv-field">
                      <span className="fv-eyebrow">Late penalty</span>
                      <span className="te-pct">
                        <input className="fv-in" type="number" min={0} max={100} step="any" value={penalty} onChange={(e) => setPenalty(e.target.value)} />
                        <span>%</span>
                      </span>
                    </label>
                  </div>
                  {Number.isFinite(pts) && Number.isFinite(pen) && pts > 0 ? (
                    <p className="lq-bnote">
                      On time {fmtPoints(pts)} · Late {fmtPoints(pts * (1 - pen / 100))} · None 0
                    </p>
                  ) : null}
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
