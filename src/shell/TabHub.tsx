"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StatusBadge } from "@/components";

export interface HubTab {
  key: string;
  label: string;
  deferred?: boolean;
  render: () => React.ReactNode;
}

// A single route that hosts several existing screens under in-page tabs, so
// correlated instructor screens share one sidebar entry. The active tab lives in
// the URL (?tab=<key>) so cross-hub deep links AND within-hub buttons can target
// a specific tab with router.push(`${route}?tab=${key}`).
function TabHubInner({ tabs }: { tabs: HubTab[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qTab = params.get("tab");
  const active = tabs.some((t) => t.key === qTab) ? (qTab as string) : tabs[0]?.key;
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === active}
            className={`tab ${t.key === active ? "tab--active" : ""}`}
            onClick={() => router.replace(`${pathname}?tab=${t.key}`, { scroll: false })}
          >
            {t.label}
            {t.deferred && (
              <span style={{ marginLeft: 6 }}>
                <StatusBadge variant="outline">soon</StatusBadge>
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current?.render()}</div>
    </div>
  );
}

export function TabHub({ tabs }: { tabs: HubTab[] }) {
  return (
    <Suspense fallback={<div />}>
      <TabHubInner tabs={tabs} />
    </Suspense>
  );
}

// Helper for cross-hub / cross-tab deep links.
export function hubHref(route: string, tab: string) {
  return `${route}?tab=${tab}`;
}
