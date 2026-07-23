"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { activityById, useStore } from "@/store";
import { Button, Icon, PageHeader, Panel, SettingRow, StatusBadge } from "@/components";
import type {
  Activity,
  CollectiveSettings,
  IndividualSettings,
  PrepSettings,
  SubmissionMode,
  TeamSettings,
} from "@/types";

const TABS = ["Details", "Questions", "Individual prep", "Team stage", "Submission mode"] as const;
type Tab = (typeof TABS)[number];

export function ActivityBuilder() {
  const router = useRouter();
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  const update = useStore((s) => s._updateActivity);
  const [tab, setTab] = useState<Tab>("Details");

  function patch(p: Partial<Activity>) {
    update(activityId, p);
  }
  function prep<K extends keyof PrepSettings>(k: K, v: PrepSettings[K]) {
    patch({ prepSettings: { ...activity.prepSettings, [k]: v } });
  }
  function team<K extends keyof TeamSettings>(k: K, v: TeamSettings[K]) {
    patch({ teamSettings: { ...activity.teamSettings, [k]: v } });
  }
  function coll<K extends keyof CollectiveSettings>(k: K, v: CollectiveSettings[K]) {
    patch({ collectiveSettings: { ...activity.collectiveSettings, [k]: v } });
  }
  function indiv<K extends keyof IndividualSettings>(k: K, v: IndividualSettings[K]) {
    patch({ individualSettings: { ...activity.individualSettings, [k]: v } });
  }

  function previewStudent() {
    useStore.getState().setRole("student");
    router.push("/s/prep");
  }

  return (
    <>
      <PageHeader
        title="Activity builder"
        subtitle={activity.title}
        actions={
          <>
            <Button variant="secondary" icon="auto_awesome" onClick={() => router.push("/i/activities?tab=ai")}>
              Regenerate with AI
            </Button>
            <Button variant="primary" icon="publish" onClick={() => patch({ status: "team-stage" })}>
              Publish activity
            </Button>
          </>
        }
      />

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${t === tab ? "tab--active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Details" && (
        <Panel>
          <label className="field-label">Activity title</label>
          <input className="text-input" value={activity.title} onChange={(e) => patch({ title: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Description</label>
          <textarea className="text-input" rows={2} value={activity.description} onChange={(e) => patch({ description: e.target.value })} />
          <label className="field-label" style={{ marginTop: 14 }}>Learning objectives</label>
          <textarea
            className="text-input"
            rows={3}
            value={activity.learningObjectives.join("\n")}
            onChange={(e) => patch({ learningObjectives: e.target.value.split("\n") })}
          />
          <div className="builder-3col" style={{ marginTop: 14 }}>
            <div>
              <label className="field-label">Estimated time</label>
              <input className="text-input" value={activity.estimatedTime} onChange={(e) => patch({ estimatedTime: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Individual due</label>
              <input className="text-input" value={activity.individualDue} onChange={(e) => patch({ individualDue: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Grade value (pts)</label>
              <input
                className="text-input"
                type="number"
                value={activity.gradeValue}
                onChange={(e) => patch({ gradeValue: Number(e.target.value) })}
              />
            </div>
          </div>
        </Panel>
      )}

      {tab === "Questions" && (
        <>
          {activity.questions.map((q) => (
            <Panel key={q.n} className="q-builder-card">
              <span className="drag-handle">
                <Icon name="drag_indicator" />
              </span>
              <span className="q-num">{q.n}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <StatusBadge variant="outline">{q.type.replace("-", " ")}</StatusBadge>
                  {q.type === "handwritten-upload" && <StatusBadge variant="warning">Written work required</StatusBadge>}
                </div>
                <div style={{ color: "var(--ink)" }}>{q.prompt}</div>
              </div>
              <Icon name="content_copy" size="sm" style={{ color: "var(--muted-2)" }} />
              <Icon name="delete" size="sm" style={{ color: "var(--muted-2)" }} />
            </Panel>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <Button variant="secondary" icon="add">Add question</Button>
            <Button variant="ghost" icon="visibility" onClick={previewStudent}>Preview student view</Button>
          </div>
        </>
      )}

      {tab === "Individual prep" && (
        <Panel>
          <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginBottom: 8 }}>
            Individual prep is assessed for completeness, not correctness.
          </div>
          <SettingRow label="Require every question attempted" on={activity.prepSettings.requireAllAttempted} onToggle={(v) => prep("requireAllAttempted", v)} />
          <SettingRow label="Require written reasoning" on={activity.prepSettings.requireWrittenReasoning} onToggle={(v) => prep("requireWrittenReasoning", v)} />
          <SettingRow
            label="Require uploaded work on Q4"
            on={activity.prepSettings.requireUploadOnQ != null}
            onToggle={(v) => prep("requireUploadOnQ", v ? 4 : null)}
          />
          <SettingRow label="Require OCR confirmation" on={activity.prepSettings.requireOcrConfirmation} onToggle={(v) => prep("requireOcrConfirmation", v)} />
          <SettingRow
            label="Use AI completeness assessment"
            desc="Flags blank, illegible, or off-topic work for review"
            aiFlag
            on={activity.prepSettings.aiCompletenessAssessment}
            onToggle={(v) => prep("aiCompletenessAssessment", v)}
          />
          <SettingRow label="Hide correctness feedback" on={activity.prepSettings.hideCorrectnessFeedback} onToggle={(v) => prep("hideCorrectnessFeedback", v)} />
          <SettingRow label="Lock original after submission" on={activity.prepSettings.lockOriginalOnSubmit} onToggle={(v) => prep("lockOriginalOnSubmit", v)} />
          <SettingRow label="Award preparation credit" on={activity.prepSettings.awardPrepCredit} onToggle={(v) => prep("awardPrepCredit", v)} />
        </Panel>
      )}

      {tab === "Team stage" && (
        <Panel>
          <SettingRow label="Require individual completion before access" on={activity.teamSettings.requirePrepBeforeAccess} onToggle={(v) => team("requirePrepBeforeAccess", v)} />
          <SettingRow label="Show teammates' names" desc="Otherwise responses appear anonymously" on={activity.teamSettings.showTeammateNames} onToggle={(v) => team("showTeammateNames", v)} />
          <SettingRow label="Show original responses only" desc="Never expose in-progress or post-discussion work" on={activity.teamSettings.showOriginalsOnly} onToggle={(v) => team("showOriginalsOnly", v)} />
          <SettingRow label="Show original uploaded work & OCR" on={activity.teamSettings.showUploadsAndOcr} onToggle={(v) => team("showUploadsAndOcr", v)} />
          <SettingRow label="Release one question at a time" on={activity.teamSettings.releaseOneQuestionAtATime} onToggle={(v) => team("releaseOneQuestionAtATime", v)} />
          <SettingRow label="Allow instructor to pause the activity" on={activity.teamSettings.allowInstructorPause} onToggle={(v) => team("allowInstructorPause", v)} />
        </Panel>
      )}

      {tab === "Submission mode" && (
        <>
          <div className="mode-cards" style={{ marginBottom: 16 }}>
            <ModeCard
              mode="COLLECTIVE"
              active={activity.mode === "COLLECTIVE"}
              onSelect={() => patch({ mode: "COLLECTIVE" })}
              color="var(--stage-collective-fg)"
              bg="var(--stage-collective-bg)"
              desc="One collective response per team — students discuss their original responses and create one shared submission. It receives a team grade based on the rubric."
            />
            <ModeCard
              mode="INDIVIDUAL"
              active={activity.mode === "INDIVIDUAL"}
              onSelect={() => patch({ mode: "INDIVIDUAL" })}
              color="var(--stage-individual-fg)"
              bg="var(--stage-individual-bg)"
              desc="One post-discussion response per student — each student privately submits a final response, graded individually."
            />
          </div>

          <Panel>
            {activity.mode === "COLLECTIVE" ? (
              <>
                <SettingRow label="Allow all team members to edit" desc="Otherwise only a designated recorder edits" on={activity.collectiveSettings.allMembersEdit} onToggle={(v) => coll("allMembersEdit", v)} />
                <SettingRow label="Require participation confirmation" on={activity.collectiveSettings.requireParticipationConfirm} onToggle={(v) => coll("requireParticipationConfirm", v)} />
                <SettingRow label="Apply the same grade to all members" desc="Instructor may still adjust individually" on={activity.collectiveSettings.sameGradeForAll} onToggle={(v) => coll("sameGradeForAll", v)} />
                <SettingRow label="Show contribution & edit history" on={activity.collectiveSettings.showContributionHistory} onToggle={(v) => coll("showContributionHistory", v)} />
                <SettingRow label="Begin with a blank shared workspace" desc="No original answer is copied in automatically" on={activity.collectiveSettings.startBlankWorkspace} onToggle={(v) => coll("startBlankWorkspace", v)} />
              </>
            ) : (
              <>
                <SettingRow label="Require every student to submit" on={activity.individualSettings.requireEveryStudentSubmit} onToggle={(v) => indiv("requireEveryStudentSubmit", v)} />
                <SettingRow label="Keep post-discussion responses private" on={activity.individualSettings.keepFinalsPrivate} onToggle={(v) => indiv("keepFinalsPrivate", v)} />
                <SettingRow label="Limit students to one final submission" on={activity.individualSettings.oneSubmissionLimit} onToggle={(v) => indiv("oneSubmissionLimit", v)} />
                <SettingRow label="Release teammates' responses after grading" on={activity.individualSettings.releaseFinalsAfterGrading} onToggle={(v) => indiv("releaseFinalsAfterGrading", v)} />
                <SettingRow label="Use AI-suggested grading" aiFlag on={activity.individualSettings.aiSuggestedGrading} onToggle={(v) => indiv("aiSuggestedGrading", v)} />
              </>
            )}
          </Panel>
          <div style={{ marginTop: 12 }}>
            <Button variant="ghost" icon="visibility" onClick={previewStudent}>Preview how students see this</Button>
          </div>
        </>
      )}
    </>
  );
}

function ModeCard({
  mode,
  active,
  onSelect,
  color,
  bg,
  desc,
}: {
  mode: SubmissionMode;
  active: boolean;
  onSelect: () => void;
  color: string;
  bg: string;
  desc: string;
}) {
  return (
    <button
      className={`mode-card ${active ? "mode-card--selected" : ""}`}
      style={active ? ({ ["--sel-color"]: color, ["--sel-bg"]: bg } as React.CSSProperties) : undefined}
      onClick={onSelect}
    >
      <div className="mode-card__head">
        <Icon name={mode === "COLLECTIVE" ? "diversity_3" : "person"} style={{ color }} />
        {mode === "COLLECTIVE" ? "Collective" : "Individual"}
        {active && <StatusBadge variant="success" icon="check">Selected</StatusBadge>}
      </div>
      <div className="mode-card__desc">{desc}</div>
    </button>
  );
}
