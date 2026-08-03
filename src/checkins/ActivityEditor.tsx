"use client";

// Author one activity: title, who it is for, which week, what kind, the
// instructions, the files, and — later — a rubric.
//
// Scope and type are picked independently. Type only carries a label and an
// accent; SCOPE is what decides whether students get an individual view, a team
// view, or both, and which check-in columns the activity needs.

import { useRef, useState } from "react";
import { SIcon } from "@/student/icons";
import {
  ACTIVITY_TYPES,
  SCOPES,
  SCOPE_LABEL,
  TYPE_BADGE,
  TYPE_LABEL,
  scopeOf,
} from "./types";
import type { Activity, ActivityType, FileRef, Scope } from "./types";
import { fileSize } from "./ui";
import "@/student/student.css";

/** Everything the editor collects. The pillar turns this into a write. */
export interface ActivityDraft {
  title: string;
  scope: Scope;
  week: number;
  type: ActivityType;
  instructions: string;
  files: FileRef[];
}

export interface ActivityEditorProps {
  /** null when authoring a new activity. */
  activity: Activity | null;
  /** Week to start a new activity in. */
  initialWeek: number;
  /** Weeks that already have activities, so the dropdown offers them. */
  weeks: number[];
  busy: boolean;
  onCancel: () => void;
  onAssign: (draft: ActivityDraft) => void;
  /** Only offered for a saved activity — the submissions/progress workspace. */
  onOpenWorkspace: (() => void) | null;
}

const MAX_WEEK = 52;

const SCOPE_NOTE: Record<Scope, string> = {
  indiv: "Each student submits their own work. No team step.",
  team: "One shared submission per team.",
  both: "Students attempt it alone, then the team submits together.",
};

/** Options for the week dropdown: every week in use, plus the next one. */
function weekOptions(weeks: number[], current: number): number[] {
  const set = new Set(weeks.filter((w) => w >= 1 && w <= MAX_WEEK));
  set.add(current);
  const next = Math.min(MAX_WEEK, (weeks.length ? Math.max(...weeks) : 0) + 1);
  set.add(next);
  return [...set].sort((a, b) => a - b);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="sv-eyebrow" style={{ marginBottom: 7 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export function ActivityEditor({
  activity,
  initialWeek,
  weeks,
  busy,
  onCancel,
  onAssign,
  onOpenWorkspace,
}: ActivityEditorProps) {
  const [title, setTitle] = useState(activity?.title ?? "");
  const [scope, setScope] = useState<Scope>(activity ? scopeOf(activity) : "both");
  const [week, setWeek] = useState<number>(activity?.week ?? initialWeek);
  const [type, setType] = useState<ActivityType>(activity?.type ?? "challenge");
  const [instructions, setInstructions] = useState(activity?.source_text ?? "");
  const [files, setFiles] = useState<FileRef[]>(activity?.files ?? []);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const trimmed = title.trim();
  const canAssign = trimmed.length > 0 && !busy;
  const assigned = activity != null && activity.stage > 0;

  const addFiles = (picked: FileList | null) => {
    if (!picked || !picked.length) return;
    // Same name twice is a mistake, not an intent — the first one wins.
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name));
      const next = [...prev];
      for (const f of Array.from(picked)) {
        const name = f.name.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        next.push({ name, size: fileSize(f.size) });
      }
      return next;
    });
  };

  const submit = () => {
    if (!canAssign) return;
    onAssign({ title: trimmed, scope, week, type, instructions: instructions.trim(), files });
  };

  return (
    <section>
      <button type="button" className="sv-btn link" onClick={onCancel} style={{ gap: 4 }}>
        <SIcon name="chevronLeft" size={15} />
        All activities
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          margin: "12px 0 18px",
        }}
      >
        <span className={`sv-badge ${TYPE_BADGE[type]}`}>{TYPE_LABEL[type]}</span>
        <span className="sv-badge outline">{SCOPE_LABEL[scope]}</span>
        <span className="sv-sub">
          {activity ? (assigned ? "Assigned · Week " : "Draft · Week ") : "New activity · Week "}
          {week}
        </span>
      </div>

      <div style={{ display: "flex", gap: 22, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 380, display: "flex", flexDirection: "column", gap: 18 }}>
          <Field label="Title">
            <input
              className="sv-in title"
              autoFocus
              value={title}
              maxLength={160}
              placeholder="e.g. Momentum in Two Dimensions"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <Field label="Who it is for">
            <div className="sv-seg" role="group" aria-label="Who the activity is for">
              {SCOPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={"sv-segbtn" + (scope === s ? " on" : "")}
                  aria-pressed={scope === s}
                  onClick={() => setScope(s)}
                >
                  {SCOPE_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="sv-sub" style={{ marginTop: 7 }}>
              {SCOPE_NOTE[scope]}
            </div>
          </Field>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
            <Field label="Week">
              <select
                className="sv-in"
                style={{ width: 150 }}
                value={week}
                onChange={(e) => setWeek(Number(e.target.value))}
              >
                {weekOptions(weeks, week).map((w) => (
                  <option key={w} value={w}>
                    Week {w}
                    {weeks.includes(w) ? "" : " · new"}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Kind of activity">
              <div className="sv-seg" role="group" aria-label="Kind of activity">
                {ACTIVITY_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={"sv-segbtn" + (type === t ? " on" : "")}
                    aria-pressed={type === t}
                    onClick={() => setType(t)}
                  >
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <Field label="Instructions">
            <textarea
              className="sv-in"
              rows={7}
              style={{ resize: "vertical", lineHeight: 1.6 }}
              value={instructions}
              placeholder={
                "What students should do. Leave a blank line between paragraphs — this is the " +
                "description they read on the assignment."
              }
              onChange={(e) => setInstructions(e.target.value)}
            />
          </Field>

          <Field label="Files">
            <input
              ref={fileRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={"sv-dz" + (dragOver ? " over" : "")}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <SIcon name="attachFile" size={20} />
              <span
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-semibold)",
                  color: "var(--navy)",
                }}
              >
                Upload files
              </span>
              <span>
                Drop them here or click to choose. The file name and size are recorded with the
                activity; the file itself is not stored yet.
              </span>
            </button>

            {files.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {files.map((f) => (
                  <div
                    key={f.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 11px",
                      border: "1px solid var(--neutral-200)",
                      background: "var(--cream-100)",
                      borderRadius: "var(--radius-md)",
                      fontSize: "var(--text-xs)",
                    }}
                  >
                    <span style={{ color: "var(--muted-foreground)", display: "flex" }}>
                      <SIcon name="attachFile" size={15} />
                    </span>
                    <span className="sv-ellip" style={{ flex: 1, minWidth: 0 }}>
                      {f.name}
                    </span>
                    <span className="sv-num" style={{ color: "var(--muted-foreground)" }}>
                      {f.size ?? ""}
                    </span>
                    <button
                      type="button"
                      className="sv-btn link"
                      title={`Remove ${f.name}`}
                      onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Field>

          <div>
            <button
              type="button"
              className="sv-btn outline"
              disabled
              title="Not wired up yet — rubrics have no schema behind them."
            >
              <SIcon name="add" size={15} />
              Add rubric
            </button>
            <div className="sv-sub" style={{ marginTop: 7 }}>
              Optional. Coming next — an activity assigns fine without one.
            </div>
          </div>
        </div>

        <div style={{ width: 270, flex: "none", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="sv-card" style={{ padding: "16px 18px" }}>
            <div className="sv-eyebrow">Assign</div>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "var(--text-xs)",
                lineHeight: 1.55,
                color: "var(--muted-foreground)",
              }}
            >
              {assigned
                ? "This activity is already open to the class. Saving updates what they see."
                : "Adds the check-in columns this activity needs and opens it to the class."}
            </p>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                className="sv-btn primary full"
                disabled={!canAssign}
                onClick={submit}
              >
                {busy ? "Saving…" : assigned ? "Save changes" : "Assign"}
              </button>
              <button type="button" className="sv-btn outline full" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
            </div>
            {!trimmed && (
              <div className="sv-sub" style={{ marginTop: 8, textAlign: "center" }}>
                Give it a title first.
              </div>
            )}
          </div>

          {onOpenWorkspace && (
            <div className="sv-card" style={{ padding: "16px 18px" }}>
              <div className="sv-eyebrow">Running it</div>
              <p
                style={{
                  margin: "8px 0 14px",
                  fontSize: "var(--text-xs)",
                  lineHeight: 1.55,
                  color: "var(--muted-foreground)",
                }}
              >
                Submissions, the team discussion, progress through the loop, and posting to the
                gradebook.
              </p>
              <button type="button" className="sv-btn outline full" onClick={onOpenWorkspace}>
                Open workspace
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
