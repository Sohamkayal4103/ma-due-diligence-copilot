import { useMemo } from "react";
import { useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

const findingSchema = z.object({
  finding_id: z.string(),
  tower: z.string(),
  severity: z.string(),
  status: z.string(),
  title: z.string(),
  impact_value: z.number(),
  confidence: z.number(),
});

const graphSchema = z.object({
  total_weighted_risk: z.number(),
  open_findings: z.number(),
  requires_approval: z.number(),
  tower_summaries: z.array(
    z.object({
      tower: z.string(),
      total_findings: z.number(),
      weighted_risk: z.number(),
      avg_confidence: z.number(),
    })
  ),
});

const propsSchema = z.object({
  workspace_id: z.string(),
  findings: z.array(findingSchema),
  graph: graphSchema,
});

type WidgetProps = z.infer<typeof propsSchema>;

export const widgetMetadata: WidgetMetadata = {
  description:
    "Deal cockpit risk map widget showing weighted risk, approvals, and top findings by diligence tower.",
  props: propsSchema,
  exposeAsTool: false,
};

export default function RiskMapWidget() {
  const { props, isPending, theme } = useWidget<WidgetProps>();

  const palette = useMemo(() => {
    const dark = theme === "dark";
    return {
      bg: dark ? "#0f172a" : "#f8fafc",
      card: dark ? "#111827" : "#ffffff",
      border: dark ? "#1f2937" : "#e5e7eb",
      text: dark ? "#e5e7eb" : "#111827",
      muted: dark ? "#9ca3af" : "#6b7280",
      accent: dark ? "#60a5fa" : "#1d4ed8",
      critical: "#dc2626",
      high: "#ea580c",
      medium: "#ca8a04",
      low: "#16a34a",
    };
  }, [theme]);

  if (isPending) {
    return (
      <div style={{ padding: 16, color: palette.text, background: palette.bg }}>
        Loading risk map...
      </div>
    );
  }

  const findings = props.findings.slice(0, 8);

  return (
    <div
      style={{
        background: palette.bg,
        color: palette.text,
        padding: 16,
        borderRadius: 12,
        fontFamily:
          '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, sans-serif',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 20 }}>Workspace {props.workspace_id}</h2>
      <p style={{ marginTop: 6, color: palette.muted }}>
        Weighted risk: <strong>{props.graph.total_weighted_risk.toLocaleString()}</strong> | Open findings: <strong>{props.graph.open_findings}</strong> |
        Requires approval: <strong>{props.graph.requires_approval}</strong>
      </p>

      <div
        style={{
          marginTop: 12,
          padding: 12,
          border: `1px solid ${palette.border}`,
          borderRadius: 10,
          background: palette.card,
        }}
      >
        <h3 style={{ margin: "0 0 8px 0" }}>Tower Summaries</h3>
        {props.graph.tower_summaries.map((tower) => (
          <div key={tower.tower} style={{ marginBottom: 8 }}>
            <strong>{tower.tower}</strong> — findings: {tower.total_findings}, weighted risk: {tower.weighted_risk.toLocaleString()}, confidence: {tower.avg_confidence}
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 12,
          border: `1px solid ${palette.border}`,
          borderRadius: 10,
          background: palette.card,
        }}
      >
        <h3 style={{ margin: "0 0 10px 0" }}>Top Findings</h3>
        {findings.length === 0 ? (
          <p style={{ margin: 0, color: palette.muted }}>No findings yet.</p>
        ) : (
          findings.map((finding) => {
            const severityColor =
              finding.severity === "critical"
                ? palette.critical
                : finding.severity === "high"
                  ? palette.high
                  : finding.severity === "medium"
                    ? palette.medium
                    : palette.low;

            return (
              <div
                key={finding.finding_id}
                style={{
                  borderLeft: `4px solid ${severityColor}`,
                  paddingLeft: 10,
                  marginBottom: 10,
                }}
              >
                <div style={{ fontWeight: 600 }}>{finding.title}</div>
                <div style={{ color: palette.muted }}>
                  {finding.tower} | {finding.status} | impact {finding.impact_value.toLocaleString()} | confidence {finding.confidence}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
