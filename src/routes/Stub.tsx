import { PageHeader, Panel, Icon, StatusBadge } from "@/components";

// Real-layout placeholder for ◇ / not-yet-built screens (§10 step 6).
export function Stub({
  title,
  subtitle,
  milestone,
  note,
}: {
  title: string;
  subtitle?: string;
  milestone?: string;
  note?: string;
}) {
  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={milestone ? <StatusBadge variant="outline">{milestone}</StatusBadge> : undefined}
      />
      <Panel style={{ display: "flex", gap: 14, alignItems: "center", padding: 28 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "var(--stage-prep-bg)",
            color: "var(--stage-prep-fg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="construction" />
        </div>
        <div>
          <div style={{ fontWeight: 600, color: "var(--navy)" }}>Coming soon</div>
          <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: 2 }}>
            {note ?? "This screen has an approved layout and is scheduled in the build plan."}
          </div>
        </div>
      </Panel>
    </>
  );
}
