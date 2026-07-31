"use client";

import { AuthGate } from "@/checkins/AuthGate";
import { ClassCheckins } from "@/checkins/ClassCheckins";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

// The real Class Check-ins app (Supabase-backed), behind a sign-in wall.
export default function Page() {
  if (!isSupabaseConfigured) return <ClassCheckins />;
  return (
    <AuthGate>
      {(session, signOut) => (
        <ClassCheckins account={session.user.email ?? "signed in"} onSignOut={signOut} />
      )}
    </AuthGate>
  );
}
