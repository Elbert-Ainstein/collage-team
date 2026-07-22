"use client";

import { RoleRail } from "./RoleRail";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Boot } from "./Boot";

// The persistent app chrome (role rail + sidebar + top bar). Next's file-based
// routes render into {children}. Client component because the shell reads the
// (persisted) store and the current path.
export function AppShell({ children }: { children: React.ReactNode }) {
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
