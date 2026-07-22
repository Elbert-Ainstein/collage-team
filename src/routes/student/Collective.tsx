"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { activityById, teamOfMember, useStore } from "@/store";
import { Alert, Avatar, Button, Icon, PageHeader, Panel, StatusBadge } from "@/components";
import { canAccessTeamStage } from "@/services/responseService";
import { copyOriginalIn, editCollectiveText, ensureCollective, getCollective } from "@/services/teamStageService";
import { usePresence } from "./usePresence";
import { OriginalsRail } from "./OriginalsRail";
import { MAYA, SEED_TEAM_3 } from "@/seed";

export function Collective() {
  const router = useRouter();
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  const team = useStore((s) => teamOfMember(s, MAYA.id))!;
  useStore((s) => s.collectives);
  const { present, editing } = usePresence(MAYA.id);

  // Ensure a (blank) shared workspace exists once we're in the team stage.
  useEffect(() => {
    if (canAccessTeamStage(MAYA.id, activityId)) ensureCollective(team.id, activityId);
  }, [activityId, team.id]);

  if (!canAccessTeamStage(MAYA.id, activityId)) {
    return (
      <>
        <PageHeader title="Team's final response" />
        <Alert variant="warning" icon="lock">
          Submit your individual preparation first.{" "}
          <a onClick={() => router.push("/s/prep")} style={{ color: "var(--navy)", cursor: "pointer", fontWeight: 600 }}>
            Go to prep →
          </a>
        </Alert>
      </>
    );
  }

  const collective = getCollective(team.id, activityId);
  const locked = !!collective?.locked;

  if (locked) {
    return (
      <>
        <PageHeader title="Team's final response" />
        <Alert variant="success" icon="lock">
          <strong>Team response submitted.</strong> Submitted on behalf of {SEED_TEAM_3.name} · all members confirmed
          participation · awaiting team rubric grade · shared response locked.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Team's final response"
        subtitle={`One shared answer for ${team.name}. Everyone can contribute; one member submits it for a shared grade.`}
        actions={
          <span className="meta-row" style={{ margin: 0 }}>
            <Icon name="sync" size="sm" /> Autosaved
          </span>
        }
      />

      <div className="workspace">
        <Panel>
          <OriginalsRail activityId={activityId} lockNote="Originals stay read-only. Nothing is copied in automatically." />
        </Panel>

        <Panel>
          <div className="presence-row">
            <div className="presence-avatars">
              {present.map((m) => (
                <Avatar key={m.id} member={m} size={28} />
              ))}
            </div>
            {editing ? (
              <span className="editing-note">
                <Icon name="edit" size="sm" /> {editing.name.split(" ")[0]} is editing
              </span>
            ) : (
              <span className="editing-note" style={{ color: "var(--muted)" }}>
                {collective?.lastEditedAt ? `Edited ${new Date(collective.lastEditedAt).toLocaleTimeString()}` : "No edits yet"}
              </span>
            )}
          </div>

          <textarea
            className="workspace-textarea"
            placeholder="Write your team's shared final response here…"
            value={collective?.text ?? ""}
            onChange={(e) => editCollectiveText(team.id, activityId, MAYA.id, e.target.value)}
          />

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <Button variant="secondary" icon="attach_file">
              Attach final calculations
            </Button>
            <Button
              variant="secondary"
              icon="content_copy"
              onClick={() => copyOriginalIn(team.id, activityId, MAYA.id, MAYA.id, 2)}
            >
              Copy selected original in
            </Button>
          </div>

          <div style={{ marginTop: 18 }}>
            <Alert variant="info" icon="how_to_reg">
              <strong>Participation &amp; submission.</strong> All members confirm participation, then one member submits
              for the whole team.
            </Alert>
          </div>
          <div style={{ marginTop: 12 }}>
            <Button variant="primary" iconRight="arrow_forward" onClick={() => router.push("/s/participation")}>
              Confirm &amp; review
            </Button>
            {activity.collectiveSettings.startBlankWorkspace && (
              <div style={{ marginTop: 8 }}>
                <StatusBadge variant="outline">Workspace started blank — nothing copied in automatically</StatusBadge>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
