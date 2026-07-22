import { useNavigate } from "react-router-dom";
import { activityById, useStore } from "@/store";
import { Alert, Button, ConfirmationCard, Icon, StatusBadge } from "@/components";
import type { ReceiptRow } from "@/components";
import { getOriginal } from "@/services/responseService";
import { MAYA } from "@/seed";

export function PrepConfirm() {
  const navigate = useNavigate();
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  const original = getOriginal(MAYA.id, activityId);

  if (!original?.locked) {
    navigate("/s/prep");
    return null;
  }

  const attempted = Object.values(original.answers).filter((v) => `${v}`.trim() !== "").length;
  const submittedAt = original.submittedAt ? new Date(original.submittedAt).toLocaleString() : "—";

  const receipt: ReceiptRow[] = [
    { label: "Submitted", value: submittedAt },
    {
      label: "Completeness",
      value: (
        <StatusBadge variant="success" icon="check">
          Complete — {attempted}/{activity.questions.filter((q) => q.type !== "handwritten-upload").length} attempted
        </StatusBadge>
      ),
    },
    ...(activity.prepSettings.awardPrepCredit
      ? [{ label: "Preparation credit", value: <StatusBadge variant="sky">Awarded · completion</StatusBadge> }]
      : []),
    {
      label: "Original response",
      value: (
        <>
          <Icon name="lock" size="sm" /> Locked · cannot be edited
        </>
      ),
    },
  ];

  return (
    <ConfirmationCard
      title="Preparation submitted"
      subtitle="Your original response is locked and preserved. Your team will see it during the discussion."
      receipt={receipt}
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate("/s/activities")}>
            Back to activities
          </Button>
          <Button variant="primary" iconRight="arrow_forward" onClick={() => navigate("/s/discussion")}>
            Continue to team stage
          </Button>
        </>
      }
    >
      <div style={{ margin: "4px 0 18px" }}>
        <Alert variant="info">
          This submission is assessed for <strong>completeness, not correctness</strong>. It will be shown to your team
          during discussion.
        </Alert>
      </div>
    </ConfirmationCard>
  );
}
