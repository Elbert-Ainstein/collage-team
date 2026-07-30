"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { RoleRail } from "./RoleRail";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Boot } from "./Boot";
import { FacultyShell } from "@/faculty/FacultyShell";

// Client-only SPA (frontend-only): render nothing store-dependent until mounted so
// server HTML and the first client render match (avoids hydration mismatch).
// The instructor experience (/i/*) uses the redesigned Faculty Dashboard shell;
// the student experience (/s/*) uses the original shell.
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMounted(true), []);

  // The real Class Check-ins app owns its own chrome (and its own Supabase data),
  // so render it bare — no old role rail / sidebar / faculty shell.
  if (pathname.startsWith("/ck")) {
    return <>{children}</>;
  }

  if (!mounted) {
    return <div className="app-boot" aria-hidden />;
  }

  if (pathname.startsWith("/i")) {
    return (
      <>
        <Boot />
        <FacultyShell>{children}</FacultyShell>
      </>
    );
  }

  return (
    <div className="app">
      <Boot />
      <RoleRail />
      <Sidebar />
      <div className="main">
        <TopBar />
        <main className="content">
          <div className="content__inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
