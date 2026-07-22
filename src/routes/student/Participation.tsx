import { useNavigate } from "react-router-dom";
import "./student.css";
import "./teamStage.css";
import { memberById, teamOfMember, useStore } from "@/store";
import { Alert, Avatar, Button, ConfirmationCard, Icon, PageHeader, Panel, StatusBadge } from "@/components";
import {
  allConfirmed,
  confirmParticipation,
  getCollective,
  submitCollective,
} from "@/services/teamStageService";
import { canAccessTeamStage } from "@/services/responseService";
import { MAYA } from "@/seed";

export function Participation() {
  const navigate = useNavigate();
  const activityId = useStore((s) => s.currentActivityId);
  const team = useStore((s) => teamOfMember(s, MAYA.id))!;
  useStore((s) => s.collectives);

  if (!canAccessTeamStage(MAYA.id, activityId)) {
    navigate("/s/prep");
    return null;
  }

  const collective = getCollective(team.id, activityId);
  const confirmed = collective?.participationConfirmed ?? {};
  const everyone = allConfirmed(team.id, activityId);

  if (collective?.locked) {
    const submitter = memberById(useStore.getState(), collective.submittedBy ?? "")?.name ?? "A teammate";
    return (
      <ConfirmationCard
        title="Team response submitted"
        subtitle={`Submitted on behalf of ${team.name} by ${submitter}.`}
        receipt={[
          { label: "Confirmed", value: <StatusBadge variant="success" icon="check">All {team.memberIds.length} members</StatusBadge> },
          { label: "Grade", value: "Awaiting team rubric grade" },
          { label: "Shared response", value: <><Icon name="lock" size="sm" /> Locked</> },
        ]}
        actions={
          <Button variant="primary" onClick={() => navigate("/s/activities")}>
            Back to activities
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Participation & submission"
        subtitle="Every member confirms they contributed, then one member submits for the whole team."
      />

      <Panel style={{ marginBottom: 16 }}>
        {team.memberIds.map((id) => {
          const member = memberById(useStore.getState(), id)!;
          const isOn = confirmed[id] === true;
          return (
            <div className="participation-row" key={id}>
              <Avatar member={member} size={34} />
              <div className="participation-row__body">
                <div className="member-card__name">
                  {member.name} {id === MAYA.id && <StatusBadge variant="sky">You</StatusBadge>}
                </div>
                <div className="member-card__sub">{isOn ? "Confirmed contribution" : "Awaiting confirmation"}</div>
              </div>
              {isOn && <StatusBadge variant="success" icon="check">Confirmed</StatusBadge>}
              <button
                className={`switch ${isOn ? "switch--on" : ""}`}
                aria-label={`Confirm ${member.name}`}
                onClick={() => confirmParticipation(team.id, activityId, id, !isOn)}
              >
                <span className="switch__knob" />
              </button>
            </div>
          );
        })}
      </Panel>

      <div style={{ marginBottom: 16 }}>
        {everyone ? (
          <Alert variant="success">All members confirmed. One member may now submit for the team.</Alert>
        ) : (
          <Alert variant="warning">Waiting on confirmations — every member must confirm before the team can submit.</Alert>
        )}
      </div>

      <Button
        variant="primary"
        large
        icon="send"
        disabled={!everyone}
        onClick={() => {
          submitCollective(team.id, activityId, MAYA.id);
        }}
      >
        Submit for team
      </Button>
    </>
  );
}
