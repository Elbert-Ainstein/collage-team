import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./student.css";
import { useStore } from "@/store";
import { Alert, Button, Icon, PageHeader, Panel, AiBadge, StatusBadge } from "@/components";
import { confirmOcr } from "@/services/responseService";
import { MAYA } from "@/seed";

export function OcrReview() {
  const navigate = useNavigate();
  const activityId = useStore((s) => s.currentActivityId);
  const original = useStore((s) => s.originals.find((r) => r.memberId === MAYA.id && r.activityId === activityId));
  const upload = original?.upload;
  const [text, setText] = useState(upload?.ocrText ?? "");

  if (!upload) {
    return (
      <>
        <PageHeader title="OCR review" />
        <Alert variant="info">No uploaded work to review. Go back and upload your calculations first.</Alert>
      </>
    );
  }

  function confirm() {
    confirmOcr(MAYA.id, activityId, text);
    navigate("/s/prep");
  }

  return (
    <>
      <PageHeader
        title="Review the transcription"
        subtitle="The original image is always kept — this text is just an interpretation your team can read."
        actions={
          <Button variant="ghost" icon="arrow_back" onClick={() => navigate("/s/prep")}>
            Back to prep
          </Button>
        }
      />
      <div className="ocr-grid">
        <Panel>
          <div className="panel-title">
            <span>Original upload</span>
            <StatusBadge variant="outline">{upload.filename}</StatusBadge>
          </div>
          <div className="ocr-image">
            [ handwritten image preview ]{"\n\n"}
            {upload.ocrText}
          </div>
          <div className="lock-note" style={{ marginTop: 10 }}>
            <Icon name="image" size="sm" /> Page 1 of 1 · handwritten · always preserved
          </div>
        </Panel>

        <Panel>
          <div className="panel-title">
            <span>OCR transcription</span>
            <AiBadge>Auto-transcribed</AiBadge>
          </div>
          {upload.flaggedSymbols.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Alert variant="warning">
                <strong>{upload.flaggedSymbols.length} symbols were uncertain</strong> — we highlighted where the
                handwriting was hard to read ({upload.flaggedSymbols.join(", ")}). Please correct anything wrong.
              </Alert>
            </div>
          )}
          <textarea className="field" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
          <div style={{ marginTop: 14 }}>
            <Button variant="primary" icon="check" onClick={confirm}>
              Confirm transcription
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
