import { useMemo } from "react";
import { useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

const findingSchema = z.object({
  finding_id: z.string(),
  document_id: z.string(),
  document_name: z.string(),
  title: z.string(),
  summary: z.string(),
  tower: z.string(),
  severity: z.string(),
  probability: z.number(),
  confidence: z.number(),
  impact_value: z.number(),
});

const analyzedDocumentSchema = z.object({
  document_id: z.string(),
  document_name: z.string(),
  source_type: z.enum(["file_bytes", "raw_text"]),
  source_label: z.string(),
  bytes_sent: z.number().optional(),
  chars_sent: z.number().optional(),
  summary: z.string(),
});

const propsSchema = z.object({
  workspace_id: z.string(),
  model: z.string(),
  analyzed_documents: z.array(analyzedDocumentSchema),
  findings_total: z.number(),
  findings: z.array(findingSchema),
});

type WidgetProps = z.infer<typeof propsSchema>;

export const widgetMetadata: WidgetMetadata = {
  description:
    "OpenAI analysis widget showing findings with finding IDs and source document names.",
  props: propsSchema,
  exposeAsTool: false,
};

export default function AiFindingsWidget() {
  const { props, isPending, theme } = useWidget<WidgetProps>();

  const palette = useMemo(() => {
    const dark = theme === "dark";
    return {
      bg: dark ? "#0b1221" : "#f7fafc",
      card: dark ? "#111827" : "#ffffff",
      border: dark ? "#243244" : "#d7e0ea",
      text: dark ? "#e7eef9" : "#0f1728",
      muted: dark ? "#9cb0cf" : "#4b5d79",
      row: dark ? "#0f1b30" : "#f2f6fb",
      critical: "#dc2626",
      high: "#ea580c",
      medium: "#ca8a04",
      low: "#16a34a",
    };
  }, [theme]);

  if (isPending) {
    return <div style={{ padding: 16 }}>Analyzing documents...</div>;
  }

  return (
    <div
      style={{
        background: palette.bg,
        color: palette.text,
        padding: 16,
        borderRadius: 12,
        fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 20 }}>AI Document Findings</h2>
      <p style={{ marginTop: 6, color: palette.muted }}>
        Workspace: <strong>{props.workspace_id}</strong> | Model:{" "}
        <strong>{props.model}</strong> | Documents analyzed:{" "}
        <strong>{props.analyzed_documents.length}</strong> | Findings:{" "}
        <strong>{props.findings_total}</strong>
      </p>

      <section
        style={{
          marginTop: 12,
          padding: 12,
          border: `1px solid ${palette.border}`,
          borderRadius: 10,
          background: palette.card,
        }}
      >
        <h3 style={{ margin: "0 0 8px 0" }}>Analyzed Documents</h3>
        {props.analyzed_documents.length === 0 ? (
          <p style={{ margin: 0, color: palette.muted }}>No documents analyzed.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {props.analyzed_documents.map((doc) => (
              <div
                key={doc.document_id}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: `1px solid ${palette.border}`,
                  background: palette.row,
                }}
              >
                <div style={{ fontWeight: 600 }}>{doc.document_name}</div>
                <div style={{ color: palette.muted, fontSize: 13 }}>
                  Source: {doc.source_label} | Type: {doc.source_type}
                  {typeof doc.bytes_sent === "number"
                    ? ` | Bytes: ${doc.bytes_sent}`
                    : ""}
                  {typeof doc.chars_sent === "number"
                    ? ` | Chars: ${doc.chars_sent}`
                    : ""}
                </div>
                {doc.summary ? (
                  <p style={{ margin: "6px 0 0", color: palette.muted }}>
                    {doc.summary}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        style={{
          marginTop: 12,
          padding: 12,
          border: `1px solid ${palette.border}`,
          borderRadius: 10,
          background: palette.card,
        }}
      >
        <h3 style={{ margin: "0 0 8px 0" }}>Findings</h3>
        {props.findings.length === 0 ? (
          <p style={{ margin: 0, color: palette.muted }}>
            No findings returned from OpenAI.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {props.findings.map((finding) => (
              <article
                key={finding.finding_id}
                style={{
                  borderLeft: `4px solid ${severityColor(finding.severity, palette)}`,
                  paddingLeft: 10,
                }}
              >
                <div style={{ fontWeight: 700 }}>{finding.title}</div>
                <div style={{ color: palette.muted, fontSize: 13 }}>
                  Finding ID: {finding.finding_id}
                </div>
                <div style={{ color: palette.muted, fontSize: 13 }}>
                  Document: {finding.document_name}
                </div>
                <div style={{ color: palette.muted, fontSize: 13 }}>
                  Tower: {finding.tower} | Severity: {finding.severity} |
                  Probability: {finding.probability.toFixed(2)} | Confidence:{" "}
                  {finding.confidence.toFixed(2)} | Impact:{" "}
                  {finding.impact_value.toLocaleString()}
                </div>
                <p style={{ margin: "6px 0 0", color: palette.muted }}>
                  {finding.summary}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function severityColor(
  severity: string,
  palette: {
    critical: string;
    high: string;
    medium: string;
    low: string;
  }
): string {
  if (severity === "critical") return palette.critical;
  if (severity === "high") return palette.high;
  if (severity === "medium") return palette.medium;
  return palette.low;
}
