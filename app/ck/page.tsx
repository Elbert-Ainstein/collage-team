"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/checkins/AuthGate";
import { ClassCheckins } from "@/checkins/ClassCheckins";
import { FacultyApp } from "@/faculty/FacultyApp";
import { StudentApp } from "@/student/StudentApp";
import { getRole } from "@/checkins/studentData";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import type { Role } from "@/checkins/types";

// Class Check-ins, behind a sign-in wall. The account's role decides which app
// it is: faculty run the sessions, students see their own work.
export default function Page() {
  if (!isSupabaseConfigured) return <ClassCheckins />;
  return (
    <AuthGate>
      {(session, signOut) => (
        <RoleRouter
          key={session.user.id}
          account={session.user.email ?? "signed in"}
          onSignOut={signOut}
        />
      )}
    </AuthGate>
  );
}

function RoleRouter({
  account,
  onSignOut,
}: {
  account: string;
  onSignOut: () => Promise<void>;
}) {
  const [role, setRole] = useState<Role | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    getRole()
      .then((r) => alive && setRole(r))
      // A missing profile shouldn't lock anyone out; fall back to faculty,
      // which is what every pre-roles account already was.
      .catch(() => alive && setRole("faculty"))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) {
    return (
      <div id="tbl-app" className="ck-root">
        <div className="ck-canvas" style={{ color: "var(--ink2)" }}>Loading…</div>
      </div>
    );
  }

  if (role === "student") return <StudentApp account={account} onSignOut={onSignOut} />;

  // The redesigned faculty app is the default. The previous one stays reachable
  // at /ck?classic=1 until 0007 has been run everywhere — it is the only way
  // back if the new screens hit a schema that has not caught up yet.
  const classic =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("classic") === "1";

  return classic ? (
    <ClassCheckins account={account} onSignOut={onSignOut} />
  ) : (
    <FacultyApp account={account} onSignOut={onSignOut} />
  );
}
