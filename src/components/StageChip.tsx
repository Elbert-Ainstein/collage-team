import type { Stage, SubmissionMode } from "@/types";
import { Icon } from "./Icon";

interface StageMeta {
  label: string;
  icon: string;
  fg: string;
  bg: string;
}

export const STAGE_META: Record<Stage, StageMeta> = {
  prep: { label: "Individual prep", icon: "person", fg: "var(--stage-prep-fg)", bg: "var(--stage-prep-bg)" },
  discussion: { label: "Team discussion", icon: "groups", fg: "var(--stage-discussion-fg)", bg: "var(--stage-discussion-bg)" },
  collective: { label: "Collective response", icon: "diversity_3", fg: "var(--stage-collective-fg)", bg: "var(--stage-collective-bg)" },
  "individual-final": { label: "Individual final", icon: "draw", fg: "var(--stage-individual-fg)", bg: "var(--stage-individual-bg)" },
  assessment: { label: "Assessment", icon: "verified", fg: "var(--stage-assessment-fg)", bg: "var(--stage-assessment-bg)" },
};

export function StageChip({ stage, big, label }: { stage: Stage; big?: boolean; label?: string }) {
  const m = STAGE_META[stage];
  return (
    <span className={`chip ${big ? "chip--lg" : ""}`} style={{ background: m.bg, color: m.fg }}>
      <Icon name={m.icon} size="sm" />
      {label ?? m.label}
    </span>
  );
}

// The four-stage pipeline (§2). Mode-aware: shows collective OR individual-final.
export function StagePipeline({ mode, big }: { mode: SubmissionMode; big?: boolean }) {
  const finalStage: Stage = mode === "COLLECTIVE" ? "collective" : "individual-final";
  const stages: Stage[] = ["prep", "discussion", finalStage, "assessment"];
  return (
    <div className="stage-pipeline">
      {stages.map((s, i) => (
        <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <StageChip stage={s} big={big} />
          {i < stages.length - 1 && <Icon name="arrow_forward" className="stage-pipeline__arrow" />}
        </span>
      ))}
    </div>
  );
}
