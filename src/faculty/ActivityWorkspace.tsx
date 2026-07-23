"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { activityById, useStore } from "@/store";
import { TabHub } from "@/shell/TabHub";
import { ActivityBuilder } from "@/routes/instructor/ActivityBuilder";
import { Grading } from "@/routes/instructor/Grading";
import { Stub } from "@/routes/Stub";

// Per-activity workspace — the destination when you open an Activity from Course
// content. In-page tabs (Build · Grade · Monitor) scope everything to one activity;
// grading here is per-activity (no separate Assessment nav — see INTEGRATION-PLAN).
export function ActivityWorkspace() {
  const params = useParams();
  const id = String(params.id);
  const setCurrent = useStore((s) => s.setCurrentActivity);
  const activity = useStore((s) => activityById(s, id));

  useEffect(() => {
    if (activity) setCurrent(id);
  }, [id, activity, setCurrent]);

  if (!activity) {
    return <Stub title="Activity not found" subtitle="This activity may have been removed." />;
  }

  return (
    <TabHub
      tabs={[
        { key: "build", label: "Build", render: () => <ActivityBuilder /> },
        { key: "grade", label: "Grade", render: () => <Grading /> },
        { key: "monitor", label: "Monitor", deferred: true, render: () => (
          <Stub title="Live monitoring" subtitle="Real-time team status during the in-class session." milestone="◇ deferred" />
        ) },
      ]}
    />
  );
}
