"use client";

// "Start from a PDF": drop in a page of questions and the assistant drafts
// them — stems, options, suggested keys, and each question's figure cut out of
// the page. Nothing is saved here; the drafted questions land in the builder,
// where she checks them like ones she typed and saves them with Finish.

import { useEffect, useRef, useState } from "react";
import type { LeftOut } from "@/assistant/liveDraft";
import { Ic } from "@/live/ui";
import { cropFigures } from "./cropFigures";
import type { DraftQuestion } from "./draft";
import { draftToQuestions } from "./importDraft";
import { importLivePdf } from "./importClient";

export interface Imported {
  fileName: string;
  title: string | null;
  questions: DraftQuestion[];
  leftOut: LeftOut[];
  /** Figures that couldn't be cut out; those questions have no image yet. */
  figuresMissed: number;
}

type Stage =
  | { kind: "idle" }
  | { kind: "working"; file: string; step: 0 | 1 | 2; figures?: [number, number] }
  | { kind: "failed"; file: string; message: string };

/** "AP50_Module-9.pdf" → "AP50 Module 9". */
export function titleFromFileName(name: string): string | null {
  const t = name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return t || null;
}

const STEPS = ["Uploading the PDF", "Reading the questions — this can take a minute", "Cutting out the figures"];

interface Props {
  courseId: string;
  activityId: string;
  onImported: (result: Imported) => void;
}

export function ImportCard({ courseId, activityId, onImported }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const start = async (file: File) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setStage({ kind: "working", file: file.name, step: 0 });
    try {
      // The upload and the model read are one call; the step shown moves on
      // once the upload has had a moment, since that part is quick.
      const reading = window.setTimeout(() => {
        if (!ctl.signal.aborted) setStage({ kind: "working", file: file.name, step: 1 });
      }, 1500);
      const draft = await importLivePdf({ courseId, activityId, file }, ctl.signal).finally(() => window.clearTimeout(reading));
      if (draft.items.length === 0) throw new Error("No questions found in that PDF.");
      const items = draftToQuestions(draft);
      const jobs = items.flatMap((it) => (it.figure ? [{ questionId: it.question.id, figure: it.figure }] : []));
      let missed = 0;
      let paths = new Map<string, string>();
      if (jobs.length) {
        setStage({ kind: "working", file: file.name, step: 2, figures: [0, jobs.length] });
        const cut = await cropFigures(await file.arrayBuffer(), activityId, jobs, (done, total) => {
          if (!ctl.signal.aborted) setStage({ kind: "working", file: file.name, step: 2, figures: [done, total] });
        });
        paths = cut.paths;
        missed = cut.failed;
      }
      if (ctl.signal.aborted) return;
      setStage({ kind: "idle" });
      onImported({
        fileName: file.name,
        // The PDF's own title when the model found one, else its file name.
        title: draft.title?.trim() || titleFromFileName(file.name),
        questions: items.map((it) => ({ ...it.question, figure_path: paths.get(it.question.id) ?? null })),
        leftOut: draft.leftOut,
        figuresMissed: missed,
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError" || ctl.signal.aborted) return;
      setStage({ kind: "failed", file: file.name, message: e instanceof Error ? e.message : "The import didn’t work." });
    }
  };

  if (stage.kind === "working") {
    return (
      <div className="lq-agent" role="status" aria-live="polite">
        <div className="lq-agenthead">
          <span className="lq-agentmark">
            <Ic name="sparkle" size={16} />
          </span>
          <div>
            <b>Drafting…</b>
            <span className="lq-agentfile">
              <Ic name="file" size={13} /> {stage.file}
            </span>
          </div>
        </div>
        <ol className="lq-agentsteps">
          {STEPS.slice(0, stage.step + 1).map((text, i) => (
            <li key={text} className={i === stage.step ? "now" : "done"}>
              <span className="lq-agentdot">{i === stage.step ? <i /> : <Ic name="check" size={11} />}</span>
              {i === 2 && stage.figures ? `${text} (${stage.figures[0]} of ${stage.figures[1]})` : text}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div
      className={`lq-import${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void start(f);
      }}
    >
      <span className="lq-importicon">
        <Ic name="sparkle" size={20} />
      </span>
      <div className="lq-importtext">
        <b>Start from a PDF</b>
        <span className="fv-sub">
          {stage.kind === "failed" ? (
            <span style={{ color: "var(--lq-wrong)" }}>
              {stage.file}: {stage.message}
            </span>
          ) : (
            "Drop one in and the assistant drafts the questions and answer keys."
          )}
        </span>
        <div className="lq-importbtns">
          <button type="button" className="fv-btn outline sm" onClick={() => input.current?.click()}>
            <Ic name="upload" size={14} /> {stage.kind === "failed" ? "Try another PDF" : "Choose a PDF"}
          </button>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void start(f);
        }}
      />
    </div>
  );
}
