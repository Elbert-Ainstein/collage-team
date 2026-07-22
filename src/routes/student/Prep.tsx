import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./student.css";
import { activityById, useStore } from "@/store";
import { Alert, Button, Icon, PageHeader, Panel, StageChip, StatusBadge, AiBadge } from "@/components";
import { saveDraftPrep, submitPrep, validatePrep } from "@/services/responseService";
import { ocrAdapter } from "@/services/adapters/ocrAdapter";
import { RuleViolation } from "@/services/errors";
import { MAYA } from "@/seed";
import type { Question, Upload } from "@/types";

export function Prep() {
  const navigate = useNavigate();
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  const original = useStore((s) => s.originals.find((r) => r.memberId === MAYA.id && r.activityId === activityId));
  const locked = !!original?.locked;

  const [answers, setAnswers] = useState<Record<number, string>>(original?.answers ?? {});
  const [error, setError] = useState<string | null>(null);
  const upload = original?.upload;

  const attempted = useMemo(
    () => activity.questions.filter((q) => q.type !== "handwritten-upload" && (answers[q.n] ?? "").trim() !== "").length,
    [answers, activity.questions],
  );
  const nonUploadCount = activity.questions.filter((q) => q.type !== "handwritten-upload").length;

  function update(n: number, value: string) {
    if (locked) return;
    const next = { ...answers, [n]: value };
    setAnswers(next);
    saveDraftPrep(MAYA.id, activityId, next, upload);
    setError(null);
  }

  async function handleUpload() {
    if (locked) return;
    // Mock: "upload" a photo, run OCR, then send the student to review it.
    const result = await ocrAdapter.transcribe({ name: "calc_bridge_load.jpg" });
    const up: Upload = {
      filename: "calc_bridge_load.jpg",
      imageUrl: "",
      ocrText: result.text,
      ocrConfirmed: false,
      flaggedSymbols: result.flaggedSymbols,
    };
    saveDraftPrep(MAYA.id, activityId, answers, up);
    navigate("/s/ocr");
  }

  function handleSubmit() {
    const check = validatePrep(activityId, answers, upload);
    if (!check.ok) {
      setError(check.missing.join(" · "));
      return;
    }
    try {
      submitPrep(MAYA.id, activityId, answers, upload);
      navigate("/s/confirm");
    } catch (e) {
      if (e instanceof RuleViolation) setError(e.message);
    }
  }

  return (
    <>
      <PageHeader
        title="Individual preparation"
        subtitle={
          <>
            Work on this independently before class.{" "}
            <strong>Your original answers are saved and shown to your team — you cannot change them afterward.</strong>
          </>
        }
        actions={locked ? <StatusBadge variant="navy" icon="lock">Submitted · read-only</StatusBadge> : undefined}
      />

      <div className="stage-banner" style={{ background: "var(--stage-prep-bg)", borderColor: "var(--stage-prep-fg)" }}>
        <StageChip stage="prep" />
        <span style={{ color: "#0b4a86", fontSize: "var(--text-sm)" }}>
          Assessed for completeness, not correctness. Due {activity.individualDue}.
        </span>
      </div>

      {locked && (
        <div style={{ marginBottom: 16 }}>
          <Alert variant="info" icon="lock">
            This is your <strong>original response</strong>. It is locked and preserved exactly as submitted — teammates
            see this, and it can never be edited.
          </Alert>
        </div>
      )}

      <div className="meta-row">
        <Icon name={locked ? "lock" : "check_circle"} size="sm" style={{ color: locked ? "var(--muted)" : "var(--success-fg)" }} />
        {locked ? "Locked original" : "Autosaved just now"} · {attempted} of {nonUploadCount} attempted
      </div>

      {activity.questions.map((q) => (
        <Panel key={q.n} className="q-card">
          <QuestionField
            q={q}
            value={answers[q.n] ?? ""}
            locked={locked}
            upload={upload}
            onChange={(v) => update(q.n, v)}
            onUpload={handleUpload}
            onReviewOcr={() => navigate("/s/ocr")}
          />
        </Panel>
      ))}

      {error && (
        <div style={{ marginTop: 8 }}>
          <Alert variant="warning">Preparation incomplete — {error}</Alert>
        </div>
      )}

      {!locked && (
        <div className="sticky-footer">
          <span className="lock-note">
            <Icon name="info" size="sm" /> Submitting locks your original permanently.
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="secondary" icon="save" onClick={() => saveDraftPrep(MAYA.id, activityId, answers, upload)}>
              Save draft
            </Button>
            <Button variant="primary" icon="lock" onClick={handleSubmit}>
              Submit preparation
            </Button>
          </div>
        </div>
      )}

      {locked && (
        <div className="sticky-footer">
          <span className="lock-note">
            <Icon name="lock" size="sm" /> Original locked · cannot be edited
          </span>
          <Button variant="primary" iconRight="arrow_forward" onClick={() => navigate("/s/discussion")}>
            Continue to team stage
          </Button>
        </div>
      )}
    </>
  );
}

function QuestionField({
  q,
  value,
  locked,
  upload,
  onChange,
  onUpload,
  onReviewOcr,
}: {
  q: Question;
  value: string;
  locked: boolean;
  upload?: Upload;
  onChange: (v: string) => void;
  onUpload: () => void;
  onReviewOcr: () => void;
}) {
  return (
    <>
      <div className="q-head">
        <span className="q-num">{q.n}</span>
        <StatusBadge variant="outline">{q.type.replace("-", " ")}</StatusBadge>
        {q.type === "handwritten-upload" && <StatusBadge variant="warning">Written work required</StatusBadge>}
        {locked && (
          <span className="read-only-tag" style={{ marginLeft: "auto" }}>
            <Icon name="lock" size="sm" /> original
          </span>
        )}
      </div>
      <div className="q-prompt">{q.prompt}</div>

      {q.type === "multiple-choice" &&
        q.options!.map((opt) => (
          <label key={opt} className={`radio-row ${value === opt ? "radio-row--selected" : ""}`}>
            <input
              type="radio"
              name={`q${q.n}`}
              value={opt}
              checked={value === opt}
              disabled={locked}
              onChange={() => onChange(opt)}
            />
            {opt}
          </label>
        ))}

      {q.type === "numerical" && (
        <input
          className="field field--num"
          placeholder={q.unitHint}
          value={value}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {(q.type === "short-response" || q.type === "long-response") && (
        <textarea
          className="field"
          rows={q.type === "long-response" ? 4 : 2}
          value={value}
          disabled={locked}
          placeholder="Type your response…"
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {q.type === "handwritten-upload" &&
        (upload ? (
          <button className="dropzone dropzone--done" onClick={onReviewOcr} disabled={locked}>
            <Icon name={upload.ocrConfirmed ? "check_circle" : "pending"} />
            <span>
              <strong>{upload.filename}</strong> — {upload.ocrConfirmed ? "OCR confirmed" : "OCR needs review"} · Tap to
              review the transcription
              <div style={{ marginTop: 4 }}>
                <AiBadge>
                  OCR transcription {upload.ocrConfirmed ? "ready" : "pending"} · you reviewed{" "}
                  {upload.flaggedSymbols.length} flagged symbols
                </AiBadge>
              </div>
            </span>
          </button>
        ) : (
          <div className="dropzone">
            <Icon name="upload_file" size="lg" />
            <div style={{ margin: "8px 0" }}>
              Upload a photo or PDF of your calculations — we run OCR so your team can read it during discussion.
            </div>
            <Button variant="secondary" icon="add_photo_alternate" onClick={onUpload} disabled={locked}>
              Upload work
            </Button>
          </div>
        ))}
    </>
  );
}
