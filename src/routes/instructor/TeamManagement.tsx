"use client";

import { useRouter } from "next/navigation";
import { memberById, useStore } from "@/store";
import { Avatar, Button, Icon, PageHeader, Panel, StatusBadge } from "@/components";

export function TeamManagement() {
  const router = useRouter();
  const teams = useStore((s) => s.teams);

  return (
    <>
      <PageHeader
        title="Team management"
        subtitle="Organize students into teams, assign roles, and watch team sizes."
        actions={
          <>
            <Button variant="secondary" icon="upload_file" onClick={() => router.push("/i/roster")}>
              Import updated roster
            </Button>
            <Button variant="primary" icon="add">
              Create team
            </Button>
          </>
        }
      />
      <div className="card-grid-2">
        {teams
          .filter((t) => t.memberIds.length > 0)
          .map((t) => {
            const underSize = t.memberIds.length < t.targetSize;
            return (
              <Panel key={t.id}>
                <div className="team-card__head">
                  <span className="tile" style={{ width: 34, height: 34, background: "var(--stage-discussion-bg)", color: "var(--stage-discussion-fg)" }}>
                    <Icon name="groups" size="sm" />
                  </span>
                  <div style={{ flex: 1, fontWeight: 600, color: "var(--navy)" }}>{t.name}</div>
                  {t.locked && <StatusBadge variant="outline" icon="lock">Locked</StatusBadge>}
                  <StatusBadge variant={underSize ? "warning" : "outline"}>{t.memberIds.length} members</StatusBadge>
                </div>

                {t.memberIds.map((mid) => {
                  const m = memberById(useStore.getState(), mid);
                  if (!m) return null;
                  return (
                    <div className="team-member" key={mid}>
                      <Avatar member={m} size={28} />
                      <span style={{ flex: 1 }}>{m.name}</span>
                      {t.recorderId === mid && <StatusBadge variant="lavender">Recorder</StatusBadge>}
                      <Icon name="more_vert" size="sm" style={{ color: "var(--muted-2)" }} />
                    </div>
                  );
                })}

                {underSize && (
                  <div style={{ marginTop: 10, fontSize: "var(--text-xs)", color: "var(--warning-fg)", display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon name="warning" size="sm" /> Fewer than {t.targetSize} members
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <Button variant="secondary" icon="person_add">Add student</Button>
                  <Button variant="ghost" icon="badge">Roles</Button>
                </div>
              </Panel>
            );
          })}
      </div>
    </>
  );
}
