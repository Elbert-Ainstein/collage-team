"use client";

// One grader's sheet for one team: who's grading, then every category of the
// rubric — what a 5 down to a 1 looks like, pick one, and say why. Reasons
// given before in the same category are offered underneath, so a grader who
// wrote "7 parts, cool pulley that actuates" for one team can use it again for
// the next. It saves as they go. "Mark done" needs a name, a score and a
// reason in every category (0059 checks too); once done the sheet is locked
// until it's reopened.
//
// What's on screen is this sheet's own copy, saved from here in order, per
// category. The project around it re-reads whenever anyone writes, and the
// copy takes those changes in — except where this grader has something of
// their own not yet saved, which wins until it is. A read-only sheet simply
// shows what's saved. If someone else starts writing to the same slot (two
// graders both took "Grader 1"), the sheet says so and offers a free one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TeamWithMembers } from "@/checkins/types";
import { AutoTextarea } from "@/teameval/AutoTextarea";
import { clearGrading, saveGraderName, saveScore, setGradingDone } from "@/projects/data";
import {
  earlierReasons,
  gradingOf,
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

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

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
  onTeams,
  onSlot,
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
  /** Straight to the project's team list: where a grader goes next once done. */
  onTeams: () => void;
  /** Open another slot on this team. */
  onSlot: (slot: number) => void;
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

  /** What's saved for this grading, as the project last read it. */
  const serverRows = useMemo(() => scoresOf(snap.scores, team.id, slot), [snap.scores, team.id, slot]);

  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [busy, setBusy] = useState<"done" | "reopen" | "clear" | null>(null);
  const [tried, setTried] = useState(false);
  const [asking, setAsking] = useState(false);

  // ------------------------------------------------------------- saving
  /** One queue per category (and one for the name), so writes land in order. */
  const chains = useRef(new Map<string, Promise<void>>());
  const inFlight = useRef(0);
  const timers = useRef(new Map<string, { t: ReturnType<typeof setTimeout>; run: () => void }>());
  /**
   * Lanes whose last save failed. They stay "Not saved" until a save of that
   * same lane works — a later success somewhere else says nothing about them —
   * and they're tried again on the next edit, on Retry, on leaving, and
   * before Mark done.
   */
  const failed = useRef(new Set<string>());
  const lastError = useRef("That didn't save.");

  const report = useCallback(() => {
    if (failed.current.size) setSave({ kind: "failed", message: lastError.current });
    else if (inFlight.current > 0) setSave({ kind: "saving" });
    else setSave({ kind: "saved" });
  }, []);

  const enqueue = useCallback(
    (lane: string, job: () => Promise<void>): Promise<void> => {
      const next = (chains.current.get(lane) ?? Promise.resolve()).then(async () => {
        inFlight.current += 1;
        report();
        try {
          await job();
          failed.current.delete(lane);
        } catch (e) {
          failed.current.add(lane);
          lastError.current = e instanceof Error ? e.message : "That didn't save.";
        } finally {
          inFlight.current -= 1;
          report();
        }
      });
      chains.current.set(lane, next);
      return next;
    },
    [report],
  );

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
  /** Try every failed lane again. */
  const retryFailed = useCallback(() => {
    for (const lane of [...failed.current]) {
      if (timers.current.has(lane)) continue;
      void (lane === "name" ? saveName() : saveCategory(lane));
    }
  }, [saveName, saveCategory]);
  const retryRef = useRef(retryFailed);
  retryRef.current = retryFailed;

  // Leaving with something still waiting to be typed out, or not yet saved:
  // save it on the way.
  useEffect(
    () => () => {
      for (const { t, run } of timers.current.values()) {
        clearTimeout(t);
        run();
      }
      timers.current.clear();
      retryRef.current();
    },
    [],
  );

  // ---------------------------------------------- what others have written
  // Take in what's saved for each category this grader has nothing unsaved
  // in — someone grading the same slot elsewhere, or this grader on another
  // device. A category with an edit still on its way keeps the edit.
  useEffect(() => {
    let next: Map<string, Draft> | null = null;
    for (const row of serverRows) {
      const server = { score: row.score, reason: row.reason };
      const was = saved.current.get(row.category_id);
      if (same(server, was)) continue;
      const mine = draftsRef.current.get(row.category_id);
      if (!same(mine, was) || timers.current.has(row.category_id) || failed.current.has(row.category_id)) continue;
      saved.current.set(row.category_id, server);
      next ??= new Map(draftsRef.current);
      next.set(row.category_id, server);
    }
    if (next) {
      draftsRef.current = next;
      setDrafts(next);
    }
  }, [serverRows]);

  /**
   * Somebody else has put their name on this slot since this sheet last saved
   * or loaded it: two graders on one slot write over each other. A name that
   * matches this sheet's is the same person, and isn't anyone else.
   */
  const serverName = grading?.grader_name ?? "";
  const clash =
    canGrade &&
    !done &&
    norm(serverName) !== "" &&
    norm(serverName) !== norm(savedName.current) &&
    norm(serverName) !== norm(name);
  const freeSlot = useMemo(() => {
    const used = new Set(snap.gradings.filter((g) => g.team_id === team.id).map((g) => g.slot));
    let n = 1;
    while (used.has(n) || n === slot) n += 1;
    return n;
  }, [snap.gradings, team.id, slot]);

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
    retryFailed();
  };

  const write = (categoryId: string, reason: string) => {
    if (readOnly) return;
    setDraft(categoryId, { reason });
    later(categoryId, () => void saveCategory(categoryId));
    retryFailed();
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
    retryFailed();
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

  /** Bring the first thing still missing into view, and into focus. */
  const showMissing = () => {
    const c = categories.find((x) => unscored.has(x.id) || unexplained.has(x.id));
    const target = left.name ? "pj-name" : c ? `pj-cat-${c.id}` : null;
    const el = target ? document.getElementById(target) : null;
    if (!el) return;
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    const field = left.name ? el : c && unexplained.has(c.id) ? document.getElementById(`pj-why-${c.id}`) : null;
    (field as HTMLElement | null)?.focus({ preventScroll: true });
  };

  const markDone = async () => {
    setTried(true);
    if (!ready) {
      // Pressing it early is how a grader finds out what's missing: take them
      // to it rather than describe it.
      showMissing();
      return;
    }
    if (busy || clash) return;
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
      // Still not saved: say why, rather than let the database refuse the
      // done for a reason that isn't the real one.
      if (failed.current.size) throw new Error(`Some of this sheet isn't saved: ${lastError.current}`);
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
    retryFailed();
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

  // A read-only sheet has nothing of its own to keep: it shows what's saved.
  const shown = readOnly ? draftsFrom(serverRows) : drafts;
  const totalNow = [...shown.values()].reduce((n, d) => n + (d.score ?? 0), 0);
  const complete = categories.length - left.unscored.length - left.unexplained.length;

  return (
    <div className="fv-panel te-fac pj">
      <TopBar
        onBack={back}
        label={`Back to ${team.name}`}
        title={`${team.name} — Grader ${slot}`}
        sub={team.members.length ? team.members.map((m) => m.name).join(", ") : undefined}
      >
        <SaveNote save={save} onRetry={retryFailed} />
        {/* Up here, away from Mark done: it throws the sheet away. */}
        {canGrade && !done && grading ? (
          <button type="button" className="fv-btn ghost sm" disabled={busy !== null} onClick={() => setAsking(true)}>
            Clear
          </button>
        ) : null}
      </TopBar>

      <div className="fv-scroll pj-sheet">
        {!canGrade ? (
          <div className="pj-note" role="note">
            <FIcon name="assignment" size={15} />
            <span>Grading is turned off for TFs on this course, so this sheet is read-only.</span>
          </div>
        ) : null}

        {readOnly ? (
          // Nothing to type into: the name is a fact about the sheet.
          <div className="pj-namerow">
            <span className="fv-eyebrow">Graded by</span>
            <span className="pj-nameread">{(readOnly ? serverName : name).trim() || "—"}</span>
          </div>
        ) : (
        <label className="pj-namerow">
          <span className="fv-eyebrow">Graded by</span>
          <input
            id="pj-name"
            className="fv-in pj-namein"
            value={name}
            maxLength={NAME_MAX}
            placeholder="Who's grading?"
            list={`pj-graders-${slot}`}
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
        )}

        {clash ? (
          <div className="pj-note pj-clash" role="alert">
            <span>
              <strong>{serverName.trim()}</strong> is grading this slot too, so you&rsquo;d write over each
              other. Take another one.
            </span>
            <button type="button" className="fv-btn primary sm" onClick={() => onSlot(freeSlot)}>
              Use Grader {freeSlot}
            </button>
          </div>
        ) : null}

        {categories.length === 0 ? (
          <div className="fv-card pj-empty">
            <div className="pj-emptytitle">No rubric yet</div>
            <p className="fv-sub">The instructor adds the categories to grade on this project&rsquo;s page.</p>
          </div>
        ) : null}

        {categories.length ? (
        <div className="fv-card pj-rubric">
        {categories.map((c) => (
          <CategoryRow
            key={c.id}
            category={c}
            draft={shown.get(c.id)}
            readOnly={readOnly}
            missingScore={tried && unscored.has(c.id)}
            missingReason={tried && unexplained.has(c.id)}
            suggestion={
              readOnly
                ? null
                : (earlierReasons(snap.scores, snap.gradings, {
                    categoryId: c.id,
                    teamId: team.id,
                    slot,
                    graderName: name,
                    score: drafts.get(c.id)?.score ?? null,
                    current: drafts.get(c.id)?.reason ?? "",
                    limit: 1,
                  })[0]?.reason ?? null)
            }
            onPick={(n) => pick(c.id, n)}
            onWrite={(v) => write(c.id, v)}
            onBlur={() => now(c.id)}
            onReuse={(r) => reuse(c.id, r)}
          />
        ))}
        </div>
        ) : null}
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
              {complete} of {categories.length} {categories.length === 1 ? "category" : "categories"} complete
              {left.name ? " · add your name" : ""}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {canGrade ? (
            done ? (
              <>
                <button type="button" className="fv-btn outline sm" disabled={busy !== null} onClick={() => void reopen()}>
                  {busy === "reopen" ? "Opening…" : "Edit"}
                </button>
                {/* The next team is two backs away otherwise, and at a fair
                    the next team is the whole point of being done. */}
                <button type="button" className="fv-btn primary sm" disabled={busy !== null} onClick={onTeams}>
                  Back to teams
                </button>
              </>
            ) : (
              <button
                type="button"
                // Dimmed, not disabled, until it's ready: pressing it early is
                // how a grader finds out what's still missing.
                className={`fv-btn primary sm pj-donebtn${ready && !clash ? "" : " notready"}`}
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

function SaveNote({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  if (save.kind === "idle") return null;
  if (save.kind === "failed") {
    return (
      <span className="fv-sub pj-save failed" role="alert" title={save.message}>
        Not saved{" "}
        <button type="button" className="pj-retry" onClick={onRetry}>
          Retry
        </button>
      </span>
    );
  }
  return (
    <span className="fv-sub pj-save" role="status">
      {save.kind === "saving" ? "Saving…" : "Saved"}
    </span>
  );
}

/**
 * One category: a row of scores, 5 to 1, what the picked one means, and why.
 * Each score's meaning is on the button too (its label and tooltip), so it's
 * there for anyone who wants it before they pick without filling the page.
 */
function CategoryRow({
  category,
  draft,
  readOnly,
  missingScore,
  missingReason,
  suggestion,
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
  /** A reason given before in this category, to use again. */
  suggestion: string | null;
  onPick: (n: number) => void;
  onWrite: (v: string) => void;
  onBlur: () => void;
  onReuse: (reason: string) => void;
}) {
  const score = draft?.score ?? null;
  const reason = draft?.reason ?? "";
  const meaning = score ? (category.levels[score - 1] ?? "").trim() : "";
  return (
    <section
      id={`pj-cat-${category.id}`}
      className={`pj-cat${missingScore || missingReason ? " missing" : ""}`}
      aria-label={category.name}
    >
      <div className="pj-cathead">
        <h3 className="pj-catname">{category.name}</h3>
        <div className="pj-opts" role="radiogroup" aria-label={`${category.name} score`}>
          {SCORES.map((n) => {
            const says = (category.levels[n - 1] ?? "").trim();
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={score === n}
                aria-label={says ? `${n}: ${says}` : String(n)}
                title={says || undefined}
                className={`pj-opt s${n}${score === n ? " on" : ""}`}
                disabled={readOnly && score !== n}
                onClick={() => onPick(n)}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
      {meaning ? <p className="pj-meaning">{meaning}</p> : null}
      {missingScore ? <p className="pj-miss">Pick a score.</p> : null}

      {readOnly ? (
        reason.trim() ? <p className="pj-whyread">{reason}</p> : null
      ) : (
        <AutoTextarea
          id={`pj-why-${category.id}`}
          className="fv-in pj-whyin"
          rows={1}
          max={REASON_MAX}
          value={reason}
          placeholder={score ? `Why a ${score}?` : "Why?"}
          aria-label={`Why ${category.name} ${score ? `got a ${score}` : "got its score"}`}
          aria-invalid={missingReason}
          onChange={onWrite}
          onBlur={onBlur}
        />
      )}
      {missingReason ? <p className="pj-miss">Say why before marking it done.</p> : null}

      {/* A reason given before, while the box is empty: one tap to use it. */}
      {!readOnly && !reason.trim() && suggestion ? (
        <button type="button" className="pj-reuse" title={suggestion} onClick={() => onReuse(suggestion)}>
          <span className="pj-reuselbl">Reuse:</span>
          <span className="pj-reusetext">{suggestion}</span>
        </button>
      ) : null}
    </section>
  );
}
