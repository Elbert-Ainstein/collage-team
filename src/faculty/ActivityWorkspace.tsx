"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { activityById, memberById, useStore } from "@/store";
import { Icon } from "@/components";
import { TabHub } from "@/shell/TabHub";
import { Stub } from "@/routes/Stub";
import { SEED_TEAM_3 } from "@/seed";
import {
  addDiscussion,
  addResource,
  getDiscussions,
  getProgressReport,
  getResources,
  regenerateProgressReport,
} from "@/services/teamTabService";
import type { ResourceKind } from "@/types";

const TEAM = SEED_TEAM_3;

// Per-activity workspace — team-centric. An uploaded activity is just a PDF; the
// tabs are the Team Tab features (no builder, no submission/grading pipeline).
export function ActivityWorkspace() {
  const params = useParams();
  const id = String(params.id);
  const setCurrent = useStore((s) => s.setCurrentActivity);
  const activity = useStore((s) => activityById(s, id));

  useEffect(() => {
    if (activity) setCurrent(id);
  }, [id, activity, setCurrent]);

  if (!activity) return <Stub title="Activity not found" subtitle="This activity may have been removed." />;

  return (
    <>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-[30px] font-semibold text-black/80">{activity.title}</h1>
          <p className="mt-1 text-sm text-muted-fg">
            Uploaded activity · {TEAM.name} · team workspace
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-lg border border-line bg-cream-100 px-3 py-1.5 text-xs text-navy/70">
          <Icon name="picture_as_pdf" size="sm" /> {activity.source?.filename ?? "source.pdf"}
        </span>
      </div>

      <TabHub
        tabs={[
          { key: "source", label: "Source", render: () => <SourceTab activityId={id} /> },
          { key: "team", label: "Team", render: () => <TeamTab /> },
          { key: "resources", label: "Resources", render: () => <ResourcesTab activityId={id} /> },
          { key: "discussion", label: "Discussion", render: () => <DiscussionTab activityId={id} /> },
          { key: "progress", label: "Progress", render: () => <ProgressTab activityId={id} /> },
        ]}
      />
    </>
  );
}

/* ---- Source: the uploaded PDF ---- */
function SourceTab({ activityId }: { activityId: string }) {
  const activity = useStore((s) => activityById(s, activityId))!;
  const src = activity.source;
  return (
    <div className="rounded-2xl border border-line bg-cream-100 p-6">
      <div className="mx-auto max-w-2xl rounded-xl border border-line bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="flex items-center gap-2 text-sm font-medium text-navy">
            <Icon name="picture_as_pdf" size="sm" className="text-[#b91c1c]" /> {src?.filename ?? "source.pdf"}
          </span>
          <span className="text-xs text-muted-fg">{src?.pages ?? 1} pages</span>
        </div>
        <div className="space-y-4 px-8 py-8 font-serif text-[15px] leading-relaxed text-black/80">
          <p className="text-xl font-semibold">{activity.title}</p>
          <p className="text-muted-fg">{activity.objective}</p>
          <p>{activity.description}</p>
          <p className="text-muted-fg">
            Your team will evaluate the structural options for a 90 m span over a deep gorge, justify a load-bearing
            decision, and back it with a calculation. Use this brief as your shared source of truth.
          </p>
          <div className="h-24 rounded-lg bg-[repeating-linear-gradient(180deg,#f3efe4,#f3efe4_10px,transparent_10px,transparent_22px)]" />
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted-fg">
        The original upload is shown as-is — there is no builder for team activities.
      </p>
    </div>
  );
}

/* ---- Team: view members + roles ---- */
function TeamTab() {
  return (
    <div className="rounded-2xl border border-line bg-cream-100 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif text-xl font-semibold text-navy">{TEAM.name}</h2>
        <button className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-navy hover:bg-cream-300">
          <Icon name="edit" size="sm" /> Edit team
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {TEAM.memberIds.map((mid) => {
          const m = memberById(useStore.getState(), mid);
          if (!m) return null;
          return (
            <div key={mid} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ background: m.avatarTint }}>
                {m.initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-navy">{m.name}</div>
                <div className="text-xs text-muted-fg">{TEAM.recorderId === mid ? "Recorder" : "Member"}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Resources: proposal / report / contract / whiteboard ---- */
const RESOURCE_META: Record<ResourceKind, { icon: string; label: string; tint: string }> = {
  proposal: { icon: "description", label: "Proposal", tint: "bg-sky/40 text-[#0369a1]" },
  report: { icon: "summarize", label: "Report", tint: "bg-[#e7f5ef] text-[#0e7c57]" },
  contract: { icon: "handshake", label: "Team agreement", tint: "bg-brand-purple/25 text-[#7c3aed]" },
  whiteboard: { icon: "photo_camera", label: "Whiteboard", tint: "bg-[#fff4e5] text-[#b45309]" },
};

function ResourcesTab({ activityId }: { activityId: string }) {
  const actor = useStore((s) => s.currentStudentId);
  useStore((s) => s.teamResources);
  const resources = getResources(TEAM.id, activityId);

  function add(kind: ResourceKind) {
    const meta = RESOURCE_META[kind];
    addResource(TEAM.id, activityId, kind, `${meta.label} — ${TEAM.name}.pdf`, actor);
  }

  return (
    <div className="rounded-2xl border border-line bg-cream-100 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl font-semibold text-navy">Team resources</h2>
          <p className="text-xs text-muted-fg">Proposal, report, team agreement, and whiteboard photos — each add feeds the progress report.</p>
        </div>
        <div className="flex gap-2">
          {(Object.keys(RESOURCE_META) as ResourceKind[]).map((k) => (
            <button key={k} onClick={() => add(k)} className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-navy hover:bg-cream-300">
              <Icon name="add" size="sm" /> {RESOURCE_META[k].label}
            </button>
          ))}
        </div>
      </div>
      {resources.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-[#cfc6ac] bg-page py-10 text-center text-sm text-muted-fg">
          No resources yet — add a proposal, report, team agreement, or whiteboard photo.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {resources.map((r) => {
            const meta = RESOURCE_META[r.kind];
            const m = memberById(useStore.getState(), r.addedBy);
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${meta.tint}`}>
                  <Icon name={meta.icon} size="sm" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-navy">{r.name}</div>
                  <div className="text-xs text-muted-fg">
                    {meta.label} · added by {m?.name.split(" ")[0] ?? "—"} · {new Date(r.addedAt).toLocaleDateString()}
                  </div>
                </div>
                <button className="rounded-lg p-1.5 text-navy/50 hover:bg-navy/5"><Icon name="download" size="sm" /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---- Discussion: audio recordings ---- */
function fmt(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
function DiscussionTab({ activityId }: { activityId: string }) {
  const actor = useStore((s) => s.currentStudentId);
  useStore((s) => s.audioDiscussions);
  const discussions = getDiscussions(TEAM.id, activityId);

  return (
    <div className="rounded-2xl border border-line bg-cream-100 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl font-semibold text-navy">Team discussions</h2>
          <p className="text-xs text-muted-fg">Record or upload the team's discussion audio — faculty can play it back.</p>
        </div>
        <button
          onClick={() => addDiscussion(TEAM.id, activityId, "New discussion", 240, actor)}
          className="flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-cream hover:bg-navy-deep"
        >
          <Icon name="mic" size="sm" /> Record / upload
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {discussions.map((d) => {
          const m = memberById(useStore.getState(), d.recordedBy);
          return (
            <div key={d.id} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
              <button className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-cream"><Icon name="play_arrow" size="sm" /></button>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-navy">{d.title}</div>
                <div className="text-xs text-muted-fg">{m?.name.split(" ")[0] ?? "—"} · {new Date(d.at).toLocaleDateString()}</div>
              </div>
              <span className="text-xs tabular-nums text-muted-fg">{fmt(d.durationSec)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Progress: the AI report ---- */
function ProgressTab({ activityId }: { activityId: string }) {
  useStore((s) => s.progressReports);
  const report = getProgressReport(TEAM.id, activityId);
  const [busy, setBusy] = useState(false);

  function regen() {
    setBusy(true);
    regenerateProgressReport(TEAM.id, activityId);
    setTimeout(() => setBusy(false), 400);
  }

  return (
    <div className="rounded-2xl border border-line bg-cream-100 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[#ff6713]">✦</span>
          <h2 className="font-serif text-xl font-semibold text-navy">Project progress report</h2>
          <span className="rounded-full bg-brand-purple/25 px-2 py-0.5 text-[10px] font-medium text-[#7c3aed]">Auto-generated</span>
        </div>
        <button onClick={regen} className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-navy hover:bg-cream-300">
          <Icon name="refresh" size="sm" /> {busy ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
      {report ? (
        <>
          <div className="mb-4 flex items-center gap-3">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#eae4d4]">
              <div className="h-full rounded-full bg-[#0e7c57]" style={{ width: `${report.percentComplete}%` }} />
            </div>
            <span className="text-sm font-semibold text-navy">{report.percentComplete}%</span>
          </div>
          <p className="text-sm leading-relaxed text-black/80">{report.summary}</p>
          <ul className="mt-4 flex flex-col gap-2">
            {report.highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-navy">
                <Icon name={h.startsWith("Open:") ? "radio_button_unchecked" : "check_circle"} size="sm" className={h.startsWith("Open:") ? "mt-0.5 text-muted-fg" : "mt-0.5 text-[#0e7c57]"} />
                {h}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-fg">
            ✦ Drafted by AI from the team's resources &amp; discussions — reviewable, never auto-authoritative.
          </p>
        </>
      ) : (
        <div className="py-8 text-center text-sm text-muted-fg">No report yet — add resources or discussions to generate one.</div>
      )}
    </div>
  );
}
