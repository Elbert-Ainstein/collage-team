"use client";

// One question in "Questions & grading": multiple choice, a number, or an
// expression. The two free-response kinds carry a key that is checked without
// AI — a number by arithmetic against a tolerance, an expression by algebra
// against the accepted forms (src/live/answers.ts).
//
// `locked` is team mode or later: 0047 freezes what a question IS once teams
// have voted on it — its kind and its options — but the wording, the image and
// the key can still change, so a wrong key can be fixed and the session
// re-scored.

import { useRef, useState } from "react";
import { normalizeNumber, optionLetter } from "@/live/answers";
import { Figure, uploadFigure } from "@/live/figure";
import { Ic } from "@/live/ui";
import { keyLabel, MAX_OPTIONS, type DraftQuestion } from "./draft";
import type { LiveKind } from "@/live/types";

/** 1.1 − 0.05 without the floating-point tail. */
const tidy = (x: number): string => String(Number(x.toPrecision(6)));

const KINDS: [LiveKind, string][] = [
  ["mc", "Multiple choice"],
  ["number", "Number"],
  ["expression", "Expression"],
];

interface Props {
  q: DraftQuestion;
  n: number;
  activityId: string;
  onlyOne: boolean;
  locked: boolean;
  onChange: (next: DraftQuestion) => void;
  /** A change that lands later (an upload), merged into the question as it is then. */
  onPatch: (change: Partial<DraftQuestion>) => void;
  onRemove: () => void;
  onError: (e: unknown) => void;
}

export function DraftQuestionCard({ q, n, activityId, onlyOne, locked, onChange, onPatch, onRemove, onError }: Props) {
  const [adding, setAdding] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const src = q.source;
  /** Setting a key yourself settles a question the import left open. */
  const settle = (patch: Partial<DraftQuestion>) =>
    onChange({ ...q, ...patch, source: src ? { ...src, needsPick: false } : undefined });
  const setOption = (i: number, text: string) => onChange({ ...q, options: q.options.map((o, j) => (j === i ? text : o)) });
  const removeOption = (i: number) =>
    onChange({
      ...q,
      options: q.options.filter((_, j) => j !== i),
      correct: q.correct === null || q.correct === i ? null : q.correct > i ? q.correct - 1 : q.correct,
    });
  const addAccepted = () => {
    const v = adding.trim();
    if (!v || q.accept.includes(v)) return;
    settle({ accept: [...q.accept, v] });
    setAdding("");
  };
  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      onPatch({ figure_path: await uploadFigure(activityId, q.id, file) });
    } catch (e) {
      onError(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const pick = !!src?.needsPick;
  const key = keyLabel(q);
  const answer = normalizeNumber(q.answer);
  const tol = q.tolerance.trim() ? normalizeNumber(q.tolerance) : "0";

  return (
    <article className={`fv-card lq-bq${pick ? " attention" : ""}`}>
      <div className="lq-bqsrc">
        {locked ? (
          <span className="fv-sub">{KINDS.find(([k]) => k === q.kind)?.[1]}</span>
        ) : (
          <div className="fv-seg lq-kindseg" role="group" aria-label={`Question ${n} type`}>
            {KINDS.map(([k, label]) => (
              <button key={k} type="button" className={q.kind === k ? "on" : ""} onClick={() => onChange({ ...q, kind: k })}>
                {label}
              </button>
            ))}
          </div>
        )}
        {pick ? <span className="lq-srcstate pick">Needs an answer</span> : null}
        {src ? <span className="fv-sub lq-srcpage">p.{src.page}</span> : null}
      </div>

      <div className="lq-bqhead">
        <span className="lq-qn">Q{n}</span>
        <textarea
          className="fv-ta quiet lq-bstem"
          rows={2}
          value={q.stem}
          placeholder="Write the question"
          aria-label={`Question ${n}`}
          onChange={(e) => onChange({ ...q, stem: e.target.value })}
        />
        {locked ? null : (
          <button
            type="button"
            className="fv-iconbtn lq-bremove"
            aria-label={`Remove question ${n}`}
            title="Remove question"
            disabled={onlyOne}
            onClick={onRemove}
          >
            <Ic name="close" size={15} />
          </button>
        )}
      </div>

      {q.figure_path ? (
        <div className="lq-bfigure">
          <Figure path={q.figure_path} alt={`Figure for question ${n}`} />
          <div className="lq-bfigbtns">
            <button type="button" className="lq-linkish" disabled={uploading} onClick={() => fileRef.current?.click()}>
              Replace image
            </button>
            <button type="button" className="lq-linkish" onClick={() => onChange({ ...q, figure_path: null })}>
              Remove
            </button>
          </div>
        </div>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => void pickImage(e.target.files?.[0])}
      />

      {q.kind === "mc" ? (
        <div className="lq-bopts" role="radiogroup" aria-label={`Correct answer for question ${n}`}>
          {q.options.map((o, i) => {
            const right = q.correct === i;
            return (
              <div key={i} className={`lq-bopt${right ? " right" : ""}`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={right}
                  className="lq-bcorrect"
                  title="Mark as the correct answer"
                  onClick={() => settle({ correct: i })}
                >
                  {right ? <Ic name="check" size={13} /> : optionLetter(i)}
                </button>
                <input
                  className="fv-in"
                  value={o}
                  placeholder={`Option ${optionLetter(i)}`}
                  disabled={locked}
                  aria-label={`Question ${n}, option ${optionLetter(i)}`}
                  onChange={(e) => setOption(i, e.target.value)}
                />
                {q.options.length > 2 && !locked ? (
                  <button type="button" className="lq-optx" aria-label={`Remove option ${optionLetter(i)}`} onClick={() => removeOption(i)}>
                    <Ic name="close" size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : q.kind === "number" ? (
        <div className="lq-keybox">
          <label className="fv-field">
            <span className="fv-eyebrow">Answer</span>
            <input
              className="fv-in fv-num"
              inputMode="decimal"
              value={q.answer}
              placeholder="e.g. 1.1"
              aria-label={`Question ${n} answer`}
              onChange={(e) => settle({ answer: e.target.value })}
            />
          </label>
          <label className="fv-field">
            <span className="fv-eyebrow">Unit</span>
            <input
              className="fv-in"
              value={q.unit}
              placeholder="m/s"
              aria-label={`Question ${n} unit`}
              onChange={(e) => settle({ unit: e.target.value })}
            />
          </label>
          <label className="fv-field">
            <span className="fv-eyebrow">Right within ±</span>
            <input
              className="fv-in fv-num"
              inputMode="decimal"
              value={q.tolerance}
              placeholder="0"
              aria-label={`Question ${n} tolerance`}
              onChange={(e) => settle({ tolerance: e.target.value })}
            />
          </label>
          <span className="lq-keyhint">
            {key && answer !== null && tol !== null && Number(tol) > 0
              ? `Accepts ${tidy(Number(answer) - Number(tol))} to ${tidy(Number(answer) + Number(tol))}${q.unit.trim() ? ` ${q.unit.trim()}` : ""}`
              : null}
          </span>
        </div>
      ) : (
        <div className="lq-keybox expr">
          <span className="fv-eyebrow">Accepted answers · any equivalent form counts</span>
          <div className="lq-accept">
            {q.accept.map((a) => (
              <span key={a} className="lq-acceptchip">
                <code>{a}</code>
                <button type="button" aria-label={`Remove ${a}`} onClick={() => settle({ accept: q.accept.filter((x) => x !== a) })}>
                  <Ic name="close" size={11} />
                </button>
              </span>
            ))}
            <input
              className="fv-in lq-acceptin"
              value={adding}
              placeholder={q.accept.length ? "Add another form" : "e.g. F/2"}
              aria-label={`Question ${n}, add an accepted answer`}
              onChange={(e) => setAdding(e.target.value)}
              onBlur={addAccepted}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAccepted();
                }
              }}
            />
          </div>
        </div>
      )}

      <div className="lq-bqfoot">
        {q.kind === "mc" && q.options.length < MAX_OPTIONS && !locked ? (
          <button type="button" className="lq-linkish" onClick={() => onChange({ ...q, options: [...q.options, ""] })}>
            + Option
          </button>
        ) : null}
        {q.figure_path ? null : (
          <button type="button" className="lq-linkish" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "Uploading…" : "+ Image"}
          </button>
        )}
      </div>

      {pick && src?.note ? (
        <div className="lq-agentnote">
          <p className="warn">{src.note}</p>
        </div>
      ) : null}
    </article>
  );
}
