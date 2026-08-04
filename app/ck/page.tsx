"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/checkins/AuthGate";
import { ClassCheckins } from "@/checkins/ClassCheckins";
import { FacultyApp } from "@/faculty/FacultyApp";
import { StudentApp } from "@/student/StudentApp";
import { claimStudentRows, getEnrolment, getRole } from "@/checkins/studentData";
import { claimTFRows, myTFCourses } from "@/faculty/facultyData";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import type { Role } from "@/checkins/types";

/** Which app this account gets. A TF is a faculty account on someone else's course. */
type Kind = "faculty" | "tf" | "student";

// Class Check-ins, behind a sign-in wall. The account's role decides which app
// it is: faculty run the sessions, students see their own work.
export default function Page() {
  if (!isSupabaseConfigured) return <ClassCheckins />;
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

  useEffect(() => {
    let alive = true;

    (async () => {
      let role: Role;
      try {
        role = (await getRole()) ?? "faculty";
      } catch {
        // A missing profile shouldn't lock anyone out; fall back to faculty,
        // which is what every pre-roles account already was.
        role = "faculty";
      }
      if (role === "student") return "student" as Kind;

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

      return "faculty" as Kind;
    })()
      .then((k) => alive && setKind(k))
      .catch(() => alive && setKind("faculty"))
      .finally(() => alive && setReady(true));

    return () => {
      alive = false;
    };
  }, [uid]);

  if (!ready) {
    return (
      <div id="tbl-app" className="ck-root">
        <div className="ck-canvas" style={{ color: "var(--ink2)" }}>Loading…</div>
      </div>
    );
  }

  if (kind === "student") return <StudentApp account={account} onSignOut={onSignOut} />;

  // The redesigned faculty app is the default. The previous one stays reachable
  // at /ck?classic=1 until 0007 has been run everywhere — it is the only way
  // back if the new screens hit a schema that has not caught up yet.
  const classic =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("classic") === "1";

  return classic ? (
    <ClassCheckins account={account} onSignOut={onSignOut} />
  ) : (
    <FacultyApp account={account} onSignOut={onSignOut} mode={kind === "tf" ? "tf" : "owner"} />
  );
}
