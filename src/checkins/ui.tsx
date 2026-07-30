"use client";

import { initials, tintFor } from "./data";
import type { Activity, Student } from "./types";

/** Props every pillar receives from ClassCheckins. */
export interface PillarProps {
  courseId: string;
  roster: Student[];
  activities: Activity[];
  /** Re-fetch course-level data (roster + activities) in the parent. */
  refresh: () => Promise<void>;
}

export function Avatar({
  name,
  tint,
  size = 22,
}: {
  name: string;
  tint?: string | null;
  size?: number;
}) {
  const c = tint || tintFor(name);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        fontSize: size * 0.42,
        fontWeight: 600,
        background: c + "22",
        color: c,
        flex: "none",
      }}
    >
      {initials(name)}
    </span>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="t-card" style={{ padding: 14, ...style }}>
      {children}
    </div>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div
      className="t-card"
      style={{
        padding: "10px 14px",
        marginBottom: 14,
        borderColor: "var(--amber)",
        color: "var(--amber)",
        fontSize: 12.5,
      }}
    >
      {error}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
        alignItems: "center",
        border: "1px solid var(--line)",
        background: "var(--paper2)",
        borderRadius: 14,
        padding: 20,
        boxShadow: "var(--shadowCard)",
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4, maxWidth: "58ch" }}>
          {body}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Week label for an activity ("Week 3"), falling back to its title. */
export function weekLabel(a: Activity): string {
  return a.week != null ? `Week ${a.week}` : a.title;
}
