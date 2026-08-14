"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/checkins/AuthGate";
import { FacultyApp } from "@/faculty/FacultyApp";
import { StudentApp, JoinPanel, JoinScreen } from "@/student/StudentApp";
import { claimStudentRows, getEnrolment, getRole } from "@/checkins/studentData";
import { claimTFRows, myTFCourses } from "@/faculty/facultyData";
import { listCourses } from "@/checkins/data";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import type { Role } from "@/checkins/types";

/**
 * Which app this account gets. A TF is a faculty account on someone else's
 * course. "choose" is the one that is not an app: an account that said it was
 * teaching and has nothing to teach yet, which is what a student looks like
 * after picking the wrong side at sign-up.
 */
type Kind = "faculty" | "tf" | "student" | "choose";

// Class Check-ins, behind a sign-in wall. The account's role decides which app
// it is: faculty run the sessions, students see their own work.
export default function Page() {
  // Without a database there is nothing to sign in to; FacultyApp renders the
  // "connect your database" card for exactly this case.
  if (!isSupabaseConfigured) return <FacultyApp />;
  return (
    <AuthGate>
      {(session, signOut) => (
        <RoleRouter
          key={session.user.id}
          uid={session.user.id}
          account={session.user.email ?? "signed in"}
          onSignOut={signOut}
        />
      )}
    </AuthGate>
  );
}

function RoleRouter({
  uid,
  account,
  onSignOut,
}: {
  uid: string;
  account: string;
  onSignOut: () => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [ready, setReady] = useState(false);
  // Redeeming a code changes the answer to every question below it — a TF code
  // in particular turns a student-app account into a TF one — so the whole
  // resolution runs again rather than the join screen guessing where to go.
  const [pass, setPass] = useState(0);

  useEffect(() => {
    let alive = true;
    setReady(false);

    (async () => {
      let role: Role;
      try {
        role = (await getRole()) ?? "faculty";
      } catch {
        // A missing profile shouldn't lock anyone out; fall back to faculty,
        // which is what every pre-roles account already was.
        role = "faculty";
      }
      if (role === "student") {
        // ...unless they are also on somebody's TF list. "Faculty" is the
        // default button at sign-up, so a TF who picked Student was sent
        // straight to the student app and could never reach the course they
        // were listed on — the role short-circuited before anything asked.
        //
        // Being on an instructor's TF list is a fact the instructor asserted,
        // not a claim this account made, so honouring it grants nothing the
        // owner did not already hand out. Their own course is excluded for the
        // same reason it is below: owning it is the stronger signal.
        try {
          await claimTFRows();
          const tfCourses = await myTFCourses();
          if (tfCourses.length && !tfCourses.some((c) => c.owner_id === uid)) {
            return "tf" as Kind;
          }
        } catch {
          // Not a TF, or the lookup failed — carry on into the student app.
        }
        return "student" as Kind;
      }

      // A teaching fellow signs up as Faculty — there is no TF button, because
      // being a TF is a fact about the instructor's roster, not a choice the
      // person makes. Claim by email, then ask whether they are on anyone's
      // list. This has to happen BEFORE ensureSessions: that call reads courses
      // through RLS, and a TF can see the instructor's, so it would conclude
      // nothing was missing and hand them the authoring UI for a course they
      // cannot write to.
      try {
        await claimTFRows();
        const tfCourses = await myTFCourses();
        if (tfCourses.length && !tfCourses.some((c) => c.owner_id === uid)) {
          return "tf" as Kind;
        }
      } catch {
        // Not fatal: an account that is not a TF simply carries on as faculty.
      }

      // Self-heal a wrong pick. "Faculty" is the default button, so a student
      // who signs up without noticing it would otherwise be stranded in an empty
      // gradebook forever — the role is write-once by design, so there is no way
      // back from inside the app.
      //
      // But ONLY for an account that owns no course. An instructor who put their
      // own address on their own roster — to see what students see, which is a
      // normal thing to do — would otherwise be thrown into the student app and
      // locked out of their own gradebook, with the same no-way-back problem
      // this is meant to solve. Owning a course is the stronger signal.
      // Ask about the roster FIRST, and unconditionally.
      //
      // This used to be gated on "owns no course", which was a trap: a student
      // who left the picker on Faculty was sent to the faculty app, which
      // provisions AP50A/AP50B owned by them — so from their second sign-in
      // they owned courses, the gate was false forever, and there was no way
      // back from inside the app.
      //
      // Being on somebody ELSE's roster is the signal. An instructor who put
      // their own address on their own roster — a normal thing to do, to see
      // what students see — is enrolled only on a course they own, so they
      // stay in the faculty app.
      try {
        await claimStudentRows();
        const enrolment = await getEnrolment();
        if (enrolment && enrolment.course.owner_id !== uid) return "student" as Kind;
      } catch {
        // No roster row, or the lookup failed — carry on as faculty.
      }

      // Last stop before the faculty app: does this account have a course at
      // all? An account that says it teaches and owns nothing is either an
      // instructor about to be handed AP50A/AP50B, or a student who picked the
      // wrong side at sign-up — and those two want opposite things. Ask, once,
      // at the only moment it is still free: ensureSessions runs inside
      // FacultyApp, so a moment later they own courses and the question stops
      // being askable. Post-0028 a student cannot create one anyway, and what
      // they would meet instead is "no AP 50 sessions came back — check that
      // migrations 0003-0005 have been run", which is neither true nor theirs
      // to fix.
      try {
        const owned = await listCourses();
        if (!owned.some((c) => c.owner_id === uid)) return "choose" as Kind;
      } catch {
        // Cannot tell. Go to the faculty app rather than stranding an
        // instructor on a question because one select failed.
      }

      return "faculty" as Kind;
    })()
      .then((k) => alive && setKind(k))
      .catch(() => alive && setKind("faculty"))
      .finally(() => alive && setReady(true));

    return () => {
      alive = false;
    };
  }, [uid, pass]);

  if (!ready) {
    return (
      <div id="tbl-app" className="ck-root">
        <div className="ck-canvas" style={{ color: "var(--ink2)" }}>Loading…</div>
      </div>
    );
  }

  if (kind === "choose") {
    return (
      <ChooseSide
        account={account}
        onSignOut={onSignOut}
        onJoined={() => setPass((p) => p + 1)}
        onTeach={() => setKind("faculty")}
      />
    );
  }

  // onTeachInstead is the mirror of the question above, for the account that
  // answered the other way: an instructor who read "I have a class code" as the
  // way in has no code to present and nothing else on that screen to press.
  //
  // It routes for THIS VISIT only. Nothing here writes profiles.role — 0024's
  // set_my_role would, but it has no client wrapper and studentData.ts is not
  // this change's to edit — so she lands back in the student app tomorrow and
  // presses it again. Annoying, and still the difference between friction and a
  // locked door.
  if (kind === "student") {
    return (
      <StudentApp
        account={account}
        onSignOut={onSignOut}
        onRerouted={() => setPass((p) => p + 1)}
        onTeachInstead={() => setKind("faculty")}
      />
    );
  }

  // The previous faculty app used to be reachable at /ck?classic=1 as a way back
  // if the new screens met a schema that had not caught up. Every migration is
  // applied now, so that reason is gone — and it was never a safe fallback: it
  // writes the same tables with a different model of them, it has no notion of
  // a teaching fellow (a TF landed there got an authoring UI they could not
  // write to and provisioned a stray course), and a live-session cell edit
  // there overwrote work handed in since the page loaded. Retiring the route is
  // the cheapest risk left to remove before a real class.
  //
  // The team BUILDER is not retired — TeamsScreen still embeds TeamsPillar
  // behind "Form teams", because the redesign has no replacement for it.
  return (
    <FacultyApp account={account} onSignOut={onSignOut} mode={kind === "tf" ? "tf" : "owner"} />
  );
}

/**
 * The promise the sign-up form makes ("if you pick this by mistake, the next
 * screen still offers the code box"), kept.
 *
 * It borrows the student view's screen and card because that is where JoinPanel
 * lives, and because most of the people who see this are on their way there.
 */
function ChooseSide({
  account,
  onSignOut,
  onJoined,
  onTeach,
}: {
  account: string;
  onSignOut: () => Promise<void>;
  onJoined: () => void;
  onTeach: () => void;
}) {
  return (
    <JoinScreen>
      <div className="sv-card" style={{ maxWidth: 620, marginBottom: 14 }}>
        <div className="sv-h1" style={{ fontSize: "var(--text-xl)" }}>
          Before we set up a course
        </div>
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
            lineHeight: 1.6,
            marginTop: 8,
            maxWidth: "62ch",
          }}
        >
          You signed up as someone teaching a course, and this account doesn&rsquo;t have one yet.
          If you&rsquo;re taking the course, or you&rsquo;re a teaching fellow on it, enter your
          instructor&rsquo;s code instead — that puts your work in her course rather than in a
          second one carrying the same name.
        </p>
      </div>

      <JoinPanel
        account={account}
        onJoined={onJoined}
        footer={
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--neutral-200)" }}>
            <p className="sv-sub" style={{ marginBottom: 8 }}>
              Running the course yourself? Then you don&rsquo;t need a code.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <button className="sv-btn outline" type="button" onClick={onTeach}>
                Set up my course
              </button>
              <button className="sv-btn link" type="button" onClick={() => void onSignOut()}>
                Sign out
              </button>
            </div>
          </div>
        }
      />
    </JoinScreen>
  );
}
