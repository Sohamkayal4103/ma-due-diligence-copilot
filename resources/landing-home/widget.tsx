import { useEffect, useMemo, useState } from "react";
import { useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

const propsSchema = z.object({
  focus: z.enum(["overview", "workflow", "agent_role"]).optional(),
});

type LandingProps = z.infer<typeof propsSchema>;
type DealType = "merger" | "acquisition";
const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;

interface LocalFileUpload {
  file_name: string;
  mime_type: string;
  size_bytes: number;
  base64: string;
}

interface DealDocumentForm {
  document_name: string;
  document_type: string;
  source_uri: string;
  mime_type: string;
  notes: string;
  raw_text: string;
  metadata?: Record<string, unknown>;
  file_upload?: LocalFileUpload;
}
type DocumentTextField = Exclude<
  keyof DealDocumentForm,
  "file_upload" | "metadata"
>;

interface IntakeForm {
  tenant_id: string;
  deal_name: string;
  acquirer_name: string;
  target_name: string;
  thesis: string;
  deal_value: string;
  currency: string;
  expected_close_date: string;
  jurisdiction: string;
  industry: string;
  owner_email: string;
  materiality_threshold: string;
  policy_profile: string;
}

interface AnalysisFindingPreview {
  finding_id: string;
  document_id: string;
  document_name: string;
  title: string;
  summary: string;
  management_points: string[];
  tower: string;
  severity: string;
  status: "requires_approval" | "approved" | "rejected";
  probability: number;
  confidence: number;
  impact_value: number;
}

interface AnalysisScenarioOutput {
  comparison_result: string;
  legal_plaintext_assessment: string;
  executive_points: string[];
  evidence_points: string[];
  recalibrated_parameters: {
    downside_multiplier: number;
    synergy_multiplier: number;
    integration_cost: number;
  };
  management_explanation: string;
  management_plaintext: string;
  scenario_result: {
    valuation_delta: number;
    integration_delta: number;
    risk_delta: number;
    confidence_band: [number, number];
  } | null;
}

interface VisualGraphBar {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface VisualGraphBreakdown {
  key: string;
  label: string;
  count: number;
  color: string;
}

interface VisualGraphPayload {
  title: string;
  subtitle: string;
  total_weighted_risk: number;
  open_findings: number;
  requires_approval: number;
  y_max: number;
  bars: VisualGraphBar[];
  status_breakdown: VisualGraphBreakdown[];
  severity_breakdown: VisualGraphBreakdown[];
  scenario_overlay?: {
    label: string;
    risk_delta: number;
    valuation_delta: number;
    integration_delta: number;
  } | null;
}

interface ApprovedReportPayload {
  generated_at: string;
  approved_count: number;
  pending_count: number;
  rejected_count: number;
  report_title: string;
  executive_summary: string;
  key_points: string[];
  approved_findings_digest: Array<{
    finding_id: string;
    headline: string;
    business_impact: string;
    recommended_action: string;
  }>;
  final_recommendation: string;
  pdf: {
    file_name: string;
    mime_type: string;
    base64: string;
  };
}

export const widgetMetadata: WidgetMetadata = {
  description:
    "Landing page widget for the M&A Due-Diligence Copilot with workflow and AI agent overview.",
  props: propsSchema,
  exposeAsTool: false,
};

const workflowSteps = [
  {
    title: "Create Deal Workspace",
    body:
      "Deal lead creates a workspace, sets thesis/materiality, and invites finance, legal, ops, and leadership users.",
  },
  {
    title: "Ingest Federated Evidence",
    body:
      "Data room artifacts, contract updates, ERP metrics, and other tower-specific inputs are ingested and normalized.",
  },
  {
    title: "Detect Risks and Contradictions",
    body:
      "The orchestrator identifies signal-based findings and cross-source contradictions, then links every finding to evidence.",
  },
  {
    title: "Human Approval and Governance",
    body:
      "High-impact findings move to approval gates where reviewers approve/reject and request missing evidence when needed.",
  },
  {
    title: "Run Scenarios and Package Decision",
    body:
      "Teams run downside/base/upside scenarios and generate IC-ready packs with provenance, assumptions, and negotiation levers.",
  },
];

const agentRoleItems = [
  "Continuously re-scores risk as new evidence arrives.",
  "Explains why each finding exists using provenance references.",
  "Surfaces contradictions between legal, finance, and operational data.",
  "Turns plain-English scenario ideas into simulation parameters.",
  "Protects governance by enforcing approval and traceability gates.",
];

const defaultIntakeForm: IntakeForm = {
  tenant_id: "tenant-demo",
  deal_name: "",
  acquirer_name: "",
  target_name: "",
  thesis: "",
  deal_value: "",
  currency: "USD",
  expected_close_date: "",
  jurisdiction: "",
  industry: "",
  owner_email: "",
  materiality_threshold: "4500000",
  policy_profile: "strict-default",
};

const blankDocument = (): DealDocumentForm => ({
  document_name: "",
  document_type: "contract",
  source_uri: "",
  mime_type: "application/pdf",
  notes: "",
  raw_text: "",
  metadata: undefined,
  file_upload: undefined,
});

export default function LandingHomeWidget() {
  const { props, theme, callTool } = useWidget<LandingProps>({
    focus: "overview",
  });

  const routeState = readRouteState();
  const [currentView, setCurrentView] = useState<"home" | "intake">(
    routeState.view
  );
  const [intakeDealType, setIntakeDealType] = useState<DealType>(
    routeState.dealType
  );
  const [showWorkflow, setShowWorkflow] = useState(
    props.focus === "workflow"
  );
  const [showAgentRole, setShowAgentRole] = useState(
    props.focus === "agent_role"
  );
  const [form, setForm] = useState<IntakeForm>(defaultIntakeForm);
  const [documents, setDocuments] = useState<DealDocumentForm[]>([
    blankDocument(),
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(
    null
  );
  const [createdDealId, setCreatedDealId] = useState<string | null>(null);
  const [analysisWorkspaceId, setAnalysisWorkspaceId] = useState<string>("");
  const [isAnalyzingDocuments, setIsAnalyzingDocuments] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [analysisFindings, setAnalysisFindings] = useState<
    AnalysisFindingPreview[]
  >([]);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(
    null
  );
  const [analysisDecisionReason, setAnalysisDecisionReason] = useState("");
  const [analysisScenarioInput, setAnalysisScenarioInput] = useState("");
  const [analysisScenarioOutput, setAnalysisScenarioOutput] =
    useState<AnalysisScenarioOutput | null>(null);
  const [analysisGraphOutput, setAnalysisGraphOutput] =
    useState<VisualGraphPayload | null>(null);
  const [approvedReport, setApprovedReport] =
    useState<ApprovedReportPayload | null>(null);
  const [isUpdatingFindingStatus, setIsUpdatingFindingStatus] = useState(false);
  const [isRunningScenario, setIsRunningScenario] = useState(false);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const palette = useMemo(() => {
    const dark = theme === "dark";
    return {
      page: dark ? "#0b1324" : "#f6f8fc",
      card: dark ? "#101a31" : "#ffffff",
      text: dark ? "#e6edf8" : "#0f1728",
      muted: dark ? "#9db0d2" : "#4a5b7a",
      line: dark ? "#243354" : "#d8e1f0",
      heroA: dark ? "#1a3e94" : "#1d4ed8",
      heroB: dark ? "#1278b8" : "#0a8ac2",
      button: dark ? "#8bb6ff" : "#0f5ad8",
      buttonText: dark ? "#062247" : "#f5f9ff",
      chip: dark ? "#18345f" : "#e6efff",
      chipText: dark ? "#bcd4ff" : "#13409b",
      inputBg: dark ? "#0f1f3b" : "#f9fbff",
      inputText: dark ? "#dde7ff" : "#0f1728",
    };
  }, [theme]);
  const selectedAnalysisFinding =
    analysisFindings.find((finding) => finding.finding_id === selectedFindingId) ??
    null;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isSrcDoc =
      window.location.protocol === "about:" ||
      window.location.href.startsWith("about:srcdoc");
    if (isSrcDoc) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (currentView === "intake") {
      params.set("view", "intake");
      params.set("deal_type", intakeDealType);
    } else {
      params.delete("view");
      params.delete("deal_type");
    }

    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;

    try {
      window.history.replaceState({}, "", nextUrl);
    } catch {
      // Some embedded runtimes disallow history URL mutation; keep local UI state only.
    }
  }, [currentView, intakeDealType]);

  if (currentView === "intake") {
    return (
      <div
        style={{
          background: palette.page,
          color: palette.text,
          minHeight: "100vh",
          padding: 16,
          fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
        }}
      >
        <section style={sectionStyle(palette)}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>
              {intakeDealType === "merger"
                ? "New Merger Intake"
                : "New Acquisition Intake"}
            </h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                style={buttonStyle(palette)}
                onClick={fillSampleIntake}
              >
                Fill Sample Details
              </button>
              <button
                type="button"
                style={buttonStyle(palette)}
                onClick={() => {
                  setCurrentView("home");
                  setSubmitMessage(null);
                  clearAnalysisOutputs();
                }}
              >
                Back
              </button>
            </div>
          </div>

          <p style={{ marginTop: 8, color: palette.muted }}>
            Fill this form to create a workspace and persist deal metadata +
            related documents to Supabase.
          </p>
          <p style={{ marginTop: 6, color: palette.muted }}>
            This captures deal profile, thesis, timeline, governance thresholds,
            and initial diligence documents.
          </p>

          <div style={{ display: "grid", gap: 10 }}>
            <Field
              label="Tenant ID"
              value={form.tenant_id}
              onChange={(value) => updateForm("tenant_id", value)}
              palette={palette}
            />
            <Field
              label="Deal Name"
              value={form.deal_name}
              onChange={(value) => updateForm("deal_name", value)}
              palette={palette}
            />
            <Field
              label="Acquirer Name"
              value={form.acquirer_name}
              onChange={(value) => updateForm("acquirer_name", value)}
              palette={palette}
            />
            <Field
              label="Target Name"
              value={form.target_name}
              onChange={(value) => updateForm("target_name", value)}
              palette={palette}
            />
            <Field
              label="Thesis"
              value={form.thesis}
              onChange={(value) => updateForm("thesis", value)}
              multiline
              palette={palette}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field
                label="Deal Value"
                value={form.deal_value}
                onChange={(value) => updateForm("deal_value", value)}
                palette={palette}
              />
              <Field
                label="Currency"
                value={form.currency}
                onChange={(value) => updateForm("currency", value)}
                palette={palette}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field
                label="Expected Close Date (YYYY-MM-DD)"
                value={form.expected_close_date}
                onChange={(value) => updateForm("expected_close_date", value)}
                palette={palette}
              />
              <Field
                label="Owner Email"
                value={form.owner_email}
                onChange={(value) => updateForm("owner_email", value)}
                palette={palette}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field
                label="Jurisdiction"
                value={form.jurisdiction}
                onChange={(value) => updateForm("jurisdiction", value)}
                palette={palette}
              />
              <Field
                label="Industry"
                value={form.industry}
                onChange={(value) => updateForm("industry", value)}
                palette={palette}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field
                label="Materiality Threshold"
                value={form.materiality_threshold}
                onChange={(value) => updateForm("materiality_threshold", value)}
                palette={palette}
              />
              <Field
                label="Policy Profile"
                value={form.policy_profile}
                onChange={(value) => updateForm("policy_profile", value)}
                palette={palette}
              />
            </div>
          </div>
        </section>

        <section style={sectionStyle(palette)}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <h3 style={{ margin: 0 }}>Related Documents</h3>
            <button
              type="button"
              style={buttonStyle(palette)}
              onClick={() => setDocuments((prev) => [...prev, blankDocument()])}
            >
              Add Document
            </button>
          </div>
          <p style={{ marginTop: 8, color: palette.muted }}>
            For each document, provide either a source link (URI) or upload a local file.
          </p>

          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {documents.map((doc, idx) => (
              <article
                key={`doc-${idx}`}
                style={{
                  border: `1px dashed ${palette.line}`,
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <strong>Document {idx + 1}</strong>
                  {documents.length > 1 ? (
                    <button
                      type="button"
                      style={buttonStyle(palette)}
                      onClick={() =>
                        setDocuments((prev) => prev.filter((_, dIdx) => dIdx !== idx))
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    gridTemplateColumns: "1fr 1fr",
                  }}
                >
                  <Field
                    label="Document Name"
                    value={doc.document_name}
                    onChange={(value) =>
                      updateDocument(idx, "document_name", value)
                    }
                    palette={palette}
                  />
                  <Field
                    label="Document Type"
                    value={doc.document_type}
                    onChange={(value) =>
                      updateDocument(idx, "document_type", value)
                    }
                    palette={palette}
                  />
                  <Field
                    label="Source URI"
                    value={doc.source_uri}
                    onChange={(value) => updateDocument(idx, "source_uri", value)}
                    palette={palette}
                  />
                  <Field
                    label="MIME Type"
                    value={doc.mime_type}
                    onChange={(value) => updateDocument(idx, "mime_type", value)}
                    palette={palette}
                  />
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 13 }}>Upload Local File (optional)</span>
                    <input
                      key={`file-${idx}-${doc.file_upload?.file_name ?? "none"}`}
                      type="file"
                      onChange={(e) =>
                        void handleDocumentFileChange(idx, e.currentTarget.files)
                      }
                      style={{
                        width: "100%",
                        borderRadius: 8,
                        border: `1px solid ${palette.line}`,
                        background: palette.inputBg,
                        color: palette.inputText,
                        padding: "8px 10px",
                        fontFamily: "inherit",
                        fontSize: 14,
                      }}
                    />
                  </label>
                  {doc.file_upload ? (
                    <div
                      style={{
                        marginTop: 6,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ color: palette.muted, fontSize: 13 }}>
                        Selected: {doc.file_upload.file_name} (
                        {formatBytes(doc.file_upload.size_bytes)})
                      </span>
                      <button
                        type="button"
                        style={buttonStyle(palette)}
                        onClick={() => clearDocumentFile(idx)}
                      >
                        Clear File
                      </button>
                    </div>
                  ) : (
                    <p style={{ margin: "6px 0 0", color: palette.muted, fontSize: 13 }}>
                      No local file selected.
                    </p>
                  )}
                </div>
                <div style={{ marginTop: 8 }}>
                  <Field
                    label="Notes"
                    value={doc.notes}
                    onChange={(value) => updateDocument(idx, "notes", value)}
                    multiline
                    palette={palette}
                  />
                </div>
                <div style={{ marginTop: 8 }}>
                  <Field
                    label="Raw Text (optional)"
                    value={doc.raw_text}
                    onChange={(value) => updateDocument(idx, "raw_text", value)}
                    multiline
                    palette={palette}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section style={sectionStyle(palette)}>
          <h3 style={{ margin: "0 0 8px 0" }}>Run AI Document Analysis</h3>
          <p style={{ marginTop: 0, color: palette.muted }}>
            This runs `analyze_documents_with_openai` on all documents in the
            workspace and returns AI findings.
          </p>
          <Field
            label="Workspace ID (for analysis)"
            value={analysisWorkspaceId}
            onChange={setAnalysisWorkspaceId}
            palette={palette}
          />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <button
              type="button"
              style={buttonStyle(palette)}
              onClick={runOpenAiAnalysis}
              disabled={isSubmitting || isAnalyzingDocuments}
            >
              {isAnalyzingDocuments
                ? "Analyzing Documents..."
                : "Analyze Documents (OpenAI)"}
            </button>
            <button
              type="button"
              style={buttonStyle(palette)}
              onClick={() => void generateApprovedFindingsReport()}
              disabled={
                isSubmitting ||
                isAnalyzingDocuments ||
                isGeneratingReport ||
                analysisFindings.length === 0
              }
            >
              {isGeneratingReport
                ? "Generating Report..."
                : "Generate Approved Report (PDF)"}
            </button>
          </div>
          {analysisMessage ? (
            <p style={{ marginTop: 10, color: palette.muted }}>{analysisMessage}</p>
          ) : null}
          {analysisFindings.length > 0 ? (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {analysisFindings.map((finding) => (
                <button
                  key={finding.finding_id}
                  type="button"
                  onClick={() => {
                    setSelectedFindingId(finding.finding_id);
                    setAnalysisScenarioOutput(null);
                    setAnalysisGraphOutput(null);
                  }}
                  style={{
                    border: `1px solid ${palette.line}`,
                    borderRadius: 10,
                    padding: 10,
                    background:
                      selectedFindingId === finding.finding_id
                        ? palette.chip
                        : palette.card,
                    color: palette.text,
                    textAlign: "left",
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
          ) : null}
          {selectedAnalysisFinding ? (
            <div
              style={{
                marginTop: 12,
                border: `1px solid ${palette.line}`,
                borderRadius: 10,
                padding: 12,
                background: palette.card,
              }}
            >
              <h4 style={{ margin: "0 0 8px 0" }}>
                Finding Detail: {selectedAnalysisFinding.title}
              </h4>
              <p style={{ marginTop: 0, color: palette.muted }}>
                {selectedAnalysisFinding.summary}
              </p>
              <p style={{ marginTop: 0, color: palette.muted, fontSize: 13 }}>
                ID: {selectedAnalysisFinding.finding_id} | Document:{" "}
                {selectedAnalysisFinding.document_name} | Tower:{" "}
                {selectedAnalysisFinding.tower}
              </p>
              <p style={{ marginTop: 0, color: palette.muted, fontSize: 13 }}>
                Status: {selectedAnalysisFinding.status} | Probability:{" "}
                {selectedAnalysisFinding.probability.toFixed(2)} | Confidence:{" "}
                {selectedAnalysisFinding.confidence.toFixed(2)} | Impact:{" "}
                {selectedAnalysisFinding.impact_value.toLocaleString()}
              </p>
              {selectedAnalysisFinding.management_points.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    Executive Points
                  </div>
                  <ul style={{ marginTop: 6, color: palette.muted }}>
                    {selectedAnalysisFinding.management_points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <Field
                label="Decision Note (optional)"
                value={analysisDecisionReason}
                onChange={setAnalysisDecisionReason}
                multiline
                palette={palette}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button
                  type="button"
                  style={buttonStyle(palette)}
                  disabled={isUpdatingFindingStatus}
                  onClick={() => void decideSelectedFinding("approved")}
                >
                  {isUpdatingFindingStatus ? "Updating..." : "Approve Finding"}
                </button>
                <button
                  type="button"
                  style={buttonStyle(palette)}
                  disabled={isUpdatingFindingStatus}
                  onClick={() => void decideSelectedFinding("rejected")}
                >
                  {isUpdatingFindingStatus ? "Updating..." : "Reject Finding"}
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                <Field
                  label="Lawyer Plain-English Scenario Input"
                  value={analysisScenarioInput}
                  onChange={setAnalysisScenarioInput}
                  multiline
                  palette={palette}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <button
                    type="button"
                    style={buttonStyle(palette)}
                    disabled={isRunningScenario}
                    onClick={() => void runScenarioForSelectedFinding()}
                  >
                    {isRunningScenario
                      ? "Running Scenario..."
                      : "Run Plain-English Scenario"}
                  </button>
                  <button
                    type="button"
                    style={buttonStyle(palette)}
                    disabled={isLoadingGraph}
                    onClick={() => void loadWorkspaceGraph()}
                  >
                    {isLoadingGraph ? "Loading Graph..." : "View Graph"}
                  </button>
                </div>
              </div>

              {analysisScenarioOutput ? (
                <div
                  style={{
                    marginTop: 10,
                    border: `1px solid ${palette.line}`,
                    borderRadius: 8,
                    padding: 10,
                    background: palette.inputBg,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>Plain-English Result</div>
                  <p style={{ marginTop: 6, color: palette.muted }}>
                    {analysisScenarioOutput.legal_plaintext_assessment}
                  </p>
                  <p style={{ marginTop: 6, color: palette.muted }}>
                    Comparison: {analysisScenarioOutput.comparison_result}
                  </p>
                  {analysisScenarioOutput.executive_points.length > 0 ? (
                    <ul style={{ marginTop: 6, color: palette.muted }}>
                      {analysisScenarioOutput.executive_points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  ) : null}
                  {analysisScenarioOutput.evidence_points.length > 0 ? (
                    <ul style={{ marginTop: 6, color: palette.muted }}>
                      {analysisScenarioOutput.evidence_points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p style={{ marginTop: 6, color: palette.muted }}>
                    Recalibrated parameters: downside_multiplier=
                    {
                      analysisScenarioOutput.recalibrated_parameters
                        .downside_multiplier
                    }
                    , synergy_multiplier=
                    {
                      analysisScenarioOutput.recalibrated_parameters
                        .synergy_multiplier
                    }
                    , integration_cost=
                    {analysisScenarioOutput.recalibrated_parameters.integration_cost}
                  </p>
                  {analysisScenarioOutput.scenario_result ? (
                    <p style={{ marginTop: 6, color: palette.muted }}>
                      Scenario output: valuation_delta=
                      {analysisScenarioOutput.scenario_result.valuation_delta.toLocaleString()}
                      , integration_delta=
                      {analysisScenarioOutput.scenario_result.integration_delta.toLocaleString()}
                      , risk_delta=
                      {analysisScenarioOutput.scenario_result.risk_delta.toLocaleString()}
                    </p>
                  ) : null}
                  <p style={{ marginTop: 6, color: palette.muted }}>
                    {analysisScenarioOutput.management_explanation}
                  </p>
                  <p style={{ marginTop: 6, color: palette.muted }}>
                    {analysisScenarioOutput.management_plaintext}
                  </p>
                </div>
              ) : null}

              {analysisGraphOutput ? (
                <div
                  style={{
                    marginTop: 10,
                    border: `1px solid ${palette.line}`,
                    borderRadius: 8,
                    padding: 10,
                    background: palette.inputBg,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>Risk Graph Snapshot</div>
                  <p style={{ marginTop: 6, color: palette.muted }}>
                    Total weighted risk:{" "}
                    {analysisGraphOutput.total_weighted_risk.toLocaleString()} |
                    Open findings: {analysisGraphOutput.open_findings} |
                    Requires approval: {analysisGraphOutput.requires_approval}
                  </p>
                  {renderVisualGraph(analysisGraphOutput, palette)}
                  {analysisGraphOutput.scenario_overlay ? (
                    <p style={{ marginTop: 8, color: palette.muted }}>
                      {analysisGraphOutput.scenario_overlay.label}: risk_delta=
                      {analysisGraphOutput.scenario_overlay.risk_delta.toLocaleString()}
                      , valuation_delta=
                      {analysisGraphOutput.scenario_overlay.valuation_delta.toLocaleString()}
                      , integration_delta=
                      {analysisGraphOutput.scenario_overlay.integration_delta.toLocaleString()}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {approvedReport ? (
            <div
              style={{
                marginTop: 12,
                border: `1px solid ${palette.line}`,
                borderRadius: 10,
                padding: 12,
                background: palette.card,
              }}
            >
              <h4 style={{ margin: "0 0 8px 0" }}>{approvedReport.report_title}</h4>
              <p style={{ marginTop: 0, color: palette.muted }}>
                {approvedReport.executive_summary}
              </p>
              <p style={{ marginTop: 0, color: palette.muted, fontSize: 13 }}>
                Approved: {approvedReport.approved_count} | Pending:{" "}
                {approvedReport.pending_count} | Rejected:{" "}
                {approvedReport.rejected_count}
              </p>
              <ul style={{ marginTop: 8, color: palette.muted }}>
                {approvedReport.key_points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <p style={{ marginTop: 8, color: palette.muted }}>
                {approvedReport.final_recommendation}
              </p>
              <button
                type="button"
                style={buttonStyle(palette)}
                onClick={() =>
                  downloadBase64Pdf(
                    approvedReport.pdf.base64,
                    approvedReport.pdf.file_name
                  )
                }
              >
                Download PDF Report
              </button>
            </div>
          ) : null}
        </section>

        <section style={sectionStyle(palette)}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              style={buttonStyle(palette)}
              onClick={() => void submitIntake()}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting..." : "Submit Intake"}
            </button>
            <button
              type="button"
              style={buttonStyle(palette)}
              onClick={() => void submitIntake({ analyzeAfterSubmit: true })}
              disabled={isSubmitting || isAnalyzingDocuments}
            >
              {isSubmitting || isAnalyzingDocuments
                ? "Submitting + Analyzing..."
                : "Submit Intake + Analyze Documents"}
            </button>
            <button
              type="button"
              style={buttonStyle(palette)}
              onClick={() => {
                setForm(defaultIntakeForm);
                setDocuments([blankDocument()]);
                setSubmitMessage(null);
                setCreatedWorkspaceId(null);
                setCreatedDealId(null);
                setAnalysisWorkspaceId("");
                clearAnalysisOutputs();
              }}
              disabled={isSubmitting}
            >
              Reset Form
            </button>
          </div>
          {submitMessage ? (
            <p style={{ marginTop: 10, color: palette.muted }}>
              {submitMessage}
              {createdWorkspaceId ? ` Workspace ID: ${createdWorkspaceId}.` : ""}
              {createdDealId ? ` Supabase Deal ID: ${createdDealId}.` : ""}
            </p>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div
      style={{
        background: palette.page,
        color: palette.text,
        minHeight: "100vh",
        padding: 16,
        fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
      }}
    >
      <section
        style={{
          background: `linear-gradient(135deg, ${palette.heroA}, ${palette.heroB})`,
          color: "#eef6ff",
          borderRadius: 14,
          padding: 16,
          border: `1px solid ${palette.line}`,
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: "rgba(255,255,255,0.16)",
            borderRadius: 999,
            padding: "5px 10px",
            fontSize: 12,
            letterSpacing: 0.5,
            marginBottom: 10,
          }}
        >
          MCP Product Home
        </div>
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>
          Full-Spectrum M&A Due-Diligence Copilot
        </h1>
        <p style={{ margin: 0, color: "#dbeafe", maxWidth: 760 }}>
          A governed acquisition workspace where legal, finance, operations, and
          management teams collaborate with an AI orchestration agent from first
          document upload to investment committee decision.
        </p>
      </section>

      <section style={sectionStyle(palette)}>
        <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>What The App Does</h2>
        <p style={{ margin: 0, color: palette.muted }}>
          The app ingests diligence evidence, detects risks and contradictions,
          enforces approval gates, runs valuation/integration scenarios, and
          generates decision-ready IC packages with provenance.
        </p>

        <div
          style={{
            marginTop: 12,
            border: `1px solid ${palette.line}`,
            borderRadius: 10,
            padding: 10,
          }}
        >
          <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>
            Start A New Deal Intake
          </h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => startIntake("merger")}
              style={buttonStyle(palette)}
            >
              Create New Merger
            </button>
            <button
              type="button"
              onClick={() => startIntake("acquisition")}
              style={buttonStyle(palette)}
            >
              Create New Acquisition
            </button>
          </div>
          <p style={{ margin: "8px 0 0", color: palette.muted }}>
            Clicking either button opens the deal-intake form page.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setShowWorkflow((v) => !v)}
            style={buttonStyle(palette)}
          >
            {showWorkflow ? "Hide Workflow" : "Show Merger Workflow"}
          </button>
          <button
            type="button"
            onClick={() => setShowAgentRole((v) => !v)}
            style={buttonStyle(palette)}
          >
            {showAgentRole ? "Hide AI Role" : "Show AI Agent Role"}
          </button>
        </div>
      </section>

      {showWorkflow ? (
        <section style={sectionStyle(palette)}>
          <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>
            Standard Merger/Acquisition Workflow
          </h2>
          <div style={{ display: "grid", gap: 8 }}>
            {workflowSteps.map((step, idx) => (
              <article
                key={step.title}
                style={{
                  border: `1px dashed ${palette.line}`,
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    background: palette.chip,
                    color: palette.chipText,
                    borderRadius: 999,
                    padding: "3px 8px",
                    fontSize: 12,
                    marginBottom: 6,
                  }}
                >
                  Step {idx + 1}
                </div>
                <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>{step.title}</h3>
                <p style={{ margin: 0, color: palette.muted }}>{step.body}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {showAgentRole ? (
        <section style={sectionStyle(palette)}>
          <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>
            Where The AI Agent Comes Into Play
          </h2>
          <ul style={{ margin: 0, paddingLeft: 18, color: palette.muted }}>
            {agentRoleItems.map((item) => (
              <li key={item} style={{ marginBottom: 6 }}>
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );

  function startIntake(kind: DealType) {
    setIntakeDealType(kind);
    setCurrentView("intake");
    setSubmitMessage(null);
    setCreatedWorkspaceId(null);
    setCreatedDealId(null);
    setAnalysisWorkspaceId("");
    clearAnalysisOutputs();
    setForm((prev) => ({
      ...prev,
      deal_name: "",
      target_name: "",
      thesis:
        kind === "merger"
          ? "Evaluate strategic merger fit, concentration risk, and integration feasibility."
          : "Evaluate acquisition value, downside protection, and Day-1 execution plan.",
    }));
  }

  function fillSampleIntake() {
    const sample = buildSampleIntake(
      intakeDealType,
      form.tenant_id.trim() || "tenant-demo"
    );
    setForm(sample.form);
    setDocuments(sample.documents);
    setCreatedWorkspaceId(null);
    setCreatedDealId(null);
    setAnalysisWorkspaceId("");
    clearAnalysisOutputs();
    setAnalysisMessage(
      "Sample demo details loaded. Submit intake first, then run Analyze Documents."
    );
    setSubmitMessage(
      "Sample demo details loaded. Review values, then click Submit Intake."
    );
  }

  function updateForm<K extends keyof IntakeForm>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateDocument<K extends DocumentTextField>(
    index: number,
    key: K,
    value: string
  ) {
    setDocuments((prev) =>
      prev.map((doc, idx) => (idx === index ? { ...doc, [key]: value } : doc))
    );
  }

  function clearDocumentFile(index: number) {
    setDocuments((prev) =>
      prev.map((doc, idx) =>
        idx === index ? { ...doc, file_upload: undefined } : doc
      )
    );
    setSubmitMessage(null);
  }

  async function handleDocumentFileChange(index: number, files: FileList | null) {
    const file = files?.[0];
    if (!file) {
      clearDocumentFile(index);
      return;
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      setSubmitMessage(
        `File '${file.name}' is too large. Max allowed is ${formatBytes(
          MAX_UPLOAD_FILE_BYTES
        )}.`
      );
      return;
    }

    try {
      const base64 = await readFileAsBase64(file);
      setDocuments((prev) =>
        prev.map((doc, idx) =>
          idx === index
            ? {
                ...doc,
                document_name: doc.document_name.trim() || file.name,
                mime_type: doc.mime_type.trim() || file.type || "application/octet-stream",
                file_upload: {
                  file_name: file.name,
                  mime_type: file.type || "application/octet-stream",
                  size_bytes: file.size,
                  base64,
                },
              }
            : doc
        )
      );
      setSubmitMessage(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not read selected file.";
      setSubmitMessage(`Could not attach local file: ${message}`);
    }
  }

  async function submitIntake(
    options: { analyzeAfterSubmit?: boolean } = {}
  ): Promise<void> {
    setIsSubmitting(true);
    setSubmitMessage(null);
    setCreatedWorkspaceId(null);
    setCreatedDealId(null);

    if (!form.deal_name || !form.acquirer_name || !form.target_name || !form.thesis) {
      setSubmitMessage(
        "Please fill deal name, acquirer name, target name, and thesis."
      );
      setIsSubmitting(false);
      return;
    }

    const preparedDocuments = documents
      .filter(
        (doc) =>
          doc.document_name.trim().length > 0 ||
          doc.source_uri.trim().length > 0 ||
          Boolean(doc.file_upload)
      )
      .map((doc) => ({
        document_name: doc.document_name.trim(),
        document_type: doc.document_type.trim(),
        source_uri: doc.source_uri.trim(),
        mime_type: doc.mime_type.trim(),
        notes: doc.notes.trim(),
        raw_text: doc.raw_text.trim(),
        metadata: doc.metadata,
        file_upload: doc.file_upload,
      }));

    const invalidDocument = preparedDocuments.find(
      (doc) =>
        doc.document_name.length < 2 ||
        doc.document_type.length < 2 ||
        (doc.source_uri.length === 0 && !doc.file_upload)
    );
    if (invalidDocument) {
      setSubmitMessage(
        "Each document must include a name, type, and either Source URI or Local File."
      );
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await callTool("submit_deal_intake", {
        tenant_id: form.tenant_id,
        deal_type: intakeDealType,
        deal_name: form.deal_name,
        acquirer_name: form.acquirer_name,
        target_name: form.target_name,
        thesis: form.thesis,
        deal_value:
          form.deal_value.trim().length > 0 ? Number(form.deal_value) : undefined,
        currency: form.currency,
        expected_close_date:
          form.expected_close_date.trim().length > 0
            ? form.expected_close_date
            : undefined,
        jurisdiction:
          form.jurisdiction.trim().length > 0 ? form.jurisdiction : undefined,
        industry: form.industry.trim().length > 0 ? form.industry : undefined,
        owner_email:
          form.owner_email.trim().length > 0 ? form.owner_email : undefined,
        materiality_threshold:
          form.materiality_threshold.trim().length > 0
            ? Number(form.materiality_threshold)
            : 4_500_000,
        policy_profile: form.policy_profile,
        documents: preparedDocuments.map((doc) => ({
            document_name: doc.document_name,
            document_type: doc.document_type,
            source_uri: doc.source_uri.length > 0 ? doc.source_uri : undefined,
            mime_type: doc.mime_type.length > 0 ? doc.mime_type : undefined,
            notes: doc.notes.length > 0 ? doc.notes : undefined,
            raw_text: doc.raw_text.length > 0 ? doc.raw_text : undefined,
            metadata: doc.metadata,
            file_upload: doc.file_upload,
          })),
      });

      const structured = toObject(result.structuredContent);
      const workspace = toObject(structured.workspace);
      const persistence = toObject(structured.persistence);
      const workspaceId = asString(workspace.workspace_id);
      const dealId = asString(persistence.inserted_deal_id);

      setCreatedWorkspaceId(workspaceId);
      setCreatedDealId(dealId);
      setAnalysisWorkspaceId(workspaceId ?? "");
      setAnalysisMessage(
        workspaceId
          ? `Workspace ready for AI analysis: ${workspaceId}`
          : null
      );
      setAnalysisFindings([]);
      setSelectedFindingId(null);
      setAnalysisScenarioInput("");
      setAnalysisDecisionReason("");
      setAnalysisScenarioOutput(null);
      setAnalysisGraphOutput(null);
      setApprovedReport(null);
      setSubmitMessage("Deal intake submitted and persisted.");
      if (options.analyzeAfterSubmit && workspaceId) {
        await runOpenAiAnalysisByWorkspaceId(workspaceId);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown intake submission error.";
      setSubmitMessage(`Could not submit intake: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runOpenAiAnalysis() {
    const workspaceId = analysisWorkspaceId.trim();
    if (!workspaceId) {
      setAnalysisMessage(
        "Workspace ID is required. Submit intake first or paste a workspace ID."
      );
      return;
    }
    await runOpenAiAnalysisByWorkspaceId(workspaceId);
  }

  async function runOpenAiAnalysisByWorkspaceId(
    workspaceId: string
  ): Promise<void> {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      setAnalysisMessage(
        "Workspace ID is required. Submit intake first or paste a workspace ID."
      );
      return;
    }
    setAnalysisWorkspaceId(normalizedWorkspaceId);
    setIsAnalyzingDocuments(true);
    setAnalysisMessage(null);
    setAnalysisFindings([]);
    setSelectedFindingId(null);
    setAnalysisScenarioInput("");
    setAnalysisDecisionReason("");
    setAnalysisScenarioOutput(null);
    setAnalysisGraphOutput(null);
    setApprovedReport(null);
    try {
      const result = await callTool("analyze_documents_with_openai", {
        workspace_id: normalizedWorkspaceId,
        as_widget: false,
        max_findings_per_document: 5,
      });
      const structured = toObject(result.structuredContent);
      const findings = toObjectArray(structured.findings)
        .map((item): AnalysisFindingPreview => {
          const status = parseFindingStatus(item.status);
          return {
            finding_id: asString(item.finding_id) ?? "",
            document_id: asString(item.document_id) ?? "",
            document_name: asString(item.document_name) ?? "Unknown document",
            title: asString(item.title) ?? "Untitled finding",
            summary: asString(item.summary) ?? "",
            management_points: toStringArray(item.management_points),
            tower: asString(item.tower) ?? "unknown",
            severity: asString(item.severity) ?? "unknown",
            status,
            probability: asNumber(item.probability) ?? 0,
            confidence: asNumber(item.confidence) ?? 0,
            impact_value: asNumber(item.impact_value) ?? 0,
          };
        })
        .filter((item) => item.finding_id.length > 0);

      const findingsTotal =
        typeof structured.findings_total === "number"
          ? structured.findings_total
          : findings.length;
      setAnalysisFindings(findings);
      if (findings.length > 0) {
        setSelectedFindingId(findings[0]!.finding_id);
      }
      setAnalysisMessage(
        `AI analysis completed. Total findings: ${findingsTotal}. Click any finding to review and decide.`
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown OpenAI analysis error.";
      setAnalysisMessage(`Could not analyze documents: ${message}`);
    } finally {
      setIsAnalyzingDocuments(false);
    }
  }

  async function decideSelectedFinding(
    decision: "approved" | "rejected"
  ): Promise<void> {
    const workspaceId = analysisWorkspaceId.trim();
    if (!workspaceId || !selectedAnalysisFinding) {
      setAnalysisMessage("Select a finding first.");
      return;
    }

    setIsUpdatingFindingStatus(true);
    setAnalysisMessage(null);
    try {
      const result = await callTool("set_ai_finding_status", {
        workspace_id: workspaceId,
        finding_id: selectedAnalysisFinding.finding_id,
        decision,
        reason:
          analysisDecisionReason.trim().length > 0
            ? analysisDecisionReason
            : undefined,
      });
      const structured = toObject(result.structuredContent);
      const updatedFinding = toObject(structured.finding);
      const updatedStatus = asString(updatedFinding.status);
      setAnalysisFindings((prev) =>
        prev.map((finding) =>
          finding.finding_id === selectedAnalysisFinding.finding_id &&
          (updatedStatus === "approved" ||
            updatedStatus === "rejected" ||
            updatedStatus === "requires_approval")
            ? { ...finding, status: updatedStatus }
            : finding
        )
      );
      setAnalysisMessage(`Finding ${decision}.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown status update error.";
      setAnalysisMessage(`Could not update finding status: ${message}`);
    } finally {
      setIsUpdatingFindingStatus(false);
    }
  }

  async function runScenarioForSelectedFinding(): Promise<void> {
    const workspaceId = analysisWorkspaceId.trim();
    if (!workspaceId || !selectedAnalysisFinding) {
      setAnalysisMessage("Select a finding first.");
      return;
    }
    if (analysisScenarioInput.trim().length < 12) {
      setAnalysisMessage(
        "Enter a plain-English scenario (at least 12 characters)."
      );
      return;
    }

    setIsRunningScenario(true);
    setAnalysisScenarioOutput(null);
    setAnalysisMessage(null);
    try {
      const result = await callTool("run_ai_finding_plaintext_scenario", {
        workspace_id: workspaceId,
        finding_id: selectedAnalysisFinding.finding_id,
        plain_english: analysisScenarioInput,
      });
      const structured = toObject(result.structuredContent);
      const comparison = toObject(structured.comparison);
      const recalibrated = toObject(structured.recalibrated_parameters);
      const scenarioResult = toObject(structured.scenario_result);

      setAnalysisScenarioOutput({
        comparison_result: asString(comparison.comparison_result) ?? "unclear",
        legal_plaintext_assessment:
          asString(comparison.legal_plaintext_assessment) ?? "",
        executive_points: toStringArray(comparison.executive_points),
        evidence_points: toStringArray(comparison.evidence_points),
        recalibrated_parameters: {
          downside_multiplier:
            asNumber(recalibrated.downside_multiplier) ?? 1,
          synergy_multiplier: asNumber(recalibrated.synergy_multiplier) ?? 1,
          integration_cost: asNumber(recalibrated.integration_cost) ?? 0,
        },
        management_explanation:
          asString(comparison.management_explanation) ?? "",
        management_plaintext: asString(structured.management_plaintext) ?? "",
        scenario_result:
          scenarioResult && Object.keys(scenarioResult).length > 0
            ? {
                valuation_delta: asNumber(scenarioResult.valuation_delta) ?? 0,
                integration_delta:
                  asNumber(scenarioResult.integration_delta) ?? 0,
                risk_delta: asNumber(scenarioResult.risk_delta) ?? 0,
                confidence_band:
                  toNumberPair(scenarioResult.confidence_band) ?? [0, 0],
              }
            : null,
      });
      setAnalysisMessage("Scenario run completed.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown scenario execution error.";
      setAnalysisMessage(`Could not run scenario: ${message}`);
    } finally {
      setIsRunningScenario(false);
    }
  }

  async function loadWorkspaceGraph(): Promise<void> {
    const workspaceId = analysisWorkspaceId.trim();
    if (!workspaceId) {
      setAnalysisMessage("Workspace ID is required.");
      return;
    }
    setIsLoadingGraph(true);
    setAnalysisGraphOutput(null);
    setAnalysisMessage(null);
    try {
      const result = await callTool("generate_visual_risk_graph", {
        workspace_id: workspaceId,
        finding_id: selectedAnalysisFinding?.finding_id,
        scenario_parameters: analysisScenarioOutput?.recalibrated_parameters,
      });
      const structured = toObject(result.structuredContent);
      const graph = toObject(structured.graph);
      const bars = toObjectArray(graph.bars)
        .map((bar): VisualGraphBar | null => {
          const label = asString(bar.label);
          const key = asString(bar.key);
          const value = asNumber(bar.value);
          const color = asString(bar.color);
          if (!label || !key || value === null || !color) {
            return null;
          }
          return { key, label, value, color };
        })
        .filter((bar): bar is VisualGraphBar => Boolean(bar));
      const statusBreakdown = toObjectArray(graph.status_breakdown)
        .map((item): VisualGraphBreakdown | null => {
          const key = asString(item.key);
          const label = asString(item.label);
          const count = asNumber(item.count);
          const color = asString(item.color);
          if (!key || !label || count === null || !color) {
            return null;
          }
          return { key, label, count, color };
        })
        .filter((item): item is VisualGraphBreakdown => Boolean(item));
      const severityBreakdown = toObjectArray(graph.severity_breakdown)
        .map((item): VisualGraphBreakdown | null => {
          const key = asString(item.key);
          const label = asString(item.label);
          const count = asNumber(item.count);
          const color = asString(item.color);
          if (!key || !label || count === null || !color) {
            return null;
          }
          return { key, label, count, color };
        })
        .filter((item): item is VisualGraphBreakdown => Boolean(item));
      const overlayRaw = toObject(graph.scenario_overlay);
      const overlay =
        Object.keys(overlayRaw).length > 0
          ? {
              label: asString(overlayRaw.label) ?? "Scenario overlay",
              risk_delta: asNumber(overlayRaw.risk_delta) ?? 0,
              valuation_delta: asNumber(overlayRaw.valuation_delta) ?? 0,
              integration_delta: asNumber(overlayRaw.integration_delta) ?? 0,
            }
          : null;

      setAnalysisGraphOutput({
        title: asString(graph.title) ?? "Risk Landscape",
        subtitle: asString(graph.subtitle) ?? "",
        total_weighted_risk: asNumber(graph.total_weighted_risk) ?? 0,
        open_findings: asNumber(graph.open_findings) ?? 0,
        requires_approval: asNumber(graph.requires_approval) ?? 0,
        y_max: asNumber(graph.y_max) ?? 1,
        bars,
        status_breakdown: statusBreakdown,
        severity_breakdown: severityBreakdown,
        scenario_overlay: overlay,
      });
      setAnalysisMessage("Risk graph loaded.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown risk graph error.";
      setAnalysisMessage(`Could not load graph: ${message}`);
    } finally {
      setIsLoadingGraph(false);
    }
  }

  function clearAnalysisOutputs() {
    setAnalysisMessage(null);
    setAnalysisFindings([]);
    setSelectedFindingId(null);
    setAnalysisDecisionReason("");
    setAnalysisScenarioInput("");
    setAnalysisScenarioOutput(null);
    setAnalysisGraphOutput(null);
    setApprovedReport(null);
  }

  async function generateApprovedFindingsReport(): Promise<void> {
    const workspaceId = analysisWorkspaceId.trim();
    if (!workspaceId) {
      setAnalysisMessage("Workspace ID is required.");
      return;
    }
    setIsGeneratingReport(true);
    setApprovedReport(null);
    setAnalysisMessage(null);
    try {
      const result = await callTool("generate_approved_findings_report", {
        workspace_id: workspaceId,
      });
      const structured = toObject(result.structuredContent);
      const report = toObject(structured.report);
      const pdf = toObject(report.pdf);
      setApprovedReport({
        generated_at: asString(report.generated_at) ?? "",
        approved_count: asNumber(report.approved_count) ?? 0,
        pending_count: asNumber(report.pending_count) ?? 0,
        rejected_count: asNumber(report.rejected_count) ?? 0,
        report_title: asString(report.report_title) ?? "Approved Findings Report",
        executive_summary: asString(report.executive_summary) ?? "",
        key_points: toStringArray(report.key_points),
        approved_findings_digest: toObjectArray(report.approved_findings_digest)
          .map((item) => ({
            finding_id: asString(item.finding_id) ?? "",
            headline: asString(item.headline) ?? "",
            business_impact: asString(item.business_impact) ?? "",
            recommended_action: asString(item.recommended_action) ?? "",
          }))
          .filter(
            (item) =>
              item.finding_id.length > 0 &&
              item.headline.length > 0 &&
              item.business_impact.length > 0 &&
              item.recommended_action.length > 0
          ),
        final_recommendation: asString(report.final_recommendation) ?? "",
        pdf: {
          file_name: asString(pdf.file_name) ?? "approved-findings-report.pdf",
          mime_type: asString(pdf.mime_type) ?? "application/pdf",
          base64: asString(pdf.base64) ?? "",
        },
      });
      setAnalysisMessage("Approved findings report generated.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown report generation error.";
      setAnalysisMessage(`Could not generate report: ${message}`);
    } finally {
      setIsGeneratingReport(false);
    }
  }
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

function parseFindingStatus(
  value: unknown
): "requires_approval" | "approved" | "rejected" {
  if (value === "approved" || value === "rejected" || value === "requires_approval") {
    return value;
  }
  return "requires_approval";
}

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item)
  );
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function toNumberPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const first = asNumber(value[0]);
  const second = asNumber(value[1]);
  if (first === null || second === null) {
    return null;
  }
  return [first, second];
}

function renderVisualGraph(
  graph: VisualGraphPayload,
  palette: { muted: string; line: string }
) {
  if (graph.bars.length === 0) {
    return (
      <p style={{ marginTop: 8, color: palette.muted }}>
        No tower bars available for visualization.
      </p>
    );
  }

  const width = 700;
  const height = 260;
  const left = 52;
  const right = 20;
  const top = 18;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const yMax = Math.max(graph.y_max, 1);
  const slot = plotWidth / graph.bars.length;
  const barWidth = Math.max(16, slot - 22);

  return (
    <div style={{ marginTop: 10 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: "100%",
          maxWidth: 760,
          border: `1px solid ${palette.line}`,
          borderRadius: 8,
          background: "transparent",
        }}
      >
        <line
          x1={left}
          y1={top}
          x2={left}
          y2={height - bottom}
          stroke={palette.line}
        />
        <line
          x1={left}
          y1={height - bottom}
          x2={width - right}
          y2={height - bottom}
          stroke={palette.line}
        />
        {graph.bars.map((bar, index) => {
          const ratio = Math.max(0, Math.min(1, bar.value / yMax));
          const barHeight = ratio * plotHeight;
          const x = left + index * slot + (slot - barWidth) / 2;
          const y = height - bottom - barHeight;
          return (
            <g key={`${bar.key}-${index}`}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(2, barHeight)}
                fill={bar.color}
                rx={4}
              />
              <text
                x={x + barWidth / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize="10"
                fill={palette.muted}
              >
                {bar.value.toLocaleString()}
              </text>
              <text
                x={x + barWidth / 2}
                y={height - bottom + 14}
                textAnchor="middle"
                fontSize="10"
                fill={palette.muted}
              >
                {truncateLabel(bar.label, 15)}
              </text>
            </g>
          );
        })}
      </svg>
      <p style={{ marginTop: 8, color: palette.muted }}>{graph.subtitle}</p>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ color: palette.muted, fontSize: 13 }}>
          Status mix:{" "}
          {graph.status_breakdown
            .map((item) => `${item.label} (${item.count})`)
            .join(" | ")}
        </div>
        <div style={{ color: palette.muted, fontSize: 13 }}>
          Severity mix:{" "}
          {graph.severity_breakdown
            .map((item) => `${item.label} (${item.count})`)
            .join(" | ")}
        </div>
      </div>
    </div>
  );
}

function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(1, maxLength - 3))}...`;
}

function downloadBase64Pdf(base64: string, fileName: string): void {
  if (!base64 || typeof window === "undefined") {
    return;
  }
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "approved-findings-report.pdf";
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  palette: {
    line: string;
    inputBg: string;
    inputText: string;
  };
}) {
  const style = {
    width: "100%",
    borderRadius: 8,
    border: `1px solid ${props.palette.line}`,
    background: props.palette.inputBg,
    color: props.palette.inputText,
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: 14,
  } as const;

  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 13 }}>{props.label}</span>
      {props.multiline ? (
        <textarea
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          rows={3}
          style={style}
        />
      ) : (
        <input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          style={style}
        />
      )}
    </label>
  );
}

function sectionStyle(palette: {
  card: string;
  line: string;
}) {
  return {
    marginTop: 14,
    background: palette.card,
    borderRadius: 14,
    border: `1px solid ${palette.line}`,
    padding: 14,
  } as const;
}

function buttonStyle(palette: {
  button: string;
  buttonText: string;
}) {
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

function readRouteState(): { view: "home" | "intake"; dealType: DealType } {
  if (typeof window === "undefined") {
    return { view: "home", dealType: "acquisition" };
  }

  const isSrcDoc =
    window.location.protocol === "about:" ||
    window.location.href.startsWith("about:srcdoc");
  if (isSrcDoc) {
    return { view: "home", dealType: "acquisition" };
  }

  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") === "intake" ? "intake" : "home";
  const dealType = params.get("deal_type") === "merger" ? "merger" : "acquisition";

  return { view, dealType };
}

function buildSampleIntake(
  kind: DealType,
  tenantId: string
): { form: IntakeForm; documents: DealDocumentForm[] } {
  if (kind === "merger") {
    return {
      form: {
        tenant_id: tenantId,
        deal_name: "Asteron Systems + Meridian Workflow Group Merger (Fictional)",
        acquirer_name: "Asteron Systems, Inc.",
        target_name: "Meridian Workflow Group (Fictional)",
        thesis:
          "Combine regulated-operations workflow capabilities with complementary distribution while preserving governance rigor and security controls.",
        deal_value: "980000000",
        currency: "USD",
        expected_close_date: "2026-11-30",
        jurisdiction: "US",
        industry: "B2B Workflow Automation Software",
        owner_email: "governance@asteron.example",
        materiality_threshold: "6000000",
        policy_profile: "strict-default",
      },
      documents: [
        {
          document_name: "Asteron Company Structure & Governance Manual",
          document_type: "governance",
          source_uri:
            "file:///Users/hamidsadjadpour/Desktop/mcp-use/main-repo/ma-due-diligence-copilot/demo-docs/fictional_company_structure_manual.pdf",
          mime_type: "application/pdf",
          notes:
            "Primary governance baseline document used for diligence on controls, approval rights, and escalation model.",
          raw_text:
            "Document ID AS-GOV-0007, version 0.9 demo, effective date February 21, 2026.",
          metadata: {
            source_system: "demo-docs",
            company_name: "Asteron Systems, Inc.",
            document_id: "AS-GOV-0007",
            document_version: "0.9 (Demo)",
            effective_date: "2026-02-21",
            owner: "Operations Excellence (Fictional)",
            approved_by: "Executive Leadership Team (Fictional)",
            confidentiality: "Internal - Demo Use Only",
            primary_contact: "governance@asteron.example",
            fictional_sample: true,
          },
        },
        {
          document_name: "Asteron Governance Contacts and Committees Extract",
          document_type: "governance_extract",
          source_uri:
            "file:///Users/hamidsadjadpour/Desktop/mcp-use/main-repo/ma-due-diligence-copilot/demo-docs/fictional_company_structure_manual.pdf#appendix-b",
          mime_type: "application/pdf",
          notes:
            "Derived extract for key contacts, committee cadence, and escalation path checks.",
          raw_text:
            "Key contacts include governance@asteron.example, security@asteron.example, legal@asteron.example, finance@asteron.example.",
          metadata: {
            source_system: "demo-docs",
            company_name: "Asteron Systems, Inc.",
            section_refs: [
              "3. Committees, Councils, and Cadence",
              "3.2 Escalation path",
              "Appendix B. Key Contacts (Fictional)",
            ],
            fictional_sample: true,
          },
        },
      ],
    };
  }

  return {
    form: {
      tenant_id: tenantId,
      deal_name: "Acquisition of Asteron Systems, Inc. (Fictional)",
      acquirer_name: "Redwood Harbor Capital Partners (Fictional)",
      target_name: "Asteron Systems, Inc.",
      thesis:
        "Acquire Asteron to strengthen regulated-operations workflow capabilities with established governance and policy maturity.",
      deal_value: "640000000",
      currency: "USD",
      expected_close_date: "2026-10-15",
      jurisdiction: "US",
      industry: "B2B Workflow Automation Software",
      owner_email: "governance@asteron.example",
      materiality_threshold: "4500000",
      policy_profile: "strict-default",
    },
    documents: [
      {
        document_name: "Asteron Company Structure & Governance Manual",
        document_type: "governance",
        source_uri:
          "file:///Users/hamidsadjadpour/Desktop/mcp-use/main-repo/ma-due-diligence-copilot/demo-docs/fictional_company_structure_manual.pdf",
        mime_type: "application/pdf",
        notes:
          "Used to diligence management structure, committees, and decision-rights matrices.",
        raw_text:
          "Asteron uses lightweight governance with ELT ownership for strategy and risk and documented, auditable decisions.",
        metadata: {
          source_system: "demo-docs",
          company_name: "Asteron Systems, Inc.",
          document_id: "AS-GOV-0007",
          document_version: "0.9 (Demo)",
          legal_name: "Asteron Systems, Inc. (fictional)",
          headquarters:
            "2147 Meridian Way, Redwood Harbor, CA 94000 (fictional address)",
          fictional_sample: true,
        },
      },
      {
        document_name: "Asteron Policy and Operating Model Extract",
        document_type: "policy_extract",
        source_uri:
          "file:///Users/hamidsadjadpour/Desktop/mcp-use/main-repo/ma-due-diligence-copilot/demo-docs/fictional_company_structure_manual.pdf#section-5-6",
        mime_type: "application/pdf",
        notes:
          "Focuses on policy summaries, planning cadence, CAB requirements, and incident roles.",
        raw_text:
          "Security incidents are expected to be reported within 30 minutes and Sev 1 events notify ELT immediately.",
        metadata: {
          source_system: "demo-docs",
          company_name: "Asteron Systems, Inc.",
          section_refs: [
            "5. Core Policies (Summaries)",
            "6. Operating Model and Ways of Working",
            "6.4 Incident management (summary)",
          ],
          fictional_sample: true,
        },
      },
    ],
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readFileAsBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unexpected file reader result"));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Could not parse file payload");
  }

  return dataUrl.slice(commaIndex + 1);
}
