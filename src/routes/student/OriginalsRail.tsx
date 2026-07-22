import { memberById, teamOfMember, useStore } from "@/store";
import { Avatar, Icon, SectionLabel } from "@/components";
import { getTeammateOriginals } from "@/services/responseService";
import { MAYA } from "@/seed";

// Shared read-only rail of team originals used by both final workspaces (§7.6/§7.8).
// "Originals stay read-only. Nothing is copied in automatically."
export function OriginalsRail({
  activityId,
  lockNote,
  onCopyIn,
}: {
  activityId: string;
  lockNote: string;
  onCopyIn?: (fromMemberId: string, questionN: number) => void;
}) {
  const team = useStore((s) => teamOfMember(s, MAYA.id))!;
  useStore((s) => s.originals);
  const originals = getTeammateOriginals(MAYA.id, activityId);
  const byMember = new Map(originals.map((o) => [o.memberId, o]));

  return (
    <div>
      <SectionLabel>Your original responses</SectionLabel>
      {team.memberIds.map((id) => {
        const member = memberById(useStore.getState(), id)!;
        const original = byMember.get(id);
        const choice = original?.answers[1] ?? "—";
        return (
          <div className="originals-rail__item" key={id}>
            <div className="originals-rail__name">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Avatar member={member} size={20} />
                {member.name.split(" ")[0]}
                {id === MAYA.id && <span style={{ color: "var(--muted)" }}>(you)</span>}
              </span>
              <Icon name="lock" size="sm" style={{ color: "var(--muted-2)" }} />
            </div>
            <div className="originals-rail__ans">Q1: {choice}</div>
            {onCopyIn && (
              <button
                className="btn btn--ghost"
                style={{ padding: "4px 6px", fontSize: "var(--text-2xs)", marginTop: 4 }}
                onClick={() => onCopyIn(id, 1)}
              >
                <Icon name="content_copy" size="sm" /> Copy original in
              </button>
            )}
          </div>
        );
      })}
      <div className="lock-note" style={{ marginTop: 8 }}>
        <Icon name="lock" size="sm" /> {lockNote}
      </div>
    </div>
  );
}
