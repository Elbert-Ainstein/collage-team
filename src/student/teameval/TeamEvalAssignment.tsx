"use client";

// A team evaluation, from the student's side.
//
// Filling it in goes a category at a time: the five descriptions once, then
// everyone on the team — themselves first — side by side on the same 1–5
// buttons. Reading the descriptions once and placing people next to each
// other is quicker than a page per person, and it gives more honest, more
// spread-out ratings than judging each teammate alone. Then their comments,
// a card per teammate; then their reflection; then a review. It saves as they
// go (save_team_eval, as a draft) and Submit checks it's complete.
//
// Once the instructor releases results: every category on one 1–5 line —
// what they gave themselves and the average of what their teammates gave
// them (themselves and anyone who didn't submit left out) — the one place
// they and their team see them most differently, and what teammates wrote,
// without names when it's anonymous.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Assignment, Enrolment } from "@/checkins/studentData";
import { BriefText } from "@/checkins/BriefText";
import { loadMyTeamEvalResults, loadStudentTeamEval, saveMyTeamEval } from "@/teameval/data";
import { biggestGap, draftFrom, draftPayload, fmtAvg, leftInStep, reasonNeeded, stepsFor, type EvalDraft, type Step } from "@/teameval/model";
import { AutoTextarea } from "@/teameval/AutoTextarea";
import { ScoreTrack } from "@/teameval/ScoreTrack";
import {
  COMMENT_MAX,
  REASON_MAX,
  type ReasonsMode,
  type StudentTeamEval,
  type TeamEvalCategory,
  type TeamEvalMember,
  type TeamEvalResults,
} from "@/teameval/types";
import { Ic } from "@/live/ui";
import "@/live/live.css";
import "@/teameval/teameval.css";

interface Props {
  assignment: Assignment;
  enrolment: Enrolment;
  onBack: () => void;
}

type Loaded =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "missing" }
  | { kind: "ready"; ev: StudentTeamEval; results: TeamEvalResults | null };

type Screen = "intro" | "step" | "review" | "done" | "results";
type SaveState = "idle" | "saving" | "saved" | "failed";

const AUTOSAVE_MS = 1200;
const SCORES = [1, 2, 3, 4, 5] as const;

function fmtWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Who reads what they write about teammates, in one line. */
function privacyNote(ev: StudentTeamEval): string {
  const s = ev.settings;
  if (!s.release_comments) return "Only your instructor sees your comments";
  return s.anonymize ? "Anonymous to teammates" : "Teammates see your name";
}

const stepName = (step: Step) => (step.kind === "category" ? step.category.name : step.kind === "comments" ? "Comments" : "Reflection");

export function TeamEvalAssignment({ assignment, enrolment, onBack }: Props) {
  const { activity } = assignment;
  const me = enrolment.student.id;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [screen, setScreen] = useState<Screen>("intro");
  const [at, setAt] = useState(0);
  const [draft, setDraft] = useState<EvalDraft>({ ratings: {}, comments: {} });
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const ev = await loadStudentTeamEval(activity.id, me);
      if (!ev) {
        setLoaded({ kind: "missing" });
        return;
      }
      const results = ev.settings.released_at ? await loadMyTeamEvalResults(activity.id) : null;
      setDraft(draftFrom(ev.ratings, ev.comments));
      setLoaded({ kind: "ready", ev, results });
      setScreen(results?.released ? "results" : ev.submission ? "done" : "intro");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoaded((l) => (l.kind === "ready" ? l : { kind: "failed" }));
    }
  }, [activity.id, me]);

  useEffect(() => {
    void load();
  }, [load]);

  const ev = loaded.kind === "ready" ? loaded.ev : null;
  const dueAt = activity.due_at ?? activity.individual_due_at;
  const due = fmtWhen(dueAt);
  const pastDue = dueAt ? Date.parse(dueAt) < Date.now() : false;
  const submitted = Boolean(ev?.submission);
  const released = Boolean(ev?.settings.released_at);
  /** A submitted one can still change until the due date, and not once results are out. */
  const editable = !submitted || (!released && !pastDue);
  const team = useMemo(() => ev?.team ?? [], [ev]);
  const steps = useMemo(() => (ev ? stepsFor(ev) : []), [ev]);
  const left = useMemo(() => (ev ? steps.map((s) => leftInStep(s, draft, team, ev.settings)) : []), [steps, draft, team, ev]);
  const totalLeft = left.reduce((a, b) => a + b, 0);
  const doneSteps = left.filter((n) => n === 0).length;
  /** Anything filled in yet — a score or an answer, not an emptied box. */
  const started = useMemo(() => {
    const { ratings, comments } = draftPayload(draft);
    return ratings.length > 0 || comments.length > 0;
  }, [draft]);

  // Drafts save as they go. A submitted evaluation saves only whole, on
  // Save — the database won't take an incomplete one (0058).
  const flush = useCallback(
    async (d: EvalDraft) => {
      if (!ev || submitted) return;
      dirty.current = false;
      setSave("saving");
      try {
        await saveMyTeamEval(activity.id, d, false);
        setSave(dirty.current ? "saving" : "saved");
      } catch (e) {
        setSave("failed");
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [activity.id, ev, submitted],
  );

  const change = (next: (d: EvalDraft) => EvalDraft) => {
    setDraft((d) => {
      const n = next(d);
      dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(n), AUTOSAVE_MS);
      return n;
    });
    if (!submitted) setSave("saving");
  };
  // Leaving with a change still waiting: send it now.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (dirty.current) void flush(draftRef.current);
    },
    [flush],
  );

  const setScore = (ratee: string, category: string, score: number) =>
    change((d) => ({
      ...d,
      ratings: { ...d.ratings, [ratee]: { ...d.ratings[ratee], [category]: { score, reason: d.ratings[ratee]?.[category]?.reason ?? "" } } },
    }));
  const setReason = (ratee: string, category: string, reason: string) =>
    change((d) => ({
      ...d,
      ratings: { ...d.ratings, [ratee]: { ...d.ratings[ratee], [category]: { score: d.ratings[ratee]?.[category]?.score ?? null, reason } } },
    }));
  const setAnswer = (subject: string, question: string, body: string) =>
    change((d) => ({ ...d, comments: { ...d.comments, [subject]: { ...d.comments[subject], [question]: body } } }));

  const go = (next: number | "review") => {
    if (next === "review") setScreen("review");
    else {
      setAt(next);
      setScreen("step");
    }
    scrollRef.current?.scrollTo({ top: 0 });
  };
  /** Where Continue picks up: the first step with something left. */
  const firstOpen = Math.max(0, left.findIndex((n) => n > 0));

  const submit = async () => {
    window.clearTimeout(timer.current);
    dirty.current = false;
    setSubmitting(true);
    setError(null);
    try {
      await saveMyTeamEval(activity.id, draft, true);
      await load();
      setScreen("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  /** Where Overview and Done go: the results once they're out. */
  const home: Screen = loaded.kind === "ready" && loaded.results?.released ? "results" : submitted ? "done" : "intro";

  // ------------------------------------------------------------- the body
  const body = () => {
    if (loaded.kind === "loading") return <div className="lq-sscroll fv-sub">Loading…</div>;
    if (loaded.kind === "failed" || loaded.kind === "missing" || !ev) {
      return (
        <div className="lq-sscroll">
          <div className="lq-scard">
            <p className="fv-sub">{loaded.kind === "failed" ? "Couldn’t load." : "Not ready yet."}</p>
            {loaded.kind === "failed" ? (
              <button type="button" className="fv-btn outline sm" onClick={() => void load()}>
                Retry
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    if (team.length === 0) {
      return (
        <div className="lq-sscroll">
          <div className="lq-scard">
            <h2 className="lq-h2">Not on a team</h2>
            <p className="fv-sub">Ask your instructor to add you.</p>
          </div>
        </div>
      );
    }

    if (screen === "results" && loaded.kind === "ready" && loaded.results?.released) {
      return (
        <div className="lq-sscroll" ref={scrollRef}>
          <Results ev={ev} results={loaded.results} title={activity.title} />
        </div>
      );
    }

    if (screen === "intro" || screen === "done") {
      const brief = activity.source_text?.trim() ?? "";
      return (
        <div className="lq-sscroll" ref={scrollRef}>
          <div className="lq-scard te-intro">
            <h2 className="lq-h2">{activity.title}</h2>
            {due ? <p className="fv-sub">Due {due}</p> : null}
            {brief ? (
              <p className="te-brief">
                <BriefText text={brief} />
              </p>
            ) : null}
            {screen === "done" ? (
              <div className="te-donebox" role="status">
                <Ic name="check" size={16} />
                <span>
                  <b>Submitted {fmtWhen(ev.submission?.submitted_at ?? null)}</b>
                  {editable && due ? ` · editable until ${due}` : ""}
                </span>
              </div>
            ) : (
              <>
                <div className="te-rating">
                  <span className="fv-eyebrow">You’ll rate</span>
                  <div className="te-namechips">
                    {team.map((p) => (
                      <span key={p.student_id} className="te-namechip">
                        {p.is_me ? "You" : p.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="te-progressline">
                  <div className="te-progress" aria-hidden="true">
                    <span style={{ width: `${steps.length ? (100 * doneSteps) / steps.length : 0}%` }} />
                  </div>
                  <span className="fv-sub">
                    {doneSteps} of {steps.length} done
                  </span>
                </div>
                <p className="te-howto">{privacyNote(ev)}</p>
              </>
            )}
            {editable ? (
              <button type="button" className="fv-btn primary te-start" onClick={() => (screen !== "done" && totalLeft === 0 ? go("review") : go(screen === "done" ? 0 : firstOpen))}>
                {screen === "done" ? "Edit" : totalLeft === 0 ? "Review" : started ? "Continue" : "Start"}
                <Ic name="arrowRight" size={15} />
              </button>
            ) : (
              <button type="button" className="fv-btn outline te-start" onClick={() => go(0)}>
                View
              </button>
            )}
          </div>
        </div>
      );
    }

    if (screen === "review") {
      return (
        <div className="lq-sscroll" ref={scrollRef}>
          <div className="lq-scard">
            <h2 className="lq-h2">Review</h2>
            {totalLeft > 0 ? (
              <p className="fv-sub" style={{ marginTop: 6 }}>
                Fill in everything to submit
              </p>
            ) : null}
            <ul className="te-people">
              {steps.map((s, i) => (
                <li key={i}>
                  <button type="button" className="te-personbtn" onClick={() => go(i)}>
                    <span className="te-pname">{stepName(s)}</span>
                    <span className={`te-pstate${left[i] === 0 ? " done" : ""}`}>
                      {left[i] === 0 ? <Ic name="check" size={14} /> : `${left[i]} left`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    }

    // One step.
    const step = steps[at];
    if (!step) return null;
    const ro = !editable;
    return (
      <div className="lq-sscroll" ref={scrollRef}>
        <div className="te-stephead">
          <div className="te-progress" aria-hidden="true">
            <span style={{ width: `${(100 * (at + 1)) / steps.length}%` }} />
          </div>
          <span className="fv-sub">
            {at + 1} of {steps.length}
          </span>
        </div>

        {step.kind === "category" ? (
          <CategoryStep
            category={step.category}
            team={team}
            draft={draft}
            mode={ev.settings.reasons}
            readOnly={ro}
            onScore={setScore}
            onReason={setReason}
          />
        ) : (
          <>
            <h2 className="lq-h2 te-steptitle">{step.kind === "comments" ? "Comments" : "Reflection"}</h2>
            {team
              .filter((p) => (step.kind === "reflection" ? p.is_me : !p.is_me))
              .map((p) => (
                <section key={p.student_id} className="lq-scard te-qbox">
                  {step.kind === "comments" ? <h3 className="te-boxtitle">{p.name}</h3> : null}
                  {step.questions.map((q) => (
                    <label key={q.id} className="te-qfield">
                      <span>{q.prompt}</span>
                      <AutoTextarea
                        className="fv-in te-ta"
                        rows={step.kind === "reflection" ? 5 : 3}
                        max={COMMENT_MAX}
                        value={draft.comments[p.student_id]?.[q.id] ?? ""}
                        readOnly={ro}
                        onChange={(v) => setAnswer(p.student_id, q.id, v)}
                      />
                    </label>
                  ))}
                </section>
              ))}
          </>
        )}
      </div>
    );
  };

  // ------------------------------------------------------------ the footer
  const footer = () => {
    if (!ev || team.length === 0) return null;
    if (screen === "step") {
      const last = at === steps.length - 1;
      return (
        <div className="lq-sfoot te-sfoot">
          <button type="button" className="fv-btn outline sm" onClick={() => (at === 0 ? setScreen(home) : go(at - 1))}>
            <Ic name="chevronLeft" size={14} /> {at === 0 ? "Overview" : stepName(steps[at - 1])}
          </button>
          <span className="te-savestate fv-sub" aria-live="polite">
            {!editable ? "Read only" : submitted ? "" : save === "saving" ? "Saving…" : save === "saved" ? "Saved" : save === "failed" ? "Not saved" : ""}
          </span>
          {last ? (
            editable ? (
              <button type="button" className="fv-btn primary sm" onClick={() => go("review")}>
                Review <Ic name="arrowRight" size={14} />
              </button>
            ) : (
              <button type="button" className="fv-btn primary sm" onClick={() => setScreen(home)}>
                Done
              </button>
            )
          ) : (
            <button type="button" className="fv-btn primary sm" onClick={() => go(at + 1)}>
              {stepName(steps[at + 1])} <Ic name="chevronRight" size={14} />
            </button>
          )}
        </div>
      );
    }
    if (screen === "review") {
      return (
        <div className="lq-sfoot te-sfoot">
          <button type="button" className="fv-btn outline sm" onClick={() => go(steps.length - 1)}>
            <Ic name="chevronLeft" size={14} /> Back
          </button>
          <span />
          <button type="button" className="fv-btn primary sm" disabled={totalLeft > 0 || submitting} onClick={() => void submit()}>
            {submitting ? "Saving…" : submitted ? "Save" : "Submit"}
          </button>
        </div>
      );
    }
    if (screen === "results" && submitted) {
      return (
        <div className="lq-sfoot te-sfoot">
          <span />
          <button type="button" className="fv-btn ghost sm" onClick={() => go(0)}>
            My answers
          </button>
        </div>
      );
    }
    return null;
  };

  const pill = released ? "Results" : submitted ? "Submitted" : pastDue ? "Late" : null;

  return (
    <div className="lq-stu lq-shost te-stu">
      <div className="lq-spanel">
        <header className="lq-sbar">
          <div className="lq-sbartitle">
            <button type="button" className="lq-sback" onClick={onBack}>
              <Ic name="chevronLeft" size={14} />
              All assignments
            </button>
            {screen === "step" || screen === "review" ? <span className="lq-sname">{activity.title}</span> : null}
          </div>
          {pill ? <span className={`te-pill ${pill.toLowerCase()}`}>{pill}</span> : null}
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
        {footer()}
      </div>
    </div>
  );
}

// ------------------------------------------------------- one category

function CategoryStep({
  category,
  team,
  draft,
  mode,
  readOnly,
  onScore,
  onReason,
}: {
  category: TeamEvalCategory;
  team: TeamEvalMember[];
  draft: EvalDraft;
  mode: ReasonsMode;
  readOnly: boolean;
  onScore: (ratee: string, category: string, score: number) => void;
  onReason: (ratee: string, category: string, reason: string) => void;
}) {
  return (
    <>
      <h2 className="lq-h2 te-steptitle">{category.name}</h2>
      <ol className="te-key">
        {SCORES.map((n) => (
          <li key={n}>
            <span className={`te-score s${n}`}>{n}</span>
            <span>{category.levels[n - 1] || "—"}</span>
          </li>
        ))}
      </ol>
      <div className="te-raterows">
        {team.map((p) => (
          <RateRow
            key={p.student_id}
            name={p.is_me ? "You" : p.name}
            levels={category.levels}
            value={draft.ratings[p.student_id]?.[category.id]?.score ?? null}
            reason={draft.ratings[p.student_id]?.[category.id]?.reason ?? ""}
            mode={mode}
            readOnly={readOnly}
            onScore={(n) => onScore(p.student_id, category.id, n)}
            onReason={(r) => onReason(p.student_id, category.id, r)}
          />
        ))}
      </div>
    </>
  );
}

function RateRow({
  name,
  levels,
  value,
  reason,
  mode,
  readOnly,
  onScore,
  onReason,
}: {
  name: string;
  levels: string[];
  value: number | null;
  reason: string;
  mode: ReasonsMode;
  readOnly: boolean;
  onScore: (n: number) => void;
  onReason: (r: string) => void;
}) {
  const needed = reasonNeeded(mode, value);
  const [wantWhy, setWantWhy] = useState(false);
  const showWhy = needed || wantWhy || reason.trim() !== "";
  return (
    <div className="lq-scard te-raterow">
      <div className="te-raterhead">
        <span className="te-ratername">{name}</span>
        <div className="te-scorebtns" role="radiogroup" aria-label={name}>
          {SCORES.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n}: ${levels[n - 1] ?? ""}`}
              className={`te-scorebtn s${n}${value === n ? " on" : ""}`}
              disabled={readOnly && value !== n}
              onClick={() => !readOnly && onScore(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      {value !== null ? <p className="te-echo">{levels[value - 1] || "—"}</p> : null}
      {showWhy ? (
        <AutoTextarea
          className="fv-in te-ta te-why"
          rows={2}
          max={REASON_MAX}
          value={reason}
          readOnly={readOnly}
          aria-label={`${name}: why`}
          placeholder={needed ? `Why a ${value}?` : "Why? (optional)"}
          onChange={onReason}
        />
      ) : value !== null && mode !== "none" && !readOnly ? (
        <button type="button" className="te-addwhy" onClick={() => setWantWhy(true)}>
          + Why
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- results

function Results({ ev, results, title }: { ev: StudentTeamEval; results: TeamEvalResults; title: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const byCat = new Map((results.categories ?? []).map((c) => [c.category_id, c]));
  const prompts = new Map(ev.questions.map((q) => [q.id, q.prompt]));
  const comments = results.comments ?? [];
  const byQuestion = useMemo(() => {
    const out = new Map<string, { author: string | null; body: string }[]>();
    for (const c of comments) out.set(c.question_id, [...(out.get(c.question_id) ?? []), c]);
    return out;
  }, [comments]);
  const reflection = results.reflection ?? [];
  const teammates = ev.team.filter((p) => !p.is_me).length;
  const raters = Math.max(0, ...(results.categories ?? []).map((c) => c.raters));
  const gap = biggestGap(
    ev.categories.map((c) => ({ name: c.name, self: byCat.get(c.id)?.self ?? null, average: byCat.get(c.id)?.average ?? null })),
  );
  const anyRated = raters > 0;

  return (
    <>
      <div className="te-who">
        <h2 className="lq-h2">{title}</h2>
        <p className="fv-sub">
          Rated by {raters} of {teammates} teammate{teammates === 1 ? "" : "s"}
        </p>
      </div>

      {anyRated ? (
        <div className={`te-insight${gap ? "" : " calm"}`}>
          {gap ? (
            <>
              Teammates rated your <b>{gap.name}</b> {gap.average > gap.self ? "higher" : "lower"} than you did —{" "}
              {fmtAvg(gap.average)} vs {gap.self}.
            </>
          ) : (
            "You and your teammates see you about the same."
          )}
        </div>
      ) : null}

      <section className="lq-scard te-summary">
        <p className="fv-sub te-legend">
          <span className="te-key-dot team" /> Teammates <span className="te-key-dot self" /> You
        </p>
        {ev.categories.map((c) => {
          const r = byCat.get(c.id);
          const self = r?.self ?? null;
          const avg = r?.average ?? null;
          const isOpen = open === c.id;
          return (
            <div key={c.id} className={`te-sumrow${isOpen ? " open" : ""}`}>
              <button type="button" className="te-sumhead" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)}>
                <span className="te-sumname">{c.name}</span>
                <ScoreTrack team={avg} self={self} label={`${c.name}: teammates ${fmtAvg(avg)}, you ${self ?? "—"}`} />
                <span className="te-sumnums">
                  <b>{fmtAvg(avg)}</b>
                  <span className="fv-sub"> · you {self ?? "—"}</span>
                </span>
                <Ic name={isOpen ? "maximize" : "minimize"} size={14} />
              </button>
              {isOpen ? (
                <div className="te-sumbody">
                  {(() => {
                    const teamAt = avg === null ? null : Math.min(5, Math.max(1, Math.round(avg)));
                    if (teamAt !== null && teamAt === self) {
                      return (
                        <p>
                          <span className="te-key-dot team" />
                          <span className="te-key-dot self" /> {c.levels[self - 1] || "—"}
                        </p>
                      );
                    }
                    return (
                      <>
                        {teamAt !== null ? (
                          <p>
                            <span className="te-key-dot team" /> {c.levels[teamAt - 1] || "—"}
                          </p>
                        ) : null}
                        {self !== null ? (
                          <p>
                            <span className="te-key-dot self" /> {c.levels[self - 1] || "—"}
                          </p>
                        ) : null}
                      </>
                    );
                  })()}
                  {r?.reasons.length ? (
                    <ul className="te-reasons">
                      {r.reasons.map((x, i) => (
                        <li key={i}>
                          <b className={`te-chip s${x.score}`}>{x.score}</b>
                          <span>
                            {x.text}
                            {x.author ? <span className="te-by"> — {x.author}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </section>

      {results.comments_shown && ev.settings.peer_comments ? (
        <section className="lq-scard te-qbox">
          <h3 className="te-boxtitle">Comments</h3>
          {comments.length === 0 ? <p className="fv-sub">None yet</p> : null}
          {[...byQuestion.entries()].map(([qid, list]) => (
            <div key={qid} className="te-cq">
              <span className="te-prompt">{prompts.get(qid) ?? "Question"}</span>
              <ul>
                {list.map((c, i) => (
                  <li key={i}>
                    <p>{c.body}</p>
                    {c.author ? <span className="te-by">— {c.author}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {reflection.length ? (
        <section className="lq-scard te-qbox te-mine">
          <h3 className="te-boxtitle">Your reflection</h3>
          {reflection.map((r) => (
            <div key={r.question_id} className="te-cq">
              {reflection.length > 1 ? <span className="te-prompt">{prompts.get(r.question_id)}</span> : null}
              <p>{r.body}</p>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
