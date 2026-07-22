"use client";

import { useEffect, useState } from "react";
import { RoleRail } from "./RoleRail";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Boot } from "./Boot";

// The persistent app chrome (role rail + sidebar + top bar). Next's file-based
// routes render into {children}. This is a client-only SPA (frontend-only): the
// shell and pages read the persisted store, so we render nothing store-dependent
// until after mount — server HTML and the first client render match (a neutral
// canvas), then the app renders. This avoids store/localStorage hydration
// mismatches app-wide.
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="app-boot" aria-hidden />;
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
