"use client";

// Team resources — the photos a team takes of work they did together, filed
// under the activity they came from.
//
// Everything here is real: the folders come from the activities the student can
// see, and the contents are rows in team_resources with images in a private
// bucket (0017). This screen used to render the handoff's seed copy behind a
// "Sample" badge, with an Add button that could not be pressed because there was
// nowhere to put a file. That is all gone.
//
// A team's photos are its own. RLS decides that; nothing here re-filters for
// security.

import { useCallback, useEffect, useRef, useState } from "react";
import { SIcon } from "./icons";
import { TYPE_LABEL, type ActivityType } from "@/checkins/types";
import type { Assignment, Enrolment } from "@/checkins/studentData";
import {
  countTeamResources,
  defaultTitle,
  deleteTeamResource,
  listTeamResources,
  renameTeamResource,
  resourceUrls,
  uploadTeamResource,
  type TeamResource,
} from "@/checkins/resources";

/* ------------------------------------------------------------------ type map */

const ACCENT: Record<ActivityType, string> = {
  challenge: "var(--orange-500)",
  combo: "var(--navy-700)",
  skills: "var(--sky-700)",
  amplify: "var(--lavender-600)",
};

const TYPE_BADGE: Record<ActivityType, string> = {
  challenge: "orange",
  combo: "sky",
  skills: "sky",
  amplify: "lavender",
};

/* ------------------------------------------------------------------- helpers */

function weekLabel(a: Assignment): string {
  const w = a.activity.week;
  return w == null ? a.activity.dates_label ?? "Unscheduled" : `Week ${w}`;
}

function countLabel(n: number): string {
  return n === 0 ? "Nothing yet" : `${n} ${n === 1 ? "photo" : "photos"}`;
}

/** "Aug 5, 2:14pm". Fixed locale, so a reload never re-labels a photo. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${day}, ${h}:${String(d.getMinutes()).padStart(2, "0")}${h24 >= 12 ? "pm" : "am"}`;
}

function sizeLabel(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const message = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

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
.sv-tr-icon:not(:disabled):hover { background: var(--neutral-100); color: var(--amber-700); }
.sv-tr-grid { display:grid; gap:12px; margin-top:16px;
  grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); }
.sv-tr-tile { display:flex; flex-direction:column; overflow:hidden;
  border:1px solid var(--neutral-200); border-radius:var(--radius-lg);
  background:var(--cream-100); box-shadow:var(--shadow); }
.sv-tr-thumb { display:block; width:100%; aspect-ratio:4/3; padding:0; border:0;
  background:var(--neutral-100) center/cover no-repeat; cursor:zoom-in; }
.sv-tr-name { width:100%; font:inherit; font-size:var(--text-xs);
  font-weight:var(--weight-semibold); color:var(--navy); background:transparent;
  border:1px solid transparent; border-radius:var(--radius-md); padding:4px 6px; }
.sv-tr-name:hover { border-color:var(--neutral-200); }
.sv-tr-name:focus { outline:none; border-color:var(--navy-700); background:var(--cream-200); }
.sv-tr-lightbox { position:fixed; inset:0; z-index:60; display:flex;
  align-items:center; justify-content:center; padding:28px; border:0;
  background:rgba(0,35,65,.72); cursor:zoom-out; }
.sv-tr-lightbox img { max-width:100%; max-height:100%; border-radius:var(--radius-lg); }
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

  const teamName = enrolment.team?.name ?? "your team";
  const teamId = enrolment.team?.id ?? null;
  const open = openId == null ? null : assignments.find((a) => a.activity.id === openId) ?? null;

  const style = <style dangerouslySetInnerHTML={{ __html: CSS }} />;

  // Folder counts. Re-read when the folder closes, so a photo added inside is
  // reflected on the way back out rather than a stale number.
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!teamId) return;
    let alive = true;
    countTeamResources(teamId)
      .then((c) => {
        if (alive) setCounts(c);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [teamId, openId]);

  if (open) {
    return (
      <Folder
        style={style}
        assignment={open}
        teamId={teamId}
        courseId={enrolment.course.id}
        onBack={onBack}
        onViewAssignment={onViewAssignment}
      />
    );
  }

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
          Photos of {teamName}&rsquo;s work, filed under the activity they came from. Visible to
          your team only.
        </span>
      </div>

      {!teamId ? (
        <div className="sv-card" style={{ marginTop: 18 }}>
          <div className="sv-eyebrow">No team yet</div>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: "var(--text-sm)",
              color: "var(--muted-foreground)",
              lineHeight: 1.6,
            }}
          >
            These belong to a team rather than to one person. Your instructor assigns teams —
            once you are on one, your folders appear here.
          </p>
        </div>
      ) : openId != null ? (
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
            const n = counts.get(a.activity.id) ?? 0;
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
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- one folder */

function Folder({
  style,
  assignment,
  teamId,
  courseId,
  onBack,
  onViewAssignment,
}: {
  style: JSX.Element;
  assignment: Assignment;
  teamId: string | null;
  courseId: string;
  onBack: () => void;
  onViewAssignment: (id: string) => void;
}) {
  const activity = assignment.activity;
  const [items, setItems] = useState<TeamResource[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [zoom, setZoom] = useState<TeamResource | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listTeamResources(activity.id, teamId);
      if (!live.current) return;
      setItems(rows);
      // One round trip for the whole set rather than one per thumbnail: a
      // session's photos would otherwise be a dozen separate requests.
      const signed = await resourceUrls(rows.map((r) => r.path));
      if (live.current) setUrls(signed);
    } catch (e) {
      if (live.current) setError(message(e, "Could not open this folder."));
    } finally {
      if (live.current) setLoading(false);
    }
  }, [activity.id, teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes the lightbox. A full-screen overlay whose only exit is a
  // click strands anyone not using a mouse.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  async function add(files: FileList | null) {
    if (!files?.length || !teamId) return;
    setBusy(true);
    setError(null);
    try {
      // Sequential rather than all at once: several phone photos over a room's
      // wifi is what times a batch out, and a failure part-way should leave the
      // ones before it uploaded rather than rolling everything back.
      for (const file of Array.from(files)) {
        await uploadTeamResource(
          { courseId, activityId: activity.id, teamId },
          file,
          defaultTitle(file),
        );
      }
    } catch (e) {
      if (live.current) setError(message(e, "That didn't upload."));
    } finally {
      // Whatever did land should appear either way.
      await load().catch(() => undefined);
      if (live.current) setBusy(false);
    }
  }

  async function rename(r: TeamResource, next: string) {
    const named = next.trim();
    // An empty label is a photo nobody can identify later, so a blank snaps
    // back to what it was rather than being written.
    if (!named || named === r.title) return;
    setItems((prev) => prev.map((x) => (x.id === r.id ? { ...x, title: named } : x)));
    try {
      await renameTeamResource(r.id, named);
    } catch (e) {
      if (!live.current) return;
      setError(message(e, "That rename didn't save."));
      setItems((prev) => prev.map((x) => (x.id === r.id ? { ...x, title: r.title } : x)));
    }
  }

  async function remove(r: TeamResource) {
    setBusy(true);
    setError(null);
    try {
      await deleteTeamResource(r);
      if (!live.current) return;
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      setArmedDelete(null);
      if (zoom?.id === r.id) setZoom(null);
    } catch (e) {
      if (live.current) setError(message(e, "That didn't delete."));
    } finally {
      if (live.current) setBusy(false);
    }
  }

  const total = items.length;

  return (
    <section>
      {style}
      <button type="button" className="sv-btn link" onClick={onBack}>
        <SIcon name="chevronLeft" size={15} />
        Team resources
      </button>

      <div
        style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 10 }}
      >
        <span className={`sv-badge ${TYPE_BADGE[activity.type]}`}>{TYPE_LABEL[activity.type]}</span>
        <h1 className="sv-h1">{activity.title}</h1>
        <span style={{ flex: 1 }} />
        {/* Both actions in one non-shrinking box: as loose siblings of a
            wrapping row they break onto separate lines at narrow widths. */}
        <span style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <button
            type="button"
            className="sv-btn outline sm"
            onClick={() => onViewAssignment(activity.id)}
          >
            View assignment
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="sv-btn primary sm"
            disabled={busy || !teamId}
            title={
              teamId
                ? "Add a photo of your team's work"
                : "You are not on a team yet, and these belong to a team."
            }
            onClick={() => picker.current?.click()}
          >
            <SIcon name="addPhoto" size={15} />
            {busy ? "Uploading…" : "Add photo"}
          </button>
        </span>
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginTop: 5 }}>
        {weekLabel(assignment)} · {countLabel(total)} · your team only
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "8px 10px",
            border: "1px solid var(--cream-500)",
            borderRadius: 8,
            fontSize: "var(--text-xs)",
            color: "var(--amber-700)",
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="sv-sub" style={{ marginTop: 18 }}>
          Loading…
        </div>
      ) : total === 0 ? (
        <button
          type="button"
          className="sv-dz"
          disabled={busy || !teamId}
          onClick={() => picker.current?.click()}
          style={{ width: "100%", marginTop: 18, font: "inherit", color: "inherit" }}
        >
          <SIcon name="addPhoto" size={28} />
          <span
            style={{ fontFamily: "var(--font-serif)", fontSize: "var(--text-lg)", fontWeight: 700 }}
          >
            Add a photo of your work
          </span>
          <span
            className="sv-sub"
            style={{ maxWidth: "48ch", textAlign: "center", lineHeight: 1.5 }}
          >
            A whiteboard, a sketch, a page of working — anything your team put together. Give each
            one a name so you can find it again.
          </span>
        </button>
      ) : (
        <div className="sv-tr-grid">
          {items.map((r) => {
            const url = urls.get(r.path);
            const armed = armedDelete === r.id;
            return (
              <div key={r.id} className="sv-tr-tile">
                {url ? (
                  <button
                    type="button"
                    className="sv-tr-thumb"
                    onClick={() => setZoom(r)}
                    aria-label={`View ${r.title} full size`}
                    style={{ backgroundImage: `url("${url}")` }}
                  />
                ) : (
                  <div className="sv-tr-thumb" aria-hidden="true" />
                )}

                <div style={{ padding: "8px 8px 10px" }}>
                  {/* The label IS the input. Naming a photo is the main thing
                      anyone does here, and hiding it behind an edit button makes
                      a folder full of "IMG_4821" the path of least resistance. */}
                  <input
                    className="sv-tr-name"
                    defaultValue={r.title}
                    aria-label={`Name of ${r.title}`}
                    maxLength={120}
                    onBlur={(e) => {
                      if (!e.target.value.trim()) e.target.value = r.title;
                      else void rename(r, e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        e.currentTarget.value = r.title;
                        e.currentTarget.blur();
                      }
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 4,
                      padding: "0 6px",
                    }}
                  >
                    {armed ? (
                      <button
                        type="button"
                        className="sv-btn link"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          justifyContent: "flex-start",
                          color: "var(--amber-700)",
                          fontSize: "var(--text-2xs)",
                        }}
                        disabled={busy}
                        onBlur={() => setArmedDelete(null)}
                        onClick={() => void remove(r)}
                      >
                        Delete for the whole team?
                      </button>
                    ) : (
                      <>
                        <span
                          className="sv-ellip"
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: "var(--text-2xs)",
                            color: "var(--muted-foreground)",
                          }}
                        >
                          {stamp(r.created_at)}
                          {r.size_bytes ? ` · ${sizeLabel(r.size_bytes)}` : ""}
                        </span>
                        <button
                          type="button"
                          className="sv-tr-icon"
                          style={{ width: 22, height: 22 }}
                          disabled={busy}
                          aria-label={`Delete ${r.title}`}
                          onClick={() => setArmedDelete(r.id)}
                        >
                          <SIcon name="close" size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {zoom && urls.get(zoom.path) ? (
        <button
          type="button"
          className="sv-tr-lightbox"
          aria-label={`Close ${zoom.title}`}
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls.get(zoom.path)} alt={zoom.title} />
        </button>
      ) : null}
    </section>
  );
}
