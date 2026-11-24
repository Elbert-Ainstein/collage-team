"use client";

// One grader's sheet for one team: who's grading, then every category of the
// rubric — what a 5 down to a 1 looks like, pick one, and say why. Reasons
// given before in the same category are offered underneath, so a grader who
// wrote "7 parts, cool pulley that actuates" for one team can use it again for
// the next. It saves as they go. "Mark done" needs a name, a score and a
// reason in every category (0059 checks too); once done the sheet is locked
// until it's reopened.
//
// What's on screen is this sheet's own copy. The project around it re-reads
// whenever anyone writes, but a reason half-typed here is never replaced by
// the server's older copy of it: every edit is saved from here, in order, per
// category, and the parent is handed each saved row.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TeamWithMembers } from "@/checkins/types";
import { AutoTextarea } from "@/teameval/AutoTextarea";
import { clearGrading, saveGraderName, saveScore, setGradingDone } from "@/projects/data";
import {
  earlierReasons,
  gradingOf,
  leftText,
  nothingLeft,
  outOf,
  scoresOf,
  whatsLeft,
  type Draft,
} from "@/projects/model";
import {
  REASON_MAX,
  type GradingKey,
  type ProjectCategory,
  type ProjectGrading,
  type ProjectScore,
  type ProjectSnapshot,
} from "@/projects/types";
import { ConfirmDialog } from "../ConfirmDialog";
import type { FacultyData } from "../FacultyApp";
import { FIcon } from "../icons";
import { TopBar } from "./TopBar";

/** Best first, left to right, the way the rubric is read. */
const SCORES = [5, 4, 3, 2, 1] as const;
const TYPING_MS = 700;
const NAME_MAX = 120;

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

const same = (a: Draft | undefined, b: Draft | undefined) =>
  (a?.score ?? null) === (b?.score ?? null) && (a?.reason ?? "") === (b?.reason ?? "");

const draftsFrom = (rows: ProjectScore[]) =>
  new Map<string, Draft>(rows.map((r) => [r.category_id, { score: r.score, reason: r.reason }]));

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function GradingSheet({
  data,
  snap,
  team,
  slot,
  me,
  canGrade,
  onBack,
  onGrading,
  onScore,
  onError,
}: {
  data: FacultyData;
  snap: ProjectSnapshot;
  team: TeamWithMembers;
  slot: number;
  me: string;
  canGrade: boolean;
  onBack: () => void;
  /** A grading row saved — or, with null, thrown away. */
  onGrading: (row: ProjectGrading | null, key?: { team_id: string; slot: number }) => void;
  onScore: (row: ProjectScore) => void;
  onError: (e: unknown) => void;
}) {
  const { categories } = snap;
  const key: GradingKey = useMemo(
    () => ({ projectId: snap.project.id, teamId: team.id, slot }),
    [snap.project.id, team.id, slot],
  );
  const grading = gradingOf(snap.gradings, team.id, slot);
  const done = Boolean(grading?.done_at);
  const readOnly = !canGrade || done;

  // ----------------------------------------------------- this sheet's copy
  const initialScores = useRef(scoresOf(snap.scores, team.id, slot));
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => draftsFrom(initialScores.current));
  const [name, setName] = useState(() => grading?.grader_name || (canGrade ? me : ""));
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const nameRef = useRef(name);
  nameRef.current = name;
  /** What the database last said, per category, and for the name. */
  const saved = useRef(draftsFrom(initialScores.current));
  const savedName = useRef(grading?.grader_name ?? "");
  /** Whether the grading row exists yet. */
  const opened = useRef(Boolean(grading));

  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [busy, setBusy] = useState<"done" | "reopen" | "clear" | null>(null);
  const [tried, setTried] = useState(false);
  const [asking, setAsking] = useState(false);

  // ------------------------------------------------------------- saving
  /** One queue per category (and one for the name), so writes land in order. */
  const chains = useRef(new Map<string, Promise<void>>());
  const inFlight = useRef(0);
  const timers = useRef(new Map<string, { t: ReturnType<typeof setTimeout>; run: () => void }>());

  const enqueue = useCallback((lane: string, job: () => Promise<void>): Promise<void> => {
    const next = (chains.current.get(lane) ?? Promise.resolve()).then(async () => {
      inFlight.current += 1;
      setSave({ kind: "saving" });
      try {
        await job();
        if (inFlight.current === 1) setSave({ kind: "saved" });
      } catch (e) {
        setSave({ kind: "failed", message: e instanceof Error ? e.message : "That didn't save." });
      } finally {
        inFlight.current -= 1;
      }
    });
    chains.current.set(lane, next);
    return next;
  }, []);

  const writeName = useCallback(async () => {
    const want = nameRef.current.trim();
    if (want === savedName.current) return;
    const row = await saveGraderName(key, want);
    savedName.current = row.grader_name;
    opened.current = true;
    onGrading(row);
  }, [key, onGrading]);

  const saveName = useCallback(() => enqueue("name", writeName), [enqueue, writeName]);

  const saveCategory = useCallback(
    (categoryId: string) =>
      enqueue(categoryId, async () => {
        const d = draftsRef.current.get(categoryId) ?? { score: null, reason: "" };
        if (same(d, saved.current.get(categoryId))) return;
        // The name goes first, so a grading never shows up on other phones as
        // somebody nameless.
        if (nameRef.current.trim() && nameRef.current.trim() !== savedName.current) await writeName();
        const row = await saveScore(key, categoryId, d);
        saved.current.set(categoryId, { score: row.score, reason: row.reason });
        opened.current = true;
        onScore(row);
      }),
    [enqueue, key, onScore, writeName],
  );

  const later = (lane: string, run: () => void) => {
    const was = timers.current.get(lane);
    if (was) clearTimeout(was.t);
    const t = setTimeout(() => {
      timers.current.delete(lane);
      run();
    }, TYPING_MS);
    timers.current.set(lane, { t, run });
  };
  const now = (lane: string) => {
    const was = timers.current.get(lane);
    if (!was) return;
    clearTimeout(was.t);
    timers.current.delete(lane);
    was.run();
  };
  const flushAll = () => [...timers.current.keys()].forEach(now);
  const settled = () => Promise.all([...chains.current.values()]);

  // Leaving with something still waiting to be typed out: save it on the way.
  useEffect(
    () => () => {
      for (const { t, run } of timers.current.values()) {
        clearTimeout(t);
        run();
      }
      timers.current.clear();
    },
    [],
  );

  // --------------------------------------------------------------- edits
  // The ref is updated here, synchronously, not inside a state updater: the
  // save queued right after reads it, and React may not have run an updater
  // by then — a second tap would then save what the first one left.
  const setDraft = (categoryId: string, change: Partial<Draft>) => {
    const next = new Map(draftsRef.current);
    const was = next.get(categoryId) ?? { score: null, reason: "" };
    next.set(categoryId, { ...was, ...change });
    draftsRef.current = next;
    setDrafts(next);
  };

  const pick = (categoryId: string, n: number) => {
    if (readOnly) return;
    const was = draftsRef.current.get(categoryId)?.score ?? null;
    // Pressing the picked score again unpicks it: a mis-tap isn't permanent.
    setDraft(categoryId, { score: was === n ? null : n });
    const pending = timers.current.get(categoryId);
    if (pending) {
      clearTimeout(pending.t);
      timers.current.delete(categoryId);
    }
    void saveCategory(categoryId);
  };

  const write = (categoryId: string, reason: string) => {
    if (readOnly) return;
    setDraft(categoryId, { reason });
    later(categoryId, () => void saveCategory(categoryId));
  };

  const reuse = (categoryId: string, reason: string) => {
    if (readOnly) return;
    setDraft(categoryId, { reason });
    const pending = timers.current.get(categoryId);
    if (pending) {
      clearTimeout(pending.t);
      timers.current.delete(categoryId);
    }
    void saveCategory(categoryId);
  };

  const rename = (v: string) => {
    if (readOnly) return;
    setName(v);
    nameRef.current = v;
    // Typing a name saves it, which opens the grading. The name filled in
    // for them isn't saved until their first score: opening a sheet to look
    // isn't a claim on the slot.
    later("name", () => void saveName());
  };

  // ------------------------------------------------------ done, and back
  const left = whatsLeft(categories, drafts, name);
  const ready = nothingLeft(left);
  const unscored = new Set(left.unscored);
  const unexplained = new Set(left.unexplained);

  const markDone = async () => {
    setTried(true);
    if (!ready || busy) return;
    setBusy("done");
    try {
      flushAll();
      await settled();
      // Anything a failed save left behind goes again, before the database
      // is asked to check it.
      if (nameRef.current.trim() !== savedName.current) await saveName();
      for (const c of categories) {
        if (!same(draftsRef.current.get(c.id), saved.current.get(c.id))) await saveCategory(c.id);
      }
      await settled();
      const row = await setGradingDone(key, true);
      onGrading(row);
      setSave({ kind: "saved" });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  };

  const reopen = async () => {
    setBusy("reopen");
    try {
      onGrading(await setGradingDone(key, false));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    setBusy("clear");
    try {
      for (const { t } of timers.current.values()) clearTimeout(t);
      timers.current.clear();
      await settled();
      await clearGrading(key);
      onGrading(null, { team_id: team.id, slot });
      onBack();
    } catch (e) {
      onError(e);
      setBusy(null);
      setAsking(false);
    }
  };

  const back = () => {
    flushAll();
    onBack();
  };

  // ------------------------------------------------------------- names
  const suggestions = useMemo(() => {
    const names = [
      data.instructor ?? "",
      ...data.tfs.map((t) => t.name),
      ...snap.gradings.map((g) => g.grader_name),
    ]
      .map((n) => n.trim())
      .filter(Boolean);
    return [...new Set(names)];
  }, [data.instructor, data.tfs, snap.gradings]);

  const totalNow = [...drafts.values()].reduce((n, d) => n + (d.score ?? 0), 0);
  const leftWords = leftText(left, categories);

  return (
    <div className="fv-panel te-fac pj">
      <TopBar
        onBack={back}
        label={`Back to ${team.name}`}
        title={`${team.name} — Grader ${slot}`}
        sub={team.members.length ? team.members.map((m) => m.name).join(", ") : undefined}
      >
        <SaveNote save={save} />
      </TopBar>

      <div className="fv-scroll pj-sheet">
        {!canGrade ? (
          <div className="pj-note" role="note">
            <FIcon name="assignment" size={15} />
            <span>Grading is turned off for TFs on this course, so this sheet is read-only.</span>
          </div>
        ) : null}

        <label className="pj-namerow">
          <span className="fv-eyebrow">Name</span>
          <input
            className="fv-in pj-namein"
            value={name}
            maxLength={NAME_MAX}
            placeholder="Who's grading?"
            list={`pj-graders-${slot}`}
            disabled={readOnly}
            aria-invalid={tried && left.name}
            onChange={(e) => rename(e.target.value)}
            onBlur={() => now("name")}
          />
          <datalist id={`pj-graders-${slot}`}>
            {suggestions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>

        {categories.length === 0 ? (
          <div className="fv-card pj-empty">
            <div className="pj-emptytitle">No rubric yet</div>
            <p className="fv-sub">The instructor adds the categories to grade on this project&rsquo;s page.</p>
          </div>
        ) : null}

        {categories.map((c) => (
          <CategoryRow
            key={c.id}
            category={c}
            draft={drafts.get(c.id)}
            readOnly={readOnly}
            missingScore={tried && unscored.has(c.id)}
            missingReason={tried && unexplained.has(c.id)}
            earlier={
              readOnly
                ? []
                : earlierReasons(snap.scores, snap.gradings, {
                    categoryId: c.id,
                    teamId: team.id,
                    slot,
                    graderName: name,
                    score: drafts.get(c.id)?.score ?? null,
                    current: drafts.get(c.id)?.reason ?? "",
                  })
            }
            onPick={(n) => pick(c.id, n)}
            onWrite={(v) => write(c.id, v)}
            onBlur={() => now(c.id)}
            onReuse={(r) => reuse(c.id, r)}
          />
        ))}
      </div>

      {categories.length ? (
        <div className="pj-sheetfoot">
          <span className="pj-running">
            <b>{totalNow}</b> / {outOf(categories)}
          </span>
          {done ? (
            <span className="pj-doneword">
              <span className="pj-dot done" aria-hidden="true" /> Done{grading?.done_at ? ` at ${fmtTime(grading.done_at)}` : ""}
            </span>
          ) : (
            <span className={`pj-left${tried && !ready ? " warn" : ""}`} aria-live="polite">
              {leftWords ?? "Every category is scored and explained."}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {canGrade && !done && grading ? (
            <button type="button" className="fv-btn ghost sm" disabled={busy !== null} onClick={() => setAsking(true)}>
              Clear
            </button>
          ) : null}
          {canGrade ? (
            done ? (
              <button type="button" className="fv-btn outline sm" disabled={busy !== null} onClick={() => void reopen()}>
                {busy === "reopen" ? "Reopening…" : "Reopen to edit"}
              </button>
            ) : (
              <button
                type="button"
                // Dimmed, not disabled, until it's ready: pressing it early is
                // how a grader finds out what's still missing.
                className={`fv-btn primary sm pj-donebtn${ready ? "" : " notready"}`}
                disabled={busy !== null}
                onClick={() => void markDone()}
              >
                <FIcon name="check" size={15} /> {busy === "done" ? "Saving…" : "Mark done"}
              </button>
            )
          ) : null}
        </div>
      ) : null}

      {asking ? (
        <ConfirmDialog
          title={`Clear Grader ${slot}'s grading of ${team.name}?`}
          body="Every score and reason on this sheet goes. This can't be undone."
          confirmLabel="Clear grading"
          busy={busy === "clear"}
          busyLabel="Clearing…"
          onConfirm={() => void discard()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </div>
  );
}

function SaveNote({ save }: { save: SaveState }) {
  if (save.kind === "idle") return null;
  return (
    <span
      className={`fv-sub pj-save${save.kind === "failed" ? " failed" : ""}`}
      role="status"
      title={save.kind === "failed" ? save.message : undefined}
    >
      {save.kind === "saving" ? "Saving…" : save.kind === "saved" ? "Saved" : `Not saved — ${save.message}`}
    </span>
  );
}

/** One category: what each score means, which one, and why. */
function CategoryRow({
  category,
  draft,
  readOnly,
  missingScore,
  missingReason,
  earlier,
  onPick,
  onWrite,
  onBlur,
  onReuse,
}: {
  category: ProjectCategory;
  draft: Draft | undefined;
  readOnly: boolean;
  missingScore: boolean;
  missingReason: boolean;
  earlier: { reason: string; score: number | null; mine: boolean }[];
  onPick: (n: number) => void;
  onWrite: (v: string) => void;
  onBlur: () => void;
  onReuse: (reason: string) => void;
}) {
  const score = draft?.score ?? null;
  const reason = draft?.reason ?? "";
  const id = `pj-why-${category.id}`;
  return (
    <section className={`fv-card pj-cat${missingScore || missingReason ? " missing" : ""}`} aria-label={category.name}>
      <h3 className="pj-catname">{category.name}</h3>
      <div className="pj-opts" role="radiogroup" aria-label={`${category.name} score`}>
        {SCORES.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            className={`pj-opt s${n}${score === n ? " on" : ""}`}
            disabled={readOnly && score !== n}
            onClick={() => onPick(n)}
          >
            <span className={`te-score s${n}`}>{n}</span>
            <span className="pj-optdesc">{category.levels[n - 1] || "—"}</span>
          </button>
        ))}
      </div>
      {missingScore ? <p className="pj-miss">Pick a score.</p> : null}

      <label className="pj-whylabel" htmlFor={id}>
        Why{score ? ` a ${score}` : ""}?
      </label>
      {readOnly ? (
        <p className="pj-whyread">{reason.trim() || "—"}</p>
      ) : (
        <AutoTextarea
          id={id}
          className="fv-in pj-whyin"
          rows={2}
          max={REASON_MAX}
          value={reason}
          placeholder="What you saw that earned this score"
          aria-invalid={missingReason}
          onChange={onWrite}
          onBlur={onBlur}
        />
      )}
      {missingReason ? <p className="pj-miss">Say why before marking it done.</p> : null}

      {earlier.length ? (
        <div className="pj-earlier">
          <span className="pj-earlierlbl">Used before</span>
          {earlier.map((e) => (
            <button
              key={e.reason}
              type="button"
              className={`pj-reuse${e.mine ? " mine" : ""}`}
              title={`${e.mine ? "You gave" : "Given"}${e.score ? ` with a ${e.score}` : ""}: ${e.reason}`}
              onClick={() => onReuse(e.reason)}
            >
              {e.score ? <span className={`pj-reusescore s${e.score}`}>{e.score}</span> : null}
              <span className="pj-reusetext">{e.reason}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
