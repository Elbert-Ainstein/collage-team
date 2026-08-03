"use client";

// Team resources — index (handoff §5) and detail (handoff §6).
//
// The activities, weeks, titles and types on this screen are REAL: they come in
// on `assignments`, which the page loaded from Supabase. The resource CONTENT is
// not — there is no schema for whiteboard photos, recordings, notes or feedback
// PDFs yet, so every artifact below is the handoff's own seed copy and every
// section that carries it is marked "Sample" so nobody mistakes it for live data.
//
// Layout keys off SCOPE elsewhere in the student view; here type only picks the
// accent colour and the badge variant.

import { useState } from "react";
import { SIcon } from "./icons";
import { TYPE_ACCENT as ACCENT, TYPE_BADGE, TYPE_LABEL } from "@/checkins/types";
import type { Assignment, Enrolment } from "@/checkins/studentData";

/* ------------------------------------------------------ placeholder resources */

interface ResItem {
  icon: string;
  title: string;
  meta: string;
  /** Faculty-authored feedback: read-only, and the only row with a preview. */
  feedback?: boolean;
}

interface ResSection {
  label: string;
  items: ResItem[];
  /** null for faculty-authored sections, which students cannot add to. */
  add: { icon: string; label: string; hint: string } | null;
}

/**
 * The seed resource set from §6's table. Section counts are derived from these
 * arrays — never written down — so the index card, the meta line and each
 * section header can never drift apart.
 */
function sampleSections(a: Assignment): ResSection[] {
  return [
    {
      label: "Whiteboard photos",
      items: [
        { icon: "image", title: "Trial 1 setup", meta: "Thu 1:52pm" },
        { icon: "image", title: "Momentum table", meta: "Thu 2:14pm" },
        { icon: "image", title: "Loss estimate", meta: "Thu 2:31pm" },
      ],
      add: {
        icon: "addPhoto",
        label: "Add a whiteboard photo",
        hint: "Take a photo or drop an image",
      },
    },
    {
      label: "Audio",
      items: [{ icon: "mic", title: "Thursday session", meta: "12:41 · transcript attached" }],
      add: { icon: "mic", label: "Record the discussion", hint: "Or upload an existing recording" },
    },
    {
      label: "Notes & files",
      items: [],
      add: {
        icon: "attachFile",
        label: "Add a note or file",
        hint: "Working notes, data, a written summary",
      },
    },
    {
      label: "Feedback",
      items: [
        {
          icon: "assignment",
          title: `${activityRef(a)} feedback`,
          meta: "PDF · marked Thu 2:41pm",
          feedback: true,
        },
      ],
      add: null, // faculty-authored, read-only
    },
  ];
}

const SAMPLE_MARKS: { label: string; val: string }[] = [
  { label: "Participation", val: "Complete" },
  { label: "Accuracy", val: "4 / 5" },
  { label: "Collaboration", val: "5 / 5" },
];

/* ----------------------------------------------------------------- text bits */

function weekLabel(a: Assignment): string {
  return a.activity.week == null ? "Unscheduled" : `Week ${a.activity.week}`;
}

/** "Challenge 5" — the shared prefix the folder, the item and the PDF all use. */
function activityRef(a: Assignment): string {
  const t = TYPE_LABEL[a.activity.type];
  return a.activity.week == null ? t : `${t} ${a.activity.week}`;
}

function countLabel(n: number): string {
  return `${n} ${n === 1 ? "resource" : "resources"}`;
}

const NOT_WIRED = "Uploads are not wired up yet.";

/* -------------------------------------------------------------------- styles */

// Hover and disabled states the spec calls out, which inline styles cannot express.
const CSS = `
.sv-tr-hit { display:flex; align-items:flex-start; gap:11px; flex:1; min-width:0;
  padding:0; border:0; background:transparent; color:inherit; font:inherit;
  text-align:left; cursor:pointer; }
.sv-tr-folder { transition: background 140ms ease, border-color 140ms ease; }
.sv-tr-folder:hover { background: var(--cream-300); }
.sv-tr-icon { display:flex; align-items:center; justify-content:center; flex:none;
  border:0; padding:0; background:transparent; border-radius:999px;
  color:var(--neutral-400); transition: background 140ms ease, color 140ms ease; }
.sv-tr-icon:disabled { opacity:.55; cursor:default; }
.sv-tr-icon:not(:disabled) { cursor:pointer; }
.sv-tr-icon:not(:disabled):hover { background: var(--neutral-100); color: var(--navy); }
.sv-tr-row { display:flex; align-items:center; gap:13px; padding:11px 12px;
  border-radius:var(--radius-md); width:100%; text-align:left; }
button.sv-tr-row { border:0; background:transparent; color:inherit; font:inherit;
  cursor:pointer; transition: background 140ms ease; }
button.sv-tr-row:hover { background: var(--cream-400); }
.sv-tr-add:disabled { opacity:.6; cursor:default; }
.sv-tr-tile { display:flex; align-items:center; justify-content:center;
  width:34px; height:34px; flex:none; border-radius:var(--radius-md); }
`;

/* ===================================================================== view */

export function TeamResources(props: {
  enrolment: Enrolment;
  assignments: Assignment[];
  openId: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
  onViewAssignment: (id: string) => void;
}) {
  const { enrolment, assignments, openId, onOpen, onBack, onViewAssignment } = props;
  // §6 state: the preview pane starts open, and the feedback row toggles it.
  const [pdfOpen, setPdfOpen] = useState(true);

  const teamName = enrolment.team?.name ?? "your team";
  const open = openId == null ? null : assignments.find((a) => a.activity.id === openId) ?? null;

  const style = <style dangerouslySetInnerHTML={{ __html: CSS }} />;

  /* -------------------------------------------------------------- §5 index */
  if (openId == null || open == null) {
    return (
      <section>
        {style}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            flexWrap: "wrap",
            marginBottom: 6,
          }}
        >
          <h1 className="sv-h1">Team resources</h1>
          <span className="sv-sub">
            Everything {teamName} has made, filed under the activity it came from. Visible to your
            team only.
          </span>
          <span className="sv-badge outline" title="Resource counts are seed copy, not live data.">
            Sample
          </span>
        </div>

        {open == null && openId != null ? (
          <div className="sv-card" style={{ marginTop: 18 }}>
            <div className="sv-eyebrow">Not found</div>
            <p style={{ margin: "8px 0 0", fontSize: "var(--text-sm)" }}>
              That folder is no longer in your session.
            </p>
            <button
              type="button"
              className="sv-btn outline sm"
              style={{ marginTop: 14 }}
              onClick={onBack}
            >
              Back to team resources
            </button>
          </div>
        ) : assignments.length === 0 ? (
          <div className="sv-card" style={{ marginTop: 18 }}>
            <div className="sv-eyebrow">Nothing yet</div>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "var(--text-sm)",
                color: "var(--muted-foreground)",
              }}
            >
              Folders appear here once your instructor posts an activity.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fill, minmax(252px, 1fr))",
              marginTop: 18,
            }}
          >
            {assignments.map((a) => {
              const accent = ACCENT[a.activity.type];
              const n = sampleSections(a).reduce((sum, s) => sum + s.items.length, 0);
              return (
                <div
                  key={a.activity.id}
                  className="sv-tr-folder"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 11,
                    padding: "11px 12px",
                    border: "1px solid var(--neutral-200)",
                    borderLeft: `3px solid ${accent}`,
                    background: "var(--cream-100)",
                    borderRadius: "var(--radius-lg)",
                    boxShadow: "var(--shadow)",
                  }}
                >
                  <button
                    type="button"
                    className="sv-tr-hit"
                    onClick={() => onOpen(a.activity.id)}
                    // The title deliberately omits the activity number — the week
                    // line below already carries it.
                    aria-label={`Open ${a.activity.title} resources`}
                  >
                    <span
                      style={{
                        display: "flex",
                        flex: "none",
                        color: "var(--muted-foreground)",
                        marginTop: 1,
                      }}
                    >
                      <SIcon name="folder" size={20} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: "var(--text-2xs)",
                          letterSpacing: "var(--tracking-wide)",
                          textTransform: "uppercase",
                          fontWeight: "var(--weight-semibold)",
                          color: accent,
                        }}
                      >
                        {TYPE_LABEL[a.activity.type]}
                      </span>
                      <span
                        className="sv-ellip"
                        style={{
                          display: "block",
                          fontFamily: "var(--font-serif)",
                          fontSize: "var(--text-base)",
                          fontWeight: "var(--weight-bold)",
                          letterSpacing: "var(--tracking-tight)",
                          marginTop: 1,
                        }}
                      >
                        {a.activity.title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: "var(--text-xs)",
                          color: "var(--muted-foreground)",
                          marginTop: 2,
                        }}
                      >
                        {weekLabel(a)} · {countLabel(n)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="sv-tr-icon"
                    style={{ width: 24, height: 24, marginTop: 1 }}
                    disabled
                    title="Folder actions are not built yet — there is no menu to open."
                    aria-label="Folder actions"
                  >
                    <SIcon name="moreVert" size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  /* ------------------------------------------------------------- §6 detail */
  const activity = open.activity;
  const sections = sampleSections(open);
  const total = sections.reduce((sum, s) => sum + s.items.length, 0);
  const ref = activityRef(open);
  const fileName = `${ref} feedback`;
  const courseRef = enrolment.course.code ?? enrolment.course.name;

  return (
    <section>
      {style}
      <button type="button" className="sv-btn link" onClick={onBack}>
        <SIcon name="chevronLeft" size={15} />
        Team resources
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 10,
        }}
      >
        <span className={`sv-badge ${TYPE_BADGE[activity.type]}`}>{TYPE_LABEL[activity.type]}</span>
        <h1 className="sv-h1">{activity.title}</h1>
        <span style={{ flex: 1 }} />
        {/* Both actions live in one non-shrinking flex box: as loose siblings of a
            wrapping row they break onto separate lines at narrow widths. */}
        <span style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <button
            type="button"
            className="sv-btn outline sm"
            onClick={() => onViewAssignment(activity.id)}
          >
            View assignment
          </button>
          <button
            type="button"
            className="sv-btn primary sm"
            disabled
            title={`${NOT_WIRED} There is no file picker or storage bucket behind this button.`}
          >
            <SIcon name="add" size={15} />
            Add resource
          </button>
        </span>
      </div>
      <div
        style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginTop: 5 }}
      >
        {weekLabel(open)} · {countLabel(total)} · your team only
      </div>

      <div
        style={{
          display: "flex",
          gap: 20,
          alignItems: "flex-start",
          flexWrap: "wrap",
          marginTop: 18,
        }}
      >
        {/* ------------------------------------------------- resource panel */}
        <div
          style={{
            width: pdfOpen ? 320 : "100%",
            maxWidth: "100%",
            flex: "none",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            background: "var(--cream-100)",
            border: "1px solid var(--neutral-200)",
            borderRadius: "var(--radius-lg)",
            padding: 8,
            boxShadow: "var(--shadow)",
          }}
        >
          {sections.map((s, i) => (
            <div
              key={s.label}
              style={{
                padding: i === 0 ? "0 0 14px" : "14px 0",
                borderTop: i === 0 ? undefined : "1px solid var(--neutral-200)",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 8px" }}
              >
                <span className="sv-eyebrow" style={{ flex: 1 }}>
                  {s.label}
                </span>
                <span className="sv-badge outline" title="Seed copy — no resource storage yet.">
                  Sample
                </span>
                <span
                  className="sv-num"
                  style={{ fontSize: "var(--text-2xs)", color: "var(--muted-foreground)" }}
                >
                  {s.items.length}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {s.items.map((r) =>
                  r.feedback ? (
                    <button
                      key={r.title}
                      type="button"
                      className="sv-tr-row"
                      style={{ background: pdfOpen ? "var(--cream-400)" : "transparent" }}
                      onClick={() => setPdfOpen((v) => !v)}
                      aria-expanded={pdfOpen}
                    >
                      <ResBody item={r} />
                    </button>
                  ) : (
                    // Photos and recordings have no preview yet, so these rows are
                    // content rather than controls — no dead click targets.
                    <div key={r.title} className="sv-tr-row">
                      <ResBody item={r} />
                    </div>
                  ),
                )}

                {s.add ? (
                  <button
                    type="button"
                    className="sv-tr-row sv-tr-add"
                    disabled
                    title={`${NOT_WIRED} ${s.add.label} needs a file picker and a storage bucket first.`}
                  >
                    <span
                      className="sv-tr-tile"
                      style={{
                        border: "1px dashed var(--neutral-300)",
                        background: "transparent",
                        color: "var(--muted-foreground)",
                      }}
                    >
                      <SIcon name={s.add.icon} size={18} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: "var(--text-sm)",
                          fontWeight: "var(--weight-semibold)",
                          color: "var(--navy)",
                        }}
                      >
                        {s.add.label}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: "var(--text-xs)",
                          color: "var(--muted-foreground)",
                          marginTop: 2,
                        }}
                      >
                        {s.add.hint}
                      </span>
                    </span>
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {/* ---------------------------------------------------- preview pane */}
        {pdfOpen ? (
          <div
            style={{
              flex: 1,
              minWidth: 320,
              alignSelf: "stretch",
              display: "flex",
              flexDirection: "column",
              background: "var(--cream-100)",
              border: "1px solid var(--neutral-200)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderBottom: "1px solid var(--neutral-200)",
              }}
            >
              <span className="sv-ellip" style={{ flex: 1, minWidth: 0, fontSize: "var(--text-sm)" }}>
                {fileName} <span style={{ color: "var(--muted-foreground)" }}>· PDF</span>
              </span>
              <span className="sv-badge outline" title="Seed copy — no generated PDF yet.">
                Sample
              </span>
              <button
                type="button"
                className="sv-tr-icon"
                style={{ width: 28, height: 28 }}
                disabled
                title="There is no stored PDF to open — feedback documents are not generated yet."
                aria-label="Open in new tab"
              >
                <SIcon name="openInNew" size={16} />
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "34px 44px 44px",
                fontFamily: "var(--font-serif)",
                color: "var(--navy)",
              }}
            >
              <div className="sv-eyebrow" style={{ fontFamily: "var(--font-sans)" }}>
                {courseRef} · {weekLabel(open)}
              </div>
              {/* Same activity named by the folder, the feedback item and this heading. */}
              <h2
                style={{
                  margin: "8px 0 0",
                  fontSize: 26,
                  fontWeight: "var(--weight-bold)",
                  letterSpacing: "var(--tracking-tight)",
                }}
              >
                {ref} — {activity.title}
              </h2>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--muted-foreground)",
                  marginTop: 4,
                  fontFamily: "var(--font-sans)",
                }}
              >
                {teamName} · marked Thu 2:41pm
              </div>

              <p style={{ margin: "22px 0 0", fontSize: 17, lineHeight: 1.65, maxWidth: "62ch" }}>
                Your momentum accounting held up across all three trials, and the group caught the
                8% discrepancy without prompting. That was the point of the exercise.
              </p>
              <p style={{ margin: "16px 0 0", fontSize: 17, lineHeight: 1.65, maxWidth: "62ch" }}>
                Where it stalled was the explanation. Friction was named but never quantified, so
                the discrepancy stayed a label rather than a number. Estimate the friction term next
                time, even roughly, and the argument closes.
              </p>

              <h3
                style={{
                  margin: "26px 0 0",
                  fontSize: 19,
                  fontWeight: "var(--weight-bold)",
                  letterSpacing: "var(--tracking-tight)",
                }}
              >
                Marks
              </h3>
              <div style={{ marginTop: 12, fontFamily: "var(--font-sans)" }}>
                {SAMPLE_MARKS.map((m) => (
                  <div
                    key={m.label}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 12,
                      padding: "9px 0",
                      borderTop: "1px solid var(--neutral-200)",
                    }}
                  >
                    <span style={{ flex: 1, fontSize: "var(--text-sm)" }}>{m.label}</span>
                    <span
                      className="sv-num"
                      style={{
                        fontSize: "var(--text-sm)",
                        fontWeight: "var(--weight-semibold)",
                      }}
                    >
                      {m.val}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Tile + title + meta — shared by the interactive feedback row and the static ones. */
function ResBody({ item }: { item: ResItem }) {
  return (
    <>
      <span
        className="sv-tr-tile"
        style={{ background: "var(--neutral-100)", color: "var(--muted-foreground)" }}
      >
        <SIcon name={item.icon} size={19} />
      </span>
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <span
          className="sv-ellip"
          style={{
            display: "block",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-semibold)",
          }}
        >
          {item.title}
        </span>
        <span
          style={{
            display: "block",
            fontSize: "var(--text-xs)",
            color: "var(--muted-foreground)",
            marginTop: 2,
          }}
        >
          {item.meta}
        </span>
      </span>
    </>
  );
}
