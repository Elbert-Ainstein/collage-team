"use client";

// Team files — the team's drive: what they took photos of, and what they are
// working from. Every assignment has a folder made for it; a team makes the
// rest. Was: the photos a team takes of work they did together, filed
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
import { keepRecording, listKeptRecordings, recordingUrl, type Recording } from "@/checkins/audio";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  defaultTitle,
  createTeamFolder,
  deleteTeamFolder,
  deleteTeamResource,
  listAllTeamResources,
  listTeamFolders,
  renameTeamFolder,
  renameTeamResource,
  resourceUrls,
  uploadTeamResource,
  type TeamFolder,
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
  return n === 0 ? "Nothing yet" : `${n} ${n === 1 ? "item" : "items"}`;
}

/**
 * Can this be shown as a picture?
 *
 * The drive takes anything since 0035, and a PDF in an <img> is a broken icon
 * in a lightbox with no way out to the actual file. Mime first, because that is
 * what the upload recorded; the extension is the fallback for rows written
 * before there was one.
 */
function isImage(r: TeamResource): boolean {
  if (r.mime) return /^image\//i.test(r.mime);
  return /\.(png|jpe?g|webp|gif|heic|heif|avif)$/i.test(r.path);
}

/** "PDF", "CSV" — what to print on a tile that cannot be a thumbnail. */
function extensionLabel(r: TeamResource): string {
  return (/\.([a-z0-9]{1,5})$/i.exec(r.path)?.[1] ?? "file").toUpperCase();
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

/**
 * The back control is 12px type with no padding — a 17px tall target, and the
 * only way out of a folder — browser-back leaves too, since the deep-link work
 * made each page a history entry. The
 * padding buys a 45px one; the matching negative margin hands the space back,
 * so the margin box is the size it always was and the line lays out unchanged.
 */
const BACK_HIT = { padding: "14px 0", margin: "-14px 0" };

const CSS = `
.sv-tr-hit { display:flex; align-items:flex-start; gap:11px; flex:1; min-width:0;
  padding:0; border:0; background:transparent; color:inherit; font:inherit;
  text-align:left; cursor:pointer; }
.sv-tr-folder { transition: background 140ms ease, border-color 140ms ease; }
.sv-tr-folder:hover { background: var(--cream-300); }
.sv-tr-icon { position:relative;
  display:flex; align-items:center; justify-content:center; flex:none;
  border:0; padding:0; background:transparent; border-radius:999px;
  color:var(--neutral-400); transition: background 140ms ease, color 140ms ease; }
/* A 22px visual box is under the 24px floor and nowhere near a thumb. The halo
   is a pseudo-element, so the target grows and nothing in the row moves. It
   reaches down and out rather than up on a tile: the name field, which is the
   other thing anyone taps there, sits 4px above. */
.sv-tr-take .sv-tr-icon::after { content:""; position:absolute; inset:-10px; }
.sv-tr-tile .sv-tr-icon::after { content:""; position:absolute; inset:-4px -9px -12px -9px; }
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
.sv-tr-filetile { display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:6px; background:var(--cream-200); color:var(--muted-foreground);
  font-size:var(--text-xs); font-weight:var(--weight-semibold); letter-spacing:var(--tracking-wide);
  text-decoration:none; }
.sv-tr-filetile:hover { background:var(--cream-300); color:var(--foreground); }
.sv-tr-lightbox img { max-width:100%; max-height:100%; border-radius:var(--radius-lg); }
.sv-tr-audio { height:32px; max-width:260px; }

@media (max-width: 760px) {
  /* An <audio> is replaced content with a 300px intrinsic width and will not
     shrink past it, so beside a title and a stamp it pushed the ✕ off the
     screen — a recording added by mistake could not be taken back out at all.
     The player takes a line of its own; the calc leaves room for the ✕ and the
     gap beside it, and is also what guarantees the break, since a line holding
     anything else can never fit something this wide. */
  .sv-tr-take { flex-wrap:wrap; }
  .sv-tr-audio { flex:1 1 calc(100% - 36px); min-width:0; max-width:none; }
}
`;

/* ===================================================================== view */

/**
 * WHICH FOLDER IS OPEN, encoded so the id alone says what kind it is.
 *
 * The two kinds are not interchangeable: an assignment folder is the course's
 * and cannot be renamed or deleted, a team's own folder can be both. The open
 * folder is also persisted in the student app's session state, so it has to
 * survive a reload as a plain string.
 */
export type FolderKey = string;

const ASSIGNMENT_PREFIX = "act:";
const OWN_PREFIX = "own:";
/** The top level of the drive — files in no folder at all. */
export const DRIVE_ROOT = "root";

export const assignmentKey = (activityId: string): FolderKey => ASSIGNMENT_PREFIX + activityId;
export const ownFolderKey = (folderId: string): FolderKey => OWN_PREFIX + folderId;

/** What an open key points at, including the older bare activity id. */
function readKey(key: FolderKey): { kind: "activity" | "own" | "root"; id: string } {
  if (key === DRIVE_ROOT) return { kind: "root", id: "" };
  if (key.startsWith(ASSIGNMENT_PREFIX)) {
    return { kind: "activity", id: key.slice(ASSIGNMENT_PREFIX.length) };
  }
  if (key.startsWith(OWN_PREFIX)) return { kind: "own", id: key.slice(OWN_PREFIX.length) };
  // A key stored before folders existed was a bare activity id, and a student
  // with that in their session must not land on "not found".
  return { kind: "activity", id: key };
}

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

  const style = <style dangerouslySetInnerHTML={{ __html: CSS }} />;

  /**
   * The whole drive in one read: every file this team holds, and every folder
   * it made. Counting folders and listing the top level are the same question
   * asked twice, and asking the server once for both is what lets a folder
   * show a number without opening it.
   */
  const [files, setFiles] = useState<TeamResource[]>([]);
  const [folders, setFolders] = useState<TeamFolder[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    if (!teamId) return;
    try {
      const [rows, made] = await Promise.all([
        listAllTeamResources(teamId),
        listTeamFolders(teamId),
      ]);
      setFiles(rows);
      setFolders(made);
      setError(null);
    } catch (e) {
      setError(message(e, "Could not open your team's files."));
    }
  }, [teamId]);

  // Re-read when a folder closes too, so a file added inside is counted on the
  // way back out rather than leaving a stale number on the tile.
  useEffect(() => {
    void load();
  }, [load, openId]);

  const countIn = (f: TeamResource[]) => f.length;
  const inActivity = (id: string) => files.filter((r) => r.activity_id === id);
  const inFolder = (id: string) => files.filter((r) => r.folder_id === id);
  const loose = files.filter((r) => !r.activity_id && !r.folder_id);

  async function makeFolder() {
    const named = newName.trim();
    if (!named || !teamId) return;
    setBusy(true);
    try {
      await createTeamFolder(teamId, named);
      setNewName("");
      setNaming(false);
      await load();
    } catch (e) {
      setError(message(e, "That folder was not made."));
    } finally {
      setBusy(false);
    }
  }

  const open = openId == null ? null : readKey(openId);
  const openAssignment =
    open?.kind === "activity" ? assignments.find((a) => a.activity.id === open.id) ?? null : null;
  const openOwn = open?.kind === "own" ? folders.find((f) => f.id === open.id) ?? null : null;

  if (open && (openAssignment || openOwn || open.kind === "root")) {
    return (
      <Folder
        style={style}
        home={
          openAssignment
            ? { kind: "activity", assignment: openAssignment }
            : openOwn
              ? { kind: "own", folder: openOwn }
              : { kind: "root" }
        }
        teamId={teamId}
        courseId={enrolment.course.id}
        onBack={onBack}
        onViewAssignment={onViewAssignment}
        onRenamed={load}
      />
    );
  }

  return (
    <section className="sv-screen">
      {style}
      <div className="sv-head">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            flexWrap: "wrap",
            marginBottom: 6,
          }}
        >
          <h1 className="sv-h1">Team files</h1>
          <span className="sv-sub">
            Everything {teamName} keeps together. Every assignment has a folder of its own, and
            you can make your own for anything else. Visible to your team and your instructor.
          </span>
        </div>
      </div>

      <div className="sv-scroll">
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
      ) : (
        <>
        {error ? (
          <div className="sv-card" style={{ marginTop: 18, color: "var(--destructive)" }}>
            {error}
          </div>
        ) : null}

        {/* One row of verbs, above the folders. New folder is the only thing
            here that makes something; adding a file is done inside whichever
            folder it belongs in, which is the question a drive asks first. */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 18 }}>
          {naming ? (
            <>
              <input
                className="sv-in"
                autoFocus
                style={{ width: 220 }}
                placeholder="Folder name"
                aria-label="New folder name"
                value={newName}
                disabled={busy}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void makeFolder();
                  if (e.key === "Escape") {
                    setNaming(false);
                    setNewName("");
                  }
                }}
              />
              <button
                type="button"
                className="sv-btn primary sm"
                disabled={busy || !newName.trim()}
                onClick={() => void makeFolder()}
              >
                Create
              </button>
              <button
                type="button"
                className="sv-btn ghost sm"
                disabled={busy}
                onClick={() => {
                  setNaming(false);
                  setNewName("");
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="sv-btn outline sm" onClick={() => setNaming(true)}>
              <SIcon name="folder" size={16} />
              New folder
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="sv-btn outline sm"
            onClick={() => onOpen(DRIVE_ROOT)}
            title="Files that are not in any folder"
          >
            {loose.length ? `${countLabel(loose.length)} loose` : "Add files"}
          </button>
        </div>

        {folders.length ? (
          <>
            <div className="sv-eyebrow" style={{ marginTop: 20 }}>
              Your folders
            </div>
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fill, minmax(252px, 1fr))",
                marginTop: 8,
              }}
            >
              {folders.map((f) => (
                <div
                  key={f.id}
                  className="sv-tr-folder"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 11,
                    padding: "11px 12px",
                    border: "1px solid var(--neutral-200)",
                    borderLeft: "3px solid var(--muted-foreground)",
                    background: "var(--cream-100)",
                    borderRadius: "var(--radius-lg)",
                    boxShadow: "var(--shadow)",
                  }}
                >
                  <button
                    type="button"
                    className="sv-tr-hit"
                    onClick={() => onOpen(ownFolderKey(f.id))}
                    aria-label={`Open ${f.name}`}
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
                        className="sv-ellip"
                        style={{
                          display: "block",
                          fontFamily: "var(--font-serif)",
                          fontSize: "var(--text-base)",
                          fontWeight: "var(--weight-bold)",
                          letterSpacing: "var(--tracking-tight)",
                        }}
                      >
                        {f.name}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: "var(--text-xs)",
                          color: "var(--muted-foreground)",
                          marginTop: 2,
                        }}
                      >
                        {countLabel(countIn(inFolder(f.id)))}
                      </span>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <div className="sv-eyebrow" style={{ marginTop: folders.length ? 20 : 18 }}>
          Assignment folders
        </div>
        {assignments.length === 0 ? (
          <div className="sv-card" style={{ marginTop: 8 }}>
            <p
              style={{
                margin: 0,
                fontSize: "var(--text-sm)",
                color: "var(--muted-foreground)",
              }}
            >
              One appears here for every activity your instructor posts. Your own folders work
              without them.
            </p>
          </div>
        ) : (
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fill, minmax(252px, 1fr))",
            marginTop: 8,
          }}
        >
          {assignments.map((a) => {
            const accent = ACCENT[a.activity.type];
            const n = countIn(inActivity(a.activity.id));
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
        </>
      )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- one folder */

/**
 * The three things a folder can be.
 *
 * "activity" is the course's folder for one assignment — it also holds the
 * takes the team kept, because those belong to that activity and looking in
 * two places for "what we made for week 3" was the thing being fixed. "own" is
 * a folder the team made. "root" is the top of the drive: files in no folder,
 * which is where anything dragged in without a destination lands.
 */
type Home =
  | { kind: "activity"; assignment: Assignment }
  | { kind: "own"; folder: TeamFolder }
  | { kind: "root" };

function Folder({
  style,
  home,
  teamId,
  courseId,
  onBack,
  onViewAssignment,
  onRenamed,
}: {
  style: JSX.Element;
  home: Home;
  teamId: string | null;
  courseId: string;
  onBack: () => void;
  onViewAssignment: (id: string) => void;
  /** The root list re-reads after a rename or a delete in here. */
  onRenamed: () => void | Promise<void>;
}) {
  const assignment = home.kind === "activity" ? home.assignment : null;
  const activity = assignment?.activity ?? null;
  const ownFolder = home.kind === "own" ? home.folder : null;
  const title =
    activity?.title ?? ownFolder?.name ?? "Files in no folder";
  const [renaming, setRenaming] = useState(false);
  const [folderName, setFolderName] = useState(ownFolder?.name ?? "");
  /** window.confirm is suppressed here, so the delete takes two presses. */
  const [armedDrop, setArmedDrop] = useState(false);
  const [items, setItems] = useState<TeamResource[]>([]);
  const [takes, setTakes] = useState<Recording[]>([]);
  const [takeUrls, setTakeUrls] = useState<Record<string, string>>({});
  const [takeBusy, setTakeBusy] = useState<string | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What is being asked about. One question at a time, named so the dialog can say what goes. */
  const [pending, setPending] = useState<
    { kind: "photo"; item: TeamResource } | { kind: "take"; item: Recording } | null
  >(null);
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
      // The takes the team chose to keep, beside their photos. Both are "what
      // this team made for this activity", and looking in two places for that
      // was the thing to fix — so they load together and count together.
      const teamResultId = assignment?.teamResult?.id ?? null;
      const kept = teamResultId ? await listKeptRecordings([teamResultId]) : [];
      if (live.current) setTakes(kept);

      // One read for the team, filtered here. A drive's folders are three
      // different questions of the same table — under this activity, in this
      // folder, in none — and three queries for that is three ways to disagree.
      const all = await listAllTeamResources(teamId);
      const rows = all.filter((r) =>
        activity
          ? r.activity_id === activity.id
          : ownFolder
            ? r.folder_id === ownFolder.id
            : !r.activity_id && !r.folder_id,
      );
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
  }, [activity?.id, ownFolder?.id, teamId, assignment?.teamResult?.id]);

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

  async function saveFolderName() {
    if (!ownFolder) return;
    const named = folderName.trim();
    if (!named || named === ownFolder.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      await renameTeamFolder(ownFolder.id, named);
      setRenaming(false);
      await onRenamed();
    } catch (e) {
      if (live.current) setError(message(e, "That folder was not renamed."));
    } finally {
      if (live.current) setBusy(false);
    }
  }

  /**
   * Delete the folder, not what is in it — 0035 sets those files loose rather
   * than cascading. Armed first all the same: it is still a folder full of
   * work disappearing from where somebody left it.
   */
  async function dropFolder() {
    if (!ownFolder) return;
    if (!armedDrop) {
      setArmedDrop(true);
      return;
    }
    setBusy(true);
    try {
      await deleteTeamFolder(ownFolder.id);
      await onRenamed();
      onBack();
    } catch (e) {
      if (live.current) setError(message(e, "That folder was not deleted."));
    } finally {
      if (live.current) setBusy(false);
      setArmedDrop(false);
    }
  }

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
          {
            courseId,
            teamId,
            activityId: activity?.id ?? null,
            folderId: ownFolder?.id ?? null,
          },
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
      setPending(null);
      if (zoom?.id === r.id) setZoom(null);
    } catch (e) {
      if (live.current) setError(message(e, "That didn't delete."));
    } finally {
      if (live.current) setBusy(false);
    }
  }

  /**
   * Take a recording out of Team resources.
   *
   * NOT a delete. The audio belongs to the team's discussion and lives on the
   * activity, where its own Delete is — this only un-keeps it, which is why the
   * question says so. Making this destroy the take would mean two Delete
   * buttons for one file in two places, and the wrong one is the easy press.
   */
  async function unkeep(t: Recording) {
    setBusy(true);
    setError(null);
    try {
      await keepRecording(t.id, false);
      if (!live.current) return;
      setTakes((prev) => prev.filter((x) => x.id !== t.id));
      setPending(null);
    } catch (e) {
      if (live.current) setError(message(e, "That didn't save."));
    } finally {
      if (live.current) setBusy(false);
    }
  }

  const total = items.length + takes.length;

  return (
    <section className="sv-screen">
      {style}
      <div className="sv-head">
      <button type="button" className="sv-btn link" onClick={onBack} style={BACK_HIT}>
        <SIcon name="chevronLeft" size={15} />
        Team files
      </button>

      <div
        style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 10 }}
      >
        {activity ? (
          <span className={`sv-badge ${TYPE_BADGE[activity.type]}`}>
            {TYPE_LABEL[activity.type]}
          </span>
        ) : null}
        {/* A folder the team made is renamed in place, which is the only way a
            drive ever renames one. An assignment folder is the course's and
            carries the assignment's own name, so it has no pencil. */}
        {ownFolder && renaming ? (
          <>
            <input
              className="sv-in"
              autoFocus
              style={{ width: 240 }}
              aria-label="Folder name"
              value={folderName}
              disabled={busy}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveFolderName();
                if (e.key === "Escape") {
                  setRenaming(false);
                  setFolderName(ownFolder.name);
                }
              }}
            />
            <button
              type="button"
              className="sv-btn primary sm"
              disabled={busy || !folderName.trim()}
              onClick={() => void saveFolderName()}
            >
              Save
            </button>
          </>
        ) : (
          <h1 className="sv-h1">{title}</h1>
        )}
        <span style={{ flex: 1 }} />
        {/* Both actions in one non-shrinking box: as loose siblings of a
            wrapping row they break onto separate lines at narrow widths. */}
        <span style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          {activity ? (
            <button
              type="button"
              className="sv-btn outline sm"
              onClick={() => onViewAssignment(activity.id)}
            >
              View assignment
            </button>
          ) : null}
          {ownFolder && !renaming ? (
            <>
              <button
                type="button"
                className="sv-btn outline sm"
                onClick={() => {
                  setFolderName(ownFolder.name);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="sv-btn outline sm"
                style={{ color: "var(--destructive)" }}
                disabled={busy}
                title={
                  items.length
                    ? `The ${countLabel(items.length)} in here move to Team files — nothing is deleted.`
                    : undefined
                }
                onClick={() => void dropFolder()}
              >
                {armedDrop ? "Delete it?" : "Delete folder"}
              </button>
            </>
          ) : null}
          <input
            ref={picker}
            type="file"
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
                ? "Add files to this folder"
                : "You are not on a team yet, and these belong to a team."
            }
            onClick={() => picker.current?.click()}
          >
            <SIcon name="addPhoto" size={15} />
            {busy ? "Uploading…" : "Add files"}
          </button>
        </span>
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginTop: 5 }}>
        {assignment ? `${weekLabel(assignment)} · ` : ""}
        {countLabel(total)} · your team only
      </div>
      </div>

      <div className="sv-scroll">
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

      {takes.length ? (
        <div style={{ marginTop: 16 }}>
          <div className="sv-eyebrow" style={{ marginBottom: 8 }}>
            Recordings
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {takes.map((t) => (
              <div
                key={t.id}
                className="sv-card sv-tr-take"
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}
              >
                <span style={{ color: "var(--muted-foreground)", display: "flex" }}>
                  <SIcon name="mic" size={16} />
                </span>
                <span
                  className="sv-ellip"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--weight-semibold)",
                  }}
                >
                  {t.title || "Recording"}
                </span>
                <span className="sv-sub" style={{ fontSize: "var(--text-2xs)" }}>
                  {stamp(t.created_at)}
                </span>
                {takeUrls[t.id] ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <audio src={takeUrls[t.id]} controls className="sv-tr-audio" />
                ) : (
                  <button
                    type="button"
                    className="sv-btn outline sm"
                    disabled={takeBusy !== null}
                    onClick={() => {
                      setTakeBusy(t.id);
                      recordingUrl(t.path)
                        .then((url) => {
                          if (live.current) setTakeUrls((prev) => ({ ...prev, [t.id]: url }));
                        })
                        .catch((e) => {
                          if (live.current) setError(message(e, "That take could not be opened."));
                        })
                        .finally(() => {
                          if (live.current) setTakeBusy(null);
                        });
                    }}
                  >
                    <SIcon name="play" size={14} />
                    {takeBusy === t.id ? "Opening…" : "Play"}
                  </button>
                )}
                {/* Un-keeps it. The audio itself lives on the activity, with
                    its own Delete — this had no way out from here at all, so a
                    take added by mistake could only be undone by going back. */}
                <button
                  type="button"
                  className="sv-tr-icon"
                  style={{ width: 24, height: 24 }}
                  disabled={busy}
                  aria-label={`Remove ${t.title || "this recording"} from Team resources`}
                  title="Remove from Team resources. The recording itself stays on the activity."
                  onClick={() => setPending({ kind: "take", item: t })}
                >
                  <SIcon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="sv-sub" style={{ marginTop: 18 }}>
          Loading…
        </div>
      ) : items.length === 0 && takes.length === 0 ? (
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
            Add files
          </span>
          <span
            className="sv-sub"
            style={{ maxWidth: "48ch", textAlign: "center", lineHeight: 1.5 }}
          >
            A whiteboard photo, a sketch, the data you are working from, a draft — anything your
            team keeps together. Give each one a name so you can find it again.
          </span>
        </button>
      ) : (
        <div className="sv-tr-grid">
          {items.map((r) => {
            const url = urls.get(r.path);
            return (
              <div key={r.id} className="sv-tr-tile">
                {url && isImage(r) ? (
                  <button
                    type="button"
                    className="sv-tr-thumb"
                    onClick={() => setZoom(r)}
                    aria-label={`View ${r.title} full size`}
                    style={{ backgroundImage: `url("${url}")` }}
                  />
                ) : url ? (
                  // Not a picture, so there is nothing to zoom into: hand the
                  // file to whatever the student opens that kind of file with.
                  <a
                    className="sv-tr-thumb sv-tr-filetile"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${r.title}`}
                  >
                    <SIcon name="file" size={26} />
                    <span>{extensionLabel(r)}</span>
                  </a>
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
                      title={`Delete ${r.title}`}
                      onClick={() => setPending({ kind: "photo", item: r })}
                    >
                      <SIcon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>

      {pending ? (
        <ConfirmDialog
          title={
            pending.kind === "photo"
              ? `Delete “${pending.item.title}”?`
              : `Remove “${pending.item.title || "this recording"}”?`
          }
          body={
            pending.kind === "photo"
              ? "It goes for your whole team, and it cannot be undone. Nobody can get the photo back."
              : "It comes out of Team resources. The recording itself stays on the activity, where your team can still play it."
          }
          confirmLabel={pending.kind === "photo" ? "Delete" : "Remove"}
          busyLabel={pending.kind === "photo" ? "Deleting…" : "Removing…"}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() =>
            pending.kind === "photo" ? void remove(pending.item) : void unkeep(pending.item)
          }
        />
      ) : null}

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
