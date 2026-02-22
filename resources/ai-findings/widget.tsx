import { useEffect, useMemo, useState } from "react";
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
  status: z.enum(["requires_approval", "approved", "rejected"]),
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
type Finding = z.infer<typeof findingSchema>;

interface ScenarioOutput {
  management_plaintext: string;
  comparison_result: string;
  legal_plaintext_assessment: string;
}

export const widgetMetadata: WidgetMetadata = {
  description:
    "OpenAI analysis widget with clickable findings, approve/reject actions, plain-English scenario testing, and graph preview.",
  props: propsSchema,
  exposeAsTool: false,
};

export default function AiFindingsWidget() {
  const { props, isPending, theme, callTool } = useWidget<WidgetProps>({
    workspace_id: "",
    model: "gpt-4.1",
    analyzed_documents: [],
    findings_total: 0,
    findings: [],
  });

  const initialFindings = props.findings ?? [];
  const [findings, setFindings] = useState<Finding[]>(initialFindings);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(
    initialFindings[0]?.finding_id ?? null
  );
  const [decisionReason, setDecisionReason] = useState("");
  const [scenarioInput, setScenarioInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [scenarioOutput, setScenarioOutput] = useState<ScenarioOutput | null>(
    null
  );
  const [graphOutput, setGraphOutput] = useState<Record<string, unknown> | null>(
    null
  );
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isRunningScenario, setIsRunningScenario] = useState(false);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);

  useEffect(() => {
    const nextFindings = props.findings ?? [];
    setFindings(nextFindings);
    setSelectedFindingId((prev) =>
      prev && nextFindings.some((f) => f.finding_id === prev)
        ? prev
        : nextFindings[0]?.finding_id ?? null
    );
    setScenarioOutput(null);
    setGraphOutput(null);
    setMessage(null);
  }, [props.findings]);

  const selectedFinding =
    findings.find((finding) => finding.finding_id === selectedFindingId) ?? null;

  const palette = useMemo(() => {
    const dark = theme === "dark";
    return {
      bg: dark ? "#0b1221" : "#f7fafc",
      card: dark ? "#111827" : "#ffffff",
      border: dark ? "#243244" : "#d7e0ea",
      text: dark ? "#e7eef9" : "#0f1728",
      muted: dark ? "#9cb0cf" : "#4b5d79",
      row: dark ? "#0f1b30" : "#f2f6fb",
      inputBg: dark ? "#0e1b30" : "#f8fbff",
      inputText: dark ? "#dde7ff" : "#0f1728",
      button: dark ? "#8bb6ff" : "#0f5ad8",
      buttonText: dark ? "#062247" : "#f5f9ff",
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
        <strong>{findings.length}</strong>
      </p>

      <section style={cardStyle(palette)}>
        <h3 style={{ margin: "0 0 8px 0" }}>Findings (Click to Inspect)</h3>
        {findings.length === 0 ? (
          <p style={{ margin: 0, color: palette.muted }}>
            No findings returned from OpenAI.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {findings.map((finding) => (
              <button
                key={finding.finding_id}
                type="button"
                onClick={() => {
                  setSelectedFindingId(finding.finding_id);
                  setScenarioOutput(null);
                  setGraphOutput(null);
                }}
                style={{
                  textAlign: "left",
                  border: `1px solid ${palette.border}`,
                  borderRadius: 8,
                  padding: 10,
                  background:
                    selectedFindingId === finding.finding_id
                      ? palette.row
                      : palette.card,
                  color: palette.text,
                  cursor: "pointer",
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
                  Severity: {finding.severity} | Status: {finding.status}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedFinding ? (
        <section style={cardStyle(palette)}>
          <h3 style={{ margin: "0 0 6px 0" }}>Selected Finding</h3>
          <div style={{ fontWeight: 700 }}>{selectedFinding.title}</div>
          <p style={{ marginTop: 6, color: palette.muted }}>{selectedFinding.summary}</p>
          <p style={{ marginTop: 0, color: palette.muted, fontSize: 13 }}>
            ID: {selectedFinding.finding_id} | Document:{" "}
            {selectedFinding.document_name} | Tower: {selectedFinding.tower}
          </p>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13 }}>Decision Note (optional)</span>
            <textarea
              rows={2}
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              style={inputStyle(palette)}
            />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button
              type="button"
              style={buttonStyle(palette)}
              disabled={isUpdatingStatus}
              onClick={() => void updateStatus("approved")}
            >
              {isUpdatingStatus ? "Updating..." : "Approve"}
            </button>
            <button
              type="button"
              style={buttonStyle(palette)}
              disabled={isUpdatingStatus}
              onClick={() => void updateStatus("rejected")}
            >
              {isUpdatingStatus ? "Updating..." : "Reject"}
            </button>
          </div>

          <label style={{ display: "grid", gap: 4, marginTop: 12 }}>
            <span style={{ fontSize: 13 }}>
              Plain-English Scenario Input (lawyer narrative)
            </span>
            <textarea
              rows={3}
              value={scenarioInput}
              onChange={(e) => setScenarioInput(e.target.value)}
              style={inputStyle(palette)}
            />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button
              type="button"
              style={buttonStyle(palette)}
              disabled={isRunningScenario}
              onClick={() => void runScenario()}
            >
              {isRunningScenario ? "Running..." : "Run Plain-English Scenario"}
            </button>
            <button
              type="button"
              style={buttonStyle(palette)}
              disabled={isLoadingGraph}
              onClick={() => void loadGraph()}
            >
              {isLoadingGraph ? "Loading..." : "View Graph"}
            </button>
          </div>
        </section>
      ) : null}

      {message ? <p style={{ color: palette.muted }}>{message}</p> : null}

      {scenarioOutput ? (
        <section style={cardStyle(palette)}>
          <h3 style={{ margin: "0 0 6px 0" }}>Scenario Result</h3>
          <p style={{ marginTop: 0, color: palette.muted }}>
            {scenarioOutput.legal_plaintext_assessment}
          </p>
          <p style={{ marginTop: 0, color: palette.muted }}>
            Comparison: {scenarioOutput.comparison_result}
          </p>
          <p style={{ marginTop: 0, color: palette.muted }}>
            {scenarioOutput.management_plaintext}
          </p>
        </section>
      ) : null}

      {graphOutput ? (
        <section style={cardStyle(palette)}>
          <h3 style={{ margin: "0 0 6px 0" }}>Graph Snapshot</h3>
          <p style={{ marginTop: 0, color: palette.muted }}>
            Weighted risk:{" "}
            {asNumber(graphOutput.total_weighted_risk)?.toLocaleString() ?? "n/a"} |
            Open findings: {asNumber(graphOutput.open_findings) ?? "n/a"} |
            Requires approval: {asNumber(graphOutput.requires_approval) ?? "n/a"}
          </p>
        </section>
      ) : null}
    </div>
  );

  async function updateStatus(decision: "approved" | "rejected") {
    if (!selectedFinding) {
      setMessage("Select a finding first.");
      return;
    }
    setIsUpdatingStatus(true);
    setMessage(null);
    try {
      const result = await callTool("set_ai_finding_status", {
        workspace_id: props.workspace_id,
        finding_id: selectedFinding.finding_id,
        decision,
        reason: decisionReason.trim().length > 0 ? decisionReason : undefined,
      });
      const structured = toObject(result.structuredContent);
      const finding = toObject(structured.finding);
      const status = asString(finding.status);
      if (
        status === "approved" ||
        status === "rejected" ||
        status === "requires_approval"
      ) {
        setFindings((prev) =>
          prev.map((f) =>
            f.finding_id === selectedFinding.finding_id ? { ...f, status } : f
          )
        );
      }
      setMessage(`Finding ${decision}.`);
    } catch (err) {
      setMessage(
        `Could not update status: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  async function runScenario() {
    if (!selectedFinding) {
      setMessage("Select a finding first.");
      return;
    }
    if (scenarioInput.trim().length < 12) {
      setMessage("Enter a longer plain-English scenario statement.");
      return;
    }

    setIsRunningScenario(true);
    setMessage(null);
    try {
      const result = await callTool("run_ai_finding_plaintext_scenario", {
        workspace_id: props.workspace_id,
        finding_id: selectedFinding.finding_id,
        plain_english: scenarioInput,
      });
      const structured = toObject(result.structuredContent);
      const comparison = toObject(structured.comparison);
      setScenarioOutput({
        management_plaintext: asString(structured.management_plaintext) ?? "",
        comparison_result: asString(comparison.comparison_result) ?? "unclear",
        legal_plaintext_assessment:
          asString(comparison.legal_plaintext_assessment) ?? "",
      });
      setMessage("Scenario run completed.");
    } catch (err) {
      setMessage(
        `Could not run scenario: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    } finally {
      setIsRunningScenario(false);
    }
  }

  async function loadGraph() {
    setIsLoadingGraph(true);
    setMessage(null);
    try {
      const result = await callTool("recompute_risk_graph", {
        workspace_id: props.workspace_id,
      });
      setGraphOutput(toObject(result.structuredContent));
      setMessage("Risk graph loaded.");
    } catch (err) {
      setMessage(
        `Could not load graph: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    } finally {
      setIsLoadingGraph(false);
    }
  }
}

function cardStyle(palette: { border: string; card: string }) {
  return {
    marginTop: 12,
    padding: 12,
    border: `1px solid ${palette.border}`,
    borderRadius: 10,
    background: palette.card,
  } as const;
}

function inputStyle(palette: {
  border: string;
  inputBg: string;
  inputText: string;
}) {
  return {
    width: "100%",
    borderRadius: 8,
    border: `1px solid ${palette.border}`,
    background: palette.inputBg,
    color: palette.inputText,
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: 14,
  } as const;
}

function buttonStyle(palette: { button: string; buttonText: string }) {
  return {
    background: palette.button,
    color: palette.buttonText,
    border: "none",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 600,
  } as const;
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
