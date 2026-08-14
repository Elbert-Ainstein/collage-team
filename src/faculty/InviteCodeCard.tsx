"use client";

// The invite code, as the person who hands it out sees it.
//
// The two codes stopped being the same kind of thing in 0030, so the card can no
// longer say one sentence about both. A STUDENT code is now the whole of
// enrolment: whoever presents it gets a roster row written for them, so the
// roster below is the code's OUTPUT and not its gate, and rotating is the only
// way to take the door off anyone. BOTH codes work that way now, by decision —
// but they are not equally cheap to leak. A student code buys a seat, a TF code
// buys
// eighty people's gradebook. Each card has to name which one it is showing, or
// she reasons about the strict one from the loose one and hands the wrong string
// to a lecture hall.
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
   * Rows on the roster this code admits that nobody has claimed yet, asked for
   * rather than counted here because only the screen holding that roster knows
   * it. For the TF card that is exactly who a rotation costs. For the student
   * card it is a floor, not the count — the code now admits people who are on
   * no list at all, and she is the only one who knows how many of those she
   * gave the old one to.
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

  // `waiting` bounded the whole cost of a rotation while the roster bounded who
  // could get in. It does not any more: the student code went to a lecture hall
  // and nothing here knows who wrote it down. So the student zero case must not
  // read as "this is free" — the one thing it can honestly promise is that the
  // people already in stay in.
  const studentCost =
    waiting === 0
      ? "The old code stops working the moment you replace it, for everyone holding it — not only the people on the roster below. Anyone already in stays in; anyone else needs the new one from you."
      : `${waiting} ${waiting === 1 ? `${one} you added by hand has` : `${many} you added by hand have`} not joined yet and would need the new code — so would anyone else holding the old one, on the roster or not. It stops working immediately. Anyone already in stays in.`;

  const tfCost =
    waiting === 0
      ? `Everyone on the ${rosterName} has already joined, so nobody is left needing a code — but the old one stops working the moment you replace it.`
      : `${waiting} ${waiting === 1 ? `${one} has` : `${many} have`} not joined yet, and every one of them needs the new code. ` +
        `The old one stops working immediately. Anyone already signed in stays in.`;

  const cost = student ? studentCost : tfCost;

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

      {/* The half that is not the code, and it says opposite things on the two
          cards. Whoever holds a student code is in, so the sentence has to point
          her at the only control she has left — replacing it — rather than at a
          roster that no longer stops anyone. */}
      <div className="fv-sub" style={{ maxWidth: "68ch", lineHeight: 1.55 }}>
        {student ? (
          <>
            Read it out or send it on. Anyone who enters it joins {courseName} as a student and
            appears on the roster below — you do not add them first, the code does it. So the code
            is the door: <strong>everyone you give it to can walk in</strong>, and replacing it is
            how you shut it.
          </>
        ) : (
          <>
            Hand this to your teaching fellows in person — never read it out, and do not put it
            anywhere it can be screenshotted. Anyone who enters it becomes a TF on {courseName}{" "}
            with the permissions set on this screen, which means they can{" "}
            <strong>read every student&rsquo;s work and change any grade</strong>. Removing them
            afterwards does not undo what they read or re-mark. Once your teaching fellows are in,
            replace this code — that is what shuts the door.
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
              // the code is redeemed from inside an account, so the message has
              // to walk them through making one first. Built at click time —
              // this component server-renders, and reading window during that
              // makes the two passes disagree.
              onClick={() =>
                void copy(
                  student
                    ? `Join ${courseName} at ${window.location.origin}/ck — create an account with ` +
                        `your name and your school email address, then enter the class code ${shown}. ` +
                        `That puts you on the roster; there is nothing to do beforehand.`
                    : `Join ${courseName} at ${window.location.origin}/ck — sign in with the email ` +
                        `address I have for you on the TF list, then enter the teaching fellow code ${shown}.`,
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
