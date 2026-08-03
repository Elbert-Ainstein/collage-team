"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/checkins/AuthGate";
import { ClassCheckins } from "@/checkins/ClassCheckins";
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

  return role === "student" ? (
    <StudentApp account={account} onSignOut={onSignOut} />
  ) : (
    <ClassCheckins account={account} onSignOut={onSignOut} />
  );
}
