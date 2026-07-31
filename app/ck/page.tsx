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
        // Keyed by account: switching users must remount the app, or the
        // previous account's roster and tab state would linger on screen.
        <ClassCheckins
          key={session.user.id}
          account={session.user.email ?? "signed in"}
          onSignOut={signOut}
        />
      )}
    </AuthGate>
  );
}
