"use client";

// The invite code, as the person who hands it out sees it.
//
// Two facts have to arrive together or this card is worse than nothing: the code
// names the course, and whoever presents it must ALSO already be on that
// course's roster. Show the code alone and the instructor's first support
// conversation is with somebody she never imported, being told — correctly and
// uselessly — to go and ask her. So the roster half is not a tooltip. It sits
// under the code, and each card is placed on the screen that owns the roster it
// depends on, which is why there are two of these and not one.
//
// OWNER ONLY, and not because of this file. course_invites has a single RLS
// policy, owns_course(), and no student or TF read at all — a teaching fellow
// reaches Roster & teams, so the caller gates on can.isOwner, but if that gate
// were ever wrong the query would come back empty rather than leak a code.

import { useEffect, useState } from "react";
import {
  formatInviteCode,
  listInviteCodes,
  rotateInviteCode,
  type CourseInvite,
  type InviteKind,
} from "@/checkins/invites";
import { FIcon } from "./icons";

/** Nothing in the faculty tokens is monospaced, and a code read off a wall has to be. */
const MONO = 'ui-monospace, SFMono-Regular, Menlo, "Courier New", monospace';

export function InviteCodeCard({
  courseId,
  courseName,
  kind,
  waiting,
}: {
  courseId: string;
  courseName: string;
  kind: InviteKind;
  /**
   * People on the roster this code admits who have not signed in yet — which is
   * exactly the population a rotation costs, so it is asked for rather than
   * counted here. Only the screen holding that roster knows it.
   */
  waiting: number;
}): JSX.Element {
  const [invite, setInvite] = useState<CourseInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  /** window.confirm is suppressed here, and rotating has a cost worth reading first. */
  const [armed, setArmed] = useState(false);

  const student = kind === "student";
  const one = student ? "student" : "teaching fellow";
  const many = student ? "students" : "teaching fellows";
  const rosterName = student ? "roster" : "TF roster";

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listInviteCodes(courseId)
      .then((codes) => {
        if (!alive) return;
        setInvite(codes.find((c) => c.kind === kind) ?? null);
      })
      .catch((e: unknown) => {
        if (alive) setErr(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [courseId, kind]);

  const shown = invite ? formatInviteCode(invite.code) : "";

  async function copy(text: string, note: string) {
    try {
      await navigator.clipboard.writeText(text);
      setErr(null);
      setSaid(note);
      window.setTimeout(() => setSaid(null), 2500);
    } catch {
      // Clipboard access is refused outside a secure context and in some
      // locked-down browsers. The code is selectable text; say so rather than
      // leaving a button that silently does nothing.
      setErr("This browser would not let the page copy. Select the code and copy it by hand.");
    }
  }

  /**
   * Also how a code is created. rotate_invite_code revokes any live code and
   * inserts a fresh one, so on a course that has none — anything created after
   * 0029's backfill ran — the revoke half matches nothing and the insert is the
   * whole operation.
   */
  async function rotate() {
    setArmed(false);
    setBusy(true);
    setErr(null);
    setSaid(null);
    try {
      const fresh = await rotateInviteCode(courseId, kind);
      setInvite(fresh);
      setSaid(
        invite
          ? "New code. The old one stopped working — hand this one to anyone still waiting to join."
          : "Code created.",
      );
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const cost =
    waiting === 0
      ? `Everyone on the ${rosterName} has already joined, so nobody is left needing a code — but the old one stops working the moment you replace it.`
      : `${waiting} ${waiting === 1 ? `${one} has` : `${many} have`} not joined yet, and every one of them needs the new code. ` +
        `The old one stops working immediately. Anyone already signed in stays in.`;

  return (
    <div className="fv-card" style={{ padding: 16, marginBottom: 14 }}>
      <div className="fv-eyebrow">{student ? "Student invite code" : "Teaching fellow code"}</div>

      {loading ? (
        <div className="fv-sub" style={{ marginTop: 8 }}>
          Loading…
        </div>
      ) : invite ? (
        <div
          style={{
            fontFamily: MONO,
            fontSize: "clamp(26px, 7vw, 34px)",
            fontWeight: 600,
            letterSpacing: "0.08em",
            lineHeight: 1.2,
            margin: "8px 0 6px",
            color: "var(--fv-navy)",
            wordBreak: "break-all",
          }}
        >
          {shown}
        </div>
      ) : (
        <div className="fv-sub" style={{ marginTop: 8, lineHeight: 1.5 }}>
          This course has no {student ? "student" : "TF"} code yet.
        </div>
      )}

      {/* The half that is not the code. A leaked code lets nobody in on its own,
          and someone who was never imported is stopped by name — which is a
          feature until you hand the code to them not knowing it. */}
      <div className="fv-sub" style={{ maxWidth: "68ch", lineHeight: 1.55 }}>
        {student ? (
          <>
            Read it out or send it on. It admits a student to {courseName} only if the address they
            sign in with is <strong>already on the roster below</strong> — anyone you have not
            imported is turned away and told to ask you, however they came by the code.
          </>
        ) : (
          <>
            Send it to your teaching fellows privately — this one is not for the lecture hall. It
            admits someone to {courseName} as a TF, with the permissions set on this screen, only if
            their address is <strong>already on the TF roster</strong>.
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {invite ? (
          <>
            <button
              type="button"
              className="fv-btn outline sm"
              disabled={busy}
              onClick={() => void copy(shown, "Code copied.")}
            >
              <FIcon name="copy" size={15} />
              Copy code
            </button>
            <button
              type="button"
              className="fv-btn outline sm"
              disabled={busy}
              // The link is the app's front door, not a code-specific route:
              // redemption happens after signing in, because the roster is
              // matched against the address on the account. Built at click time
              // — this component server-renders, and reading window during that
              // makes the two passes disagree.
              onClick={() =>
                void copy(
                  `Join ${courseName} at ${window.location.origin}/ck — sign in with your school ` +
                    `email address, then enter ${student ? "the code" : "the teaching fellow code"} ${shown}.`,
                  "Message copied — paste it into your email.",
                )
              }
            >
              <FIcon name="copy" size={15} />
              Copy message
            </button>
          </>
        ) : null}

        {invite ? (
          armed ? null : (
            <button
              type="button"
              className="fv-btn ghost sm"
              disabled={busy}
              onClick={() => {
                setSaid(null);
                setArmed(true);
              }}
            >
              Replace this code
            </button>
          )
        ) : (
          <button type="button" className="fv-btn primary sm" disabled={busy} onClick={() => void rotate()}>
            <FIcon name="add" size={15} />
            {busy ? "Creating…" : "Create one"}
          </button>
        )}
      </div>

      {/* The cost, before the click that spends it — after would be a receipt
          for a decision she did not know she was making. */}
      {armed ? (
        <div
          style={{
            marginTop: 10,
            padding: "11px 12px",
            border: "1px solid var(--fv-neutral-200)",
            borderRadius: "var(--fv-r-md)",
            background: "var(--fv-cream-300)",
          }}
        >
          <div style={{ fontSize: "var(--fv-xs)", lineHeight: 1.6 }}>{cost}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="fv-btn sm"
              style={{ color: "var(--fv-destructive)" }}
              disabled={busy}
              onClick={() => void rotate()}
            >
              {busy ? "Replacing…" : "Replace it"}
            </button>
            <button
              type="button"
              className="fv-btn outline sm"
              disabled={busy}
              onClick={() => setArmed(false)}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : null}

      {said ? (
        <div className="fv-sub" style={{ marginTop: 10, lineHeight: 1.5 }}>
          {said}
        </div>
      ) : null}
      {err ? (
        <div
          style={{
            marginTop: 10,
            fontSize: "var(--fv-xs)",
            color: "var(--fv-destructive)",
            lineHeight: 1.5,
          }}
        >
          {err}
        </div>
      ) : null}
    </div>
  );
}
