"use client";

import { TabHub } from "@/shell/TabHub";
import { CourseContent } from "./CourseContent";
import { RosterTeams } from "./RosterTeams";
import { Analytics } from "./Analytics";

// Team — the post-creation hub. Everything that happens after an activity exists
// lives here: the running team activities (→ each team's workspace), team setup
// (roster & teams), and cross-team analytics.
export function TeamHub() {
  return (
    <>
      <div className="mb-2">
        <h1 className="font-serif text-[30px] font-semibold text-black/80">Team</h1>
        <p className="mt-1 text-sm text-muted-fg">Run and monitor team-based activities.</p>
      </div>
      <TabHub
        tabs={[
          { key: "activities", label: "Activities", render: () => <CourseContent onlySubs={["activities"]} heading={null} /> },
          { key: "teams", label: "Teams", render: () => <RosterTeams /> },
          { key: "analytics", label: "Analytics", render: () => <Analytics /> },
        ]}
      />
    </>
  );
}
