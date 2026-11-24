"use client";

// Making a team evaluation, in two steps: the activity (title, description,
// week, due date), then what students fill in — the rating categories, each a
// 1–5 scale with a sentence for every point, and the open-ended questions:
// about each teammate, about themselves, and last an optional note to the
// instructor that arrives without a name (0060). Each set says who reads the
// answers. Finish saves both and, the first time, puts it in front of the
// class.
//
// Opened again later it edits the same evaluation. Once anyone has submitted,
// categories and questions can't be added or removed (0058) — wording can.
//
// While it is open the assistant can read and fill this form (formBridge.ts):
// from a rubric or a Google Doc, or one setting at a time. A fill changes only
// what is on screen; Finish or Save is still what writes.

import { useEffect, useMemo, useRef, useState } from "react";
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
import { AutoTextarea } from "@/teameval/AutoTextarea";
import { fmtPoints, lateLossAtMost, outOf, readersOf, type Readers } from "@/teameval/model";
import type { QuestionAudience, TeamEvalSnapshot } from "@/teameval/types";
import { Ic } from "@/live/ui";
import { useFormBridge, type TeamEvalFormHandle } from "../assistant/formBridge";
import type { TeamEvalForm } from "../assistant/teamEvalFill";
import { fromLocalInput, toLocalInput } from "../ActivityDetail";
import { DescriptionEditor } from "../DescriptionEditor";
import type { FacultyData } from "../FacultyApp";
import { Steps } from "../Steps";

// What 0058 keeps: a category name up to 120 characters, a question up to
// 1,000. A level's description has no limit there; this one keeps a slip of
// the paste from filling the form.
const NAME_MAX = 120;
const PROMPT_MAX = 1000;
const LEVEL_MAX = 2000;

/** Who reads a section's answers, as the instructor sees it said. */
const READERS: Record<Readers, { icon: string; text: string }> = {
  "teammate-anonymous": { icon: "eye", text: "Shown to that teammate · anonymous" },
  "teammate-named": { icon: "eye", text: "Shown to that teammate · with names" },
  instructor: { icon: "lock", text: "Instructor only" },
  "instructor-anonymous": { icon: "eyeOff", text: "Anonymous · optional" },
};

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

/** The first step's fields as the activity row stores them. */
function basicsFrom(f: { week: number | null; due: string; desc: string }) {
  return { week: f.week, due_at: fromLocalInput(f.due), source_text: f.desc.trim() ? f.desc.trim() : null };
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
  const [penalty, setPenalty] = useState(String(snapshot.settings.late_penalty));
  const [busy, setBusy] = useState(false);
  /** The first step's fields as last saved, so Finish writes only what changed since. */
  const opening = useRef({ week, due, desc });

  const weeks = useMemo(() => [...data.weeks].sort((a, b) => a.week - b.week), [data.weeks]);
  const weekName = (w: number | null) => weeks.find((x) => x.week === w)?.title || (w === null ? "No week" : `Week ${w}`);

  const pen = Number(penalty);
  const total = outOf(categories);
  const penOk = penalty.trim() !== "" && Number.isFinite(pen) && pen >= 0 && pen <= 100;
  const problem = problemWith(categories, questions) ?? (penOk ? null : "Late penalty: 0–100%");
  /** What it means, in points: a share of a late student's grade, so at most that share of the total. */
  const penaltyNote = !penOk
    ? null
    : pen === 0
      ? "Late evaluations lose nothing."
      : `Off a late student’s grade: up to ${fmtPoints(lateLossAtMost(total, pen))} of ${total} pts.`;
  // Turning anonymity off after students wrote under it is refused (0058).
  const anonLocked = fixed && snapshot.settings.anonymize;
  const saveLabel = firstTime ? "Finish" : "Save";

  // The assistant's way in: what the form says now, and how to fill it.
  const bridge = useFormBridge();
  /** Bumped when a fill rewrites the instructions: their box reads its text only when it mounts. */
  const [descVersion, setDescVersion] = useState(0);
  /** One id for as long as this builder is open, so a fill's Undo outlives a change of lock. */
  const [handleId] = useState(() => crypto.randomUUID());
  const latest = useRef<TeamEvalForm | null>(null);
  latest.current = {
    title,
    instructions: desc,
    due,
    categories,
    questions,
    peerComments: peer,
    releaseComments: release,
    anonymize: anon,
    latePenalty: penalty,
  };
  useEffect(() => {
    if (!bridge) return;
    const handle: TeamEvalFormHandle = {
      kind: "teameval",
      id: handleId,
      read: () => latest.current as TeamEvalForm,
      fill: (next, { showForm }) => {
        if (next.instructions !== latest.current?.instructions) setDescVersion((v) => v + 1);
        setTitle(next.title);
        setDesc(next.instructions);
        setDue(next.due);
        setCategories(next.categories);
        setQuestions(next.questions);
        setPeer(next.peerComments);
        setRelease(next.releaseComments);
        setAnon(next.anonymize);
        setPenalty(next.latePenalty);
        if (showForm) {
          setStep(1);
          setSawForm(true);
        }
      },
      limits: { fixed, anonLocked },
      saveLabel,
    };
    bridge.open(handle);
    return () => bridge.close(handle);
  }, [bridge, handleId, fixed, anonLocked, saveLabel]);

  const setCat = (id: string, change: Partial<CategoryDraft>) => setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, ...change } : c)));
  const setLevel = (id: string, score: number, text: string) =>
    setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, levels: c.levels.map((l, i) => (i === score - 1 ? text : l)) } : c)));
  const setQ = (id: string, prompt: string) => setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, prompt } : q)));

  const saveBasics = async () => {
    setBusy(true);
    try {
      await updateActivity(activity.id, { title: title.trim(), ...basicsFrom({ week, due, desc }) });
      // Saved: Finish need not write these again unless they change after this.
      opening.current = { week, due, desc };
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
        late_penalty: pen,
      });
      // The first step's fields too, when they changed: the assistant can fill
      // them while she is on this one, and Continue — which saves them
      // otherwise — is behind her. Only what changed: a due date read from
      // individual_due_at must not be copied into due_at by a Save.
      const basics = basicsFrom({ week, due, desc });
      const opened = opening.current;
      await updateActivity(activity.id, {
        title: title.trim() || activity.title,
        ...(week !== opened.week ? { week: basics.week } : {}),
        ...(due !== opened.due ? { due_at: basics.due_at } : {}),
        ...(desc !== opened.desc ? { source_text: basics.source_text } : {}),
        points_total: total,
        ...(firstTime ? { opens_at: null } : {}),
      });
      onDone(firstTime);
    } catch (e) {
      onError(e);
      setBusy(false);
    }
  };

  /** One kind of question — about each teammate, or about themselves — and who reads the answers. */
  const questionSection = (audience: QuestionAudience, heading: string, off: boolean) => {
    const list = questions.filter((q) => q.audience === audience);
    const readers = READERS[readersOf(audience, { release_comments: release, anonymize: anon })];
    return (
      <section className={`te-qcol${off ? " off" : ""}`} aria-label={heading}>
        <div className="te-qcolhead">
          <span className="te-qcoltitle">{heading}</span>
          {off ? (
            <span className="te-reads">Off</span>
          ) : (
            <span className={`te-reads ${audience}`}>
              <Ic name={readers.icon} size={13} />
              {readers.text}
            </span>
          )}
        </div>
        {list.map((q, i) => (
          <div key={q.id} className="te-qrow">
            <AutoTextarea
              className="fv-in te-qin"
              rows={2}
              max={PROMPT_MAX}
              value={q.prompt}
              placeholder="Question"
              aria-label={`${heading} question ${i + 1}`}
              disabled={off}
              onChange={(v) => setQ(q.id, v)}
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
      </section>
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
              {busy ? "Saving…" : saveLabel}
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
            <DescriptionEditor key={descVersion} initial={desc} files={[]} onChange={setDesc} placeholder="Instructions" />
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
                        {/* Wraps, so a long name reads whole; one line of it, still. */}
                        <AutoTextarea
                          className="fv-in te-catname"
                          rows={1}
                          max={NAME_MAX}
                          value={c.name}
                          placeholder="Category"
                          aria-label={`Category ${i + 1} name`}
                          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                          onChange={(v) => setCat(c.id, { name: v.replace(/\s*\n\s*/g, " ") })}
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
                            <AutoTextarea
                              className="fv-in te-levelin"
                              rows={2}
                              max={LEVEL_MAX}
                              value={c.levels[score - 1] ?? ""}
                              aria-label={`${c.name || `Category ${i + 1}`}: what ${score} means`}
                              onChange={(v) => setLevel(c.id, score, v)}
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
                  {questionSection("peer", "For each teammate", !peer)}
                  {questionSection("self", "Self reflection", false)}
                  {questionSection("instructor", "Note to the instructor", false)}
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
                </div>
                <div className="fv-card lq-bcard">
                  <span className="lq-bcardtitle">Grade</span>
                  <div className="te-outof">
                    <b>{total}</b>
                    <span>points · 5 per category</span>
                  </div>
                  <p className="lq-bnote">Each student gets the sum of their teammates’ averages.</p>
                  <label className="fv-field">
                    <span className="fv-eyebrow">Late penalty</span>
                    <span className="te-pct">
                      <input className="fv-in" type="number" min={0} max={100} step="any" value={penalty} onChange={(e) => setPenalty(e.target.value)} />
                      <span>%</span>
                    </span>
                  </label>
                  {penaltyNote ? (
                    <p className="lq-bnote" aria-live="polite">
                      {penaltyNote}
                    </p>
                  ) : null}
                  <p className="lq-bnote">Not submitted: 0</p>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
