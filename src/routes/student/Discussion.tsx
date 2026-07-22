import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./student.css";
import "./teamStage.css";
import { activityById, memberById, teamOfMember, useStore } from "@/store";
import { Alert, Avatar, Button, Icon, PageHeader, Panel, SectionLabel, StageChip, StatusBadge, AiBadge } from "@/components";
import { canAccessTeamStage, getTeammateOriginals } from "@/services/responseService";
import { MAYA } from "@/seed";
import type { OriginalResponse, Question } from "@/types";

export function Discussion() {
  const navigate = useNavigate();
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  const team = useStore((s) => teamOfMember(s, MAYA.id))!;
  useStore((s) => s.originals); // reactivity
  const [activeQ, setActiveQ] = useState(1);

  // Prep gate (§4) — enforced in UI and service.
  if (!canAccessTeamStage(MAYA.id, activityId)) {
    return (
      <>
        <PageHeader title="Team discussion" />
        <Alert variant="warning" icon="lock">
          Submit your <strong>individual preparation</strong> before entering the team stage.{" "}
          <a onClick={() => navigate("/s/prep")} style={{ color: "var(--navy)", cursor: "pointer", fontWeight: 600 }}>
            Go to prep →
          </a>
        </Alert>
      </>
    );
  }

  const originals = getTeammateOriginals(MAYA.id, activityId);
  const byMember = new Map(originals.map((o) => [o.memberId, o]));
  const question = activity.questions.find((q) => q.n === activeQ)!;
  const memberNames = team.memberIds
    .map((id) => memberById(useStore.getState(), id)?.name.split(" ")[0])
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <PageHeader
        title="Team discussion"
        subtitle={
          <>
            Compare everyone's original reasoning, then discuss in person.{" "}
            <strong>You only see original prep — never what teammates change now.</strong>
          </>
        }
      />

      <div className="stage-banner" style={{ background: "var(--stage-discussion-bg)", borderColor: "var(--stage-discussion-fg)" }}>
        <StageChip stage="discussion" />
        <span style={{ color: "var(--stage-discussion-fg)", fontSize: "var(--text-sm)", fontWeight: 500 }}>
          {team.name} · {memberNames}
        </span>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Alert variant="info" icon="lock">
          <strong>Original responses are read-only.</strong> These are the answers your teammates submitted before class.
          Post-discussion work stays private until it is submitted.
        </Alert>
      </div>

      <div className="q-nav">
        {activity.questions.map((q) => (
          <button
            key={q.n}
            className={`q-nav__pill ${q.n === activeQ ? "q-nav__pill--active" : ""}`}
            onClick={() => setActiveQ(q.n)}
          >
            Q{q.n}
          </button>
        ))}
      </div>

      <Panel style={{ marginBottom: 20 }}>
        <div className="q-head">
          <span className="q-num">{question.n}</span>
          <StatusBadge variant="outline">{question.type.replace("-", " ")}</StatusBadge>
          {question.objectiveTag && <span className="objective-tag"><Icon name="flag" size="sm" />{question.objectiveTag}</span>}
        </div>
        <div className="q-prompt" style={{ marginBottom: 0 }}>{question.prompt}</div>
      </Panel>

      <SectionLabel>Your team's original responses</SectionLabel>
      <div className="member-grid">
        {team.memberIds.map((id) => {
          const member = memberById(useStore.getState(), id)!;
          const isYou = id === MAYA.id;
          const original = byMember.get(id);
          return (
            <Panel key={id} className={isYou ? "member-card--you" : ""}>
              <div className="member-card__head">
                <Avatar member={member} size={34} />
                <div style={{ flex: 1 }}>
                  <div className="member-card__name">
                    {member.name} {isYou && <StatusBadge variant="sky">You</StatusBadge>}
                  </div>
                  <div className="member-card__sub">Submitted · original</div>
                </div>
                {original?.status === "needs-review" ? (
                  <StatusBadge variant="warning">Needs review</StatusBadge>
                ) : (
                  <StatusBadge variant="success">Complete</StatusBadge>
                )}
              </div>
              <AnswerView original={original} question={question} showUploads={activity.teamSettings.showUploadsAndOcr} />
            </Panel>
          );
        })}
      </div>

      <ModePanel
        mode={activity.mode}
        onOpen={() => navigate(activity.mode === "COLLECTIVE" ? "/s/collective" : "/s/individual")}
      />
    </>
  );
}

function AnswerView({
  original,
  question,
  showUploads,
}: {
  original?: OriginalResponse;
  question: Question;
  showUploads: boolean;
}) {
  if (!original) return <div className="answer-block answer-block--empty">— not submitted</div>;

  if (question.type === "handwritten-upload") {
    if (!original.upload) return <div className="answer-block answer-block--empty">— not attempted</div>;
    return (
      <div>
        <div className="file-chip">
          <Icon name="description" size="sm" />
          {original.upload.filename}
        </div>
        {showUploads && (
          <>
            <div style={{ marginBottom: 6 }}>
              <AiBadge>OCR transcription</AiBadge>
            </div>
            <div className="mono-excerpt">{original.upload.ocrText}</div>
          </>
        )}
      </div>
    );
  }

  const val = original.answers[question.n];
  if (!val || `${val}`.trim() === "") return <div className="answer-block answer-block--empty">— not attempted</div>;
  return <div className="answer-block">{val}</div>;
}

function ModePanel({ mode, onOpen }: { mode: "COLLECTIVE" | "INDIVIDUAL"; onOpen: () => void }) {
  const isCollective = mode === "COLLECTIVE";
  return (
    <div
      className="mode-panel"
      style={{
        background: isCollective ? "var(--stage-collective-bg)" : "var(--stage-individual-bg)",
        borderColor: isCollective ? "var(--stage-collective-fg)" : "var(--stage-individual-fg)",
      }}
    >
      <StageChip stage={isCollective ? "collective" : "individual-final"} />
      <div className="mode-panel__body">
        <div style={{ fontWeight: 600, color: "var(--navy)" }}>
          {isCollective ? "One collective response per team" : "One private response per student"}{" "}
          <span style={{ fontWeight: 400, color: "var(--muted)" }}>· set by your instructor</span>
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: 2 }}>
          {isCollective
            ? "Discuss your originals, then create one shared submission for a team grade."
            : "After discussing, write your own revised answer — graded individually, kept private."}
        </div>
      </div>
      <Button variant="primary" iconRight="arrow_forward" onClick={onOpen}>
        {isCollective ? "Open shared workspace" : "Open my private response"}
      </Button>
    </div>
  );
}
