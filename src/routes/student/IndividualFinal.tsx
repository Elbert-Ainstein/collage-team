"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { activityById, useStore } from "@/store";
import { Alert, Button, ConfirmationCard, Icon, PageHeader, Panel, StatusBadge } from "@/components";
import { canAccessTeamStage } from "@/services/responseService";
import { getOwnFinal, saveFinalDraft, submitFinal } from "@/services/teamStageService";
import { OriginalsRail } from "./OriginalsRail";
import { MAYA } from "@/seed";

export function IndividualFinal() {
  const router = useRouter();
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  useStore((s) => s.individualFinals);
  const own = getOwnFinal(MAYA.id, activityId);
  const [text, setText] = useState(own?.text ?? "");

  if (!canAccessTeamStage(MAYA.id, activityId)) {
    return (
      <>
        <PageHeader title="My final individual response" />
        <Alert variant="warning" icon="lock">
          Submit your individual preparation first.{" "}
          <a onClick={() => router.push("/s/prep")} style={{ color: "var(--navy)", cursor: "pointer", fontWeight: 600 }}>
            Go to prep →
          </a>
        </Alert>
      </>
    );
  }

  if (own?.locked) {
    return (
      <ConfirmationCard
        title="Final response submitted"
        subtitle="Your private response has been submitted for grading."
        receipt={[
          { label: "Visibility", value: <><Icon name="lock" size="sm" /> Private · teammates cannot see this</> },
          { label: "Original prep", value: "Preserved separately — not overwritten" },
          { label: "Grade", value: "Awaiting rubric-based grading" },
        ]}
        actions={
          <Button variant="primary" onClick={() => router.push("/s/activities")}>
            Back to activities
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title="My final individual response"
        subtitle={
          <>
            After discussing, write your own revised answer.{" "}
            <strong>This is private — teammates never see it, and it does not replace your original prep.</strong>
          </>
        }
      />

      <div className="workspace">
        <Panel>
          <OriginalsRail activityId={activityId} lockNote="Your original prep is kept and never overwritten." />
        </Panel>

        <Panel>
          <div className="mode-panel private-alert" style={{ marginTop: 0, marginBottom: 16, background: "var(--stage-individual-bg)" }}>
            <Icon name="lock" style={{ color: "var(--stage-individual-fg)" }} />
            <div className="mode-panel__body">
              <div style={{ fontWeight: 600, color: "var(--navy)" }}>Private to you</div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
                Teammates cannot see what you write here. You may revise until the deadline.
              </div>
            </div>
          </div>

          <textarea
            className="workspace-textarea"
            placeholder="Write your revised individual answer…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              saveFinalDraft(MAYA.id, activityId, e.target.value);
            }}
          />

          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
            <Button variant="secondary" icon="attach_file">
              Upload final calculations
            </Button>
            <Button variant="primary" icon="lock" onClick={() => submitFinal(MAYA.id, activityId, text)}>
              Submit for grading
            </Button>
            {activity.individualSettings.oneSubmissionLimit && (
              <StatusBadge variant="outline">One submission only</StatusBadge>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
