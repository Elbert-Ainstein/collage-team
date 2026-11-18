"use client";

// A team evaluation, from the student's side.
//
// Filling it in goes a person at a time: a page for each teammate — every
// category, each with what a 5 down to a 1 means, then the questions about
// them — and last a page for themselves, with their reflection. Then a
// review. It saves as they go (save_team_eval, as a draft) and Submit checks
// it's complete.
//
// Once the instructor releases results: every category on one 1–5 line —
// what they gave themselves and the average of what their teammates gave
// them (themselves and anyone who didn't submit left out) — and what
// teammates wrote, without names when it's anonymous.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Assignment, Enrolment } from "@/checkins/studentData";
import { BriefText } from "@/checkins/BriefText";
import { loadMyTeamEvalResults, loadStudentTeamEval, saveMyTeamEval } from "@/teameval/data";
import { draftFrom, draftPayload, fmtAvg, leftFor, pagesFor, questionsFor, type EvalDraft } from "@/teameval/model";
import { AutoTextarea } from "@/teameval/AutoTextarea";
import { ScoreTrack } from "@/teameval/ScoreTrack";
import { COMMENT_MAX, type StudentTeamEval, type TeamEvalCategory, type TeamEvalMember, type TeamEvalResults } from "@/teameval/types";
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

type Screen = "intro" | "page" | "review" | "done" | "results";
type SaveState = "idle" | "saving" | "saved" | "failed";

const AUTOSAVE_MS = 1200;
/** Best first: people read down from what a 5 looks like. */
const SCORES = [5, 4, 3, 2, 1] as const;

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

const pageName = (p: TeamEvalMember) => (p.is_me ? "Yourself" : p.name);

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
  /** A page per teammate, then themselves. */
  const pages = useMemo(() => pagesFor(team), [team]);
  const left = useMemo(() => (ev ? pages.map((p) => leftFor(p, ev, draft)) : []), [pages, draft, ev]);
  const totalLeft = left.reduce((a, b) => a + b, 0);
  const donePages = left.filter((n) => n === 0).length;
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
    change((d) => ({ ...d, ratings: { ...d.ratings, [ratee]: { ...d.ratings[ratee], [category]: score } } }));
  const setAnswer = (subject: string, question: string, body: string) =>
    change((d) => ({ ...d, comments: { ...d.comments, [subject]: { ...d.comments[subject], [question]: body } } }));

  const go = (next: number | "review") => {
    if (next === "review") setScreen("review");
    else {
      setAt(next);
      setScreen("page");
    }
    scrollRef.current?.scrollTo({ top: 0 });
  };
  /** Where Continue picks up: the first person with something left. */
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
                <div className="te-progressline">
                  <div className="te-progress" aria-hidden="true">
                    <span style={{ width: `${pages.length ? (100 * donePages) / pages.length : 0}%` }} />
                  </div>
                  <span className="fv-sub">
                    {donePages} of {pages.length} done
                  </span>
                </div>
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
              {pages.map((p, i) => (
                <li key={p.student_id}>
                  <button type="button" className="te-personbtn" onClick={() => go(i)}>
                    <span className="te-pname">{pageName(p)}</span>
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

    // One person.
    const person = pages[at];
    if (!person) return null;
    const ro = !editable;
    const qs = questionsFor(ev.questions, ev.settings, person.is_me);
    return (
      <div className="lq-sscroll" ref={scrollRef}>
        <div className="te-stephead">
          <div className="te-progress" aria-hidden="true">
            <span style={{ width: `${(100 * (at + 1)) / pages.length}%` }} />
          </div>
          <span className="fv-sub">
            {at + 1} of {pages.length}
          </span>
        </div>

        <h2 className="lq-h2 te-steptitle">{person.is_me ? "Yourself" : person.name}</h2>

        {ev.categories.map((c) => (
          <CategoryCard
            key={c.id}
            category={c}
            who={person.is_me ? "yourself" : person.name}
            value={draft.ratings[person.student_id]?.[c.id] ?? null}
            readOnly={ro}
            onScore={(n) => setScore(person.student_id, c.id, n)}
          />
        ))}

        {qs.length ? (
          <section className={`lq-scard te-qbox${person.is_me ? " te-mine" : ""}`}>
            {person.is_me ? <h3 className="te-boxtitle">Reflection</h3> : null}
            {qs.map((q) => (
              <label key={q.id} className="te-qfield">
                <span>{q.prompt}</span>
                <AutoTextarea
                  className="fv-in te-ta"
                  rows={person.is_me ? 5 : 3}
                  max={COMMENT_MAX}
                  value={draft.comments[person.student_id]?.[q.id] ?? ""}
                  readOnly={ro}
                  onChange={(v) => setAnswer(person.student_id, q.id, v)}
                />
              </label>
            ))}
            {!person.is_me ? <p className="fv-sub te-privacy">{privacyNote(ev)}</p> : null}
          </section>
        ) : null}
      </div>
    );
  };

  // ------------------------------------------------------------ the footer
  const footer = () => {
    if (!ev || team.length === 0) return null;
    if (screen === "page") {
      const last = at === pages.length - 1;
      return (
        <div className="lq-sfoot te-sfoot">
          <button type="button" className="fv-btn outline sm" onClick={() => (at === 0 ? setScreen(home) : go(at - 1))}>
            <Ic name="chevronLeft" size={14} /> {at === 0 ? "Overview" : pageName(pages[at - 1])}
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
              {pageName(pages[at + 1])} <Ic name="chevronRight" size={14} />
            </button>
          )}
        </div>
      );
    }
    if (screen === "review") {
      return (
        <div className="lq-sfoot te-sfoot">
          <button type="button" className="fv-btn outline sm" onClick={() => go(pages.length - 1)}>
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
            {screen === "page" || screen === "review" ? <span className="lq-sname">{activity.title}</span> : null}
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

/** One category for one person: what each score means, and pick one. */
function CategoryCard({
  category,
  who,
  value,
  readOnly,
  onScore,
}: {
  category: TeamEvalCategory;
  who: string;
  value: number | null;
  readOnly: boolean;
  onScore: (n: number) => void;
}) {
  return (
    <section className="lq-scard te-catcard">
      <h3 className="te-catname">{category.name}</h3>
      <div className="te-opts" role="radiogroup" aria-label={`${category.name}: ${who}`}>
        {SCORES.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            className={`te-opt s${n}${value === n ? " on" : ""}`}
            disabled={readOnly && value !== n}
            onClick={() => !readOnly && onScore(n)}
          >
            <span className={`te-score s${n}`}>{n}</span>
            <span className="te-optdesc">{category.levels[n - 1] || "—"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- results

function Results({ ev, results, title }: { ev: StudentTeamEval; results: TeamEvalResults; title: string }) {
  const byCat = new Map((results.categories ?? []).map((c) => [c.category_id, c]));
  const prompts = new Map(ev.questions.map((q) => [q.id, q.prompt]));
  const comments = results.comments ?? [];
  const byQuestion = new Map<string, { author: string | null; body: string }[]>();
  for (const c of comments) byQuestion.set(c.question_id, [...(byQuestion.get(c.question_id) ?? []), c]);
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

      <section className="lq-scard te-summary">
        <p className="fv-sub te-legend">
          <span className="te-key-dot team" /> Teammates <span className="te-key-dot self" /> You
        </p>
        {ev.categories.map((c) => {
          const r = byCat.get(c.id);
          const self = r?.self ?? null;
          const avg = r?.average ?? null;
          return (
            <div key={c.id} className="te-sumrow">
              <div className="te-sumhead">
                <span className="te-sumname">{c.name}</span>
                <ScoreTrack team={avg} self={self} label={`${c.name}: teammates ${fmtAvg(avg)}, you ${self ?? "—"}`} />
                <span className="te-sumnums">
                  <b>{fmtAvg(avg)}</b>
                  <span className="fv-sub"> · you {self ?? "—"}</span>
                </span>
              </div>
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
