"use client";

// A team evaluation, from the student's side.
//
// Before they submit: a page for each person on their team — themselves first
// — with every category as a box of five descriptions to pick from, the
// questions about that teammate under it, and on their own page their
// personal reflection. Left and right move between people; it saves as they
// go (save_team_eval, as a draft) and Submit checks it's complete.
//
// After: what they submitted, and — once the instructor releases results —
// each category with what they gave themselves beside the average of what
// their teammates gave them (themselves and anyone who didn't submit left
// out), and what teammates wrote, without names when it's anonymous.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Assignment, Enrolment } from "@/checkins/studentData";
import { BriefText } from "@/checkins/BriefText";
import { loadMyTeamEvalResults, loadStudentTeamEval, saveMyTeamEval } from "@/teameval/data";
import { SCALE, draftFrom, draftPayload, fmtAvg, leftOn, questionsFor, type EvalDraft } from "@/teameval/model";
import { AutoTextarea } from "@/teameval/AutoTextarea";
import { COMMENT_MAX, REASON_MAX, type StudentTeamEval, type TeamEvalCategory, type TeamEvalMember, type TeamEvalResults } from "@/teameval/types";
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

type Screen = "intro" | "form" | "review" | "done" | "results";
type SaveState = "idle" | "saving" | "saved" | "failed";

const AUTOSAVE_MS = 1200;

function fmtWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Who reads what they write about teammates, in one line. */
function privacyNote(ev: StudentTeamEval): string {
  const s = ev.settings;
  if (!s.release_comments) return "Only your instructor sees your comments";
  return s.anonymize ? "Anonymous to teammates" : "Teammates see your name";
}

export function TeamEvalAssignment({ assignment, enrolment, onBack }: Props) {
  const { activity } = assignment;
  const me = enrolment.student.id;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [screen, setScreen] = useState<Screen>("intro");
  const [page, setPage] = useState(0);
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
  const team = ev?.team ?? [];
  const person: TeamEvalMember | undefined = team[page];

  const left = useCallback(
    (p: TeamEvalMember) => (ev ? leftOn(draft, p.student_id, p.is_me, ev.categories, ev.questions, ev.settings) : 0),
    [draft, ev],
  );
  const totalLeft = team.reduce((n, p) => n + left(p), 0);
  /** Anything filled in yet — a score or an answer, not an emptied box. */
  const started = useMemo(() => {
    const { ratings, comments } = draftPayload(draft);
    return ratings.length > 0 || comments.length > 0;
  }, [draft]);

  // Drafts save as they go. A submitted evaluation saves only whole, on
  // "Save changes" — the database won't take an incomplete one (0058).
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
      setPage(next);
      setScreen("form");
    }
    scrollRef.current?.scrollTo({ top: 0 });
  };

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
              <p className="te-howto">{privacyNote(ev)}</p>
            )}
            <ul className="te-people">
              {team.map((p, i) => {
                const n = left(p);
                return (
                  <li key={p.student_id}>
                    <button type="button" className="te-personbtn" onClick={() => go(i)}>
                      <span className="te-pname">{p.is_me ? "You" : p.name}</span>
                      <span className={`te-pstate${n === 0 ? " done" : ""}`}>
                        {n === 0 ? <Ic name="check" size={14} /> : `${n} left`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {editable ? (
              <button type="button" className="fv-btn primary te-start" onClick={() => go(0)}>
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
              {team.map((p, i) => {
                const n = left(p);
                return (
                  <li key={p.student_id}>
                    <button type="button" className="te-personbtn" onClick={() => go(i)}>
                      <span className="te-pname">{p.is_me ? "You" : p.name}</span>
                      <span className={`te-pstate${n === 0 ? " done" : ""}`}>
                        {n === 0 ? <Ic name="check" size={14} /> : `${n} left`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      );
    }

    // The form: one person's page.
    if (!person) return null;
    const isMe = person.is_me;
    const qs = questionsFor(ev.questions, ev.settings, isMe);
    const ro = !editable;
    return (
      <div className="lq-sscroll" ref={scrollRef}>
        <nav className="te-pager" aria-label="People on your team">
          {team.map((p, i) => (
            <button
              key={p.student_id}
              type="button"
              className={`te-pagerdot${i === page ? " on" : ""}${left(p) === 0 ? " done" : ""}`}
              aria-current={i === page ? "page" : undefined}
              onClick={() => go(i)}
            >
              {p.is_me ? "You" : firstName(p.name)}
              {left(p) === 0 ? <Ic name="check" size={12} /> : null}
            </button>
          ))}
        </nav>
        <div className="te-who">
          <h2 className="lq-h2">{isMe ? "You" : person.name}</h2>
        </div>

        {ev.categories.map((c) => (
          <RateBox
            key={c.id}
            category={c}
            value={draft.ratings[person.student_id]?.[c.id]?.score ?? null}
            reason={draft.ratings[person.student_id]?.[c.id]?.reason ?? ""}
            explain={ev.settings.explain_ratings}
            readOnly={ro}
            onScore={(s) => setScore(person.student_id, c.id, s)}
            onReason={(r) => setReason(person.student_id, c.id, r)}
          />
        ))}

        {qs.length ? (
          <section className="lq-scard te-qbox">
            <h3 className="te-boxtitle">{isMe ? "Reflection" : "Comments"}</h3>
            {qs.map((q) => (
              <label key={q.id} className="te-qfield">
                <span>{q.prompt}</span>
                <AutoTextarea
                  className="fv-in te-ta"
                  rows={isMe ? 5 : 3}
                  max={COMMENT_MAX}
                  value={draft.comments[person.student_id]?.[q.id] ?? ""}
                  readOnly={ro}
                  onChange={(v) => setAnswer(person.student_id, q.id, v)}
                />
              </label>
            ))}
          </section>
        ) : null}
      </div>
    );
  };

  // ------------------------------------------------------------ the footer
  /** Where "Overview" and "Done" go: the results once they're out. */
  const home: Screen =
    loaded.kind === "ready" && loaded.results?.released ? "results" : submitted ? "done" : "intro";
  const footer = () => {
    if (!ev || team.length === 0) return null;
    if (screen === "form") {
      const last = page === team.length - 1;
      return (
        <div className="lq-sfoot te-sfoot">
          <button type="button" className="fv-btn outline sm" onClick={() => (page === 0 ? setScreen(home) : go(page - 1))}>
            <Ic name="chevronLeft" size={14} /> {page === 0 ? "Overview" : firstName(team[page - 1].is_me ? "You" : team[page - 1].name)}
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
            <button type="button" className="fv-btn primary sm" onClick={() => go(page + 1)}>
              {firstName(team[page + 1].name)} <Ic name="chevronRight" size={14} />
            </button>
          )}
        </div>
      );
    }
    if (screen === "review") {
      return (
        <div className="lq-sfoot te-sfoot">
          <button type="button" className="fv-btn outline sm" onClick={() => go(team.length - 1)}>
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
            {screen === "form" || screen === "review" ? <span className="lq-sname">{activity.title}</span> : null}
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

// ------------------------------------------------------------- one category

function RateBox({
  category,
  value,
  reason,
  explain,
  readOnly,
  onScore,
  onReason,
}: {
  category: TeamEvalCategory;
  value: number | null;
  reason: string;
  explain: boolean;
  readOnly: boolean;
  onScore: (score: number) => void;
  onReason: (reason: string) => void;
}) {
  return (
    <section className="lq-scard te-sbox">
      <h3 className="te-boxtitle">{category.name}</h3>
      <div className="te-opts" role="radiogroup" aria-label={category.name}>
        {SCALE.map((score) => {
          const on = value === score;
          return (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={on}
              className={`te-opt${on ? " on" : ""}`}
              disabled={readOnly && !on}
              onClick={() => !readOnly && onScore(score)}
            >
              <span className="te-radio" aria-hidden="true" />
              <span className={`te-score s${score}`}>{score}</span>
              <span className="te-desc">{category.levels[score - 1] || <span className="fv-sub">—</span>}</span>
            </button>
          );
        })}
      </div>
      {explain ? (
        <AutoTextarea
          className="fv-in te-ta te-why"
          rows={2}
          max={REASON_MAX}
          value={reason}
          readOnly={readOnly}
          aria-label={`${category.name}: why`}
          placeholder={value === null ? "Why?" : `Why ${value}?`}
          onChange={onReason}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- results

function Results({ ev, results, title }: { ev: StudentTeamEval; results: TeamEvalResults; title: string }) {
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

  return (
    <>
      <div className="te-who">
        <h2 className="lq-h2">{title}</h2>
        <p className="fv-sub">
          Rated by {raters} of {teammates} teammate{teammates === 1 ? "" : "s"}
        </p>
      </div>

      {ev.categories.map((c) => {
        const r = byCat.get(c.id);
        const self = r?.self ?? null;
        const avg = r?.average ?? null;
        const avgRow = avg === null ? null : Math.min(5, Math.max(1, Math.round(avg)));
        return (
          <section key={c.id} className="lq-scard te-sbox">
            <h3 className="te-boxtitle">{c.name}</h3>
            <div className="te-rgrid" role="table" aria-label={c.name}>
              <div className="te-rcolhead" role="row">
                <span role="columnheader">You</span>
                <span role="columnheader">Teammates</span>
                <span role="columnheader" />
              </div>
              {SCALE.map((score) => (
                <div key={score} className={`te-rrow${self === score || avgRow === score ? " hit" : ""}`} role="row">
                  <span className="te-rcell" role="cell">
                    {self === score ? <span className="te-dot self" aria-label="You" /> : null}
                  </span>
                  <span className="te-rcell" role="cell">
                    {avgRow === score ? (
                      <span className="te-avgtag">
                        {fmtAvg(avg)}
                      </span>
                    ) : null}
                  </span>
                  <span className="te-rdesc" role="cell">
                    <span className={`te-score s${score}`}>{score}</span>
                    <span>{c.levels[score - 1] || "—"}</span>
                  </span>
                </div>
              ))}
            </div>
            {r?.reasons.length ? (
              <div className="te-reasons">
                <span className="fv-eyebrow">Why</span>
                <ul>
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
              </div>
            ) : null}
          </section>
        );
      })}

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
