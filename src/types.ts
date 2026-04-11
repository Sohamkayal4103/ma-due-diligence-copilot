export type DiligenceTower =
  | "financial"
  | "legal_regulatory"
  | "commercial_market"
  | "operations_supply_chain"
  | "people_hr"
  | "tax_jurisdiction"
  | "technical_cyber";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type WorkspaceStatus =
  | "created"
  | "active"
  | "review"
  | "signed"
  | "closed";

export type FindingStatus =
  | "open"
  | "requires_approval"
  | "approved"
  | "rejected"
  | "resolved";

export type PackageType =
  | "executive_summary"
  | "full_ic"
  | "red_flag_register"
  | "day1_day100";

export type Decision = "approved" | "rejected";

export type WorkspaceRole = "admin" | "reviewer" | "analyst" | "viewer";

export interface Actor {
  user_id: string;
  tenant_id: string;
  role: WorkspaceRole;
  scopes: string[];
}

export interface WorkspaceParticipant {
  user_id: string;
  role: WorkspaceRole;
  added_at: string;
}

export interface Workspace {
  workspace_id: string;
  tenant_id: string;
  deal_name: string;
  thesis: string;
  status: WorkspaceStatus;
  policy_profile: string;
  materiality_threshold: number;
  enabled_towers: DiligenceTower[];
  participants: WorkspaceParticipant[];
  created_at: string;
  updated_at: string;
}

export interface EvidenceClaim {
  subject: string;
  field: string;
  value: string;
}

export interface EvidenceArtifact {
  artifact_id: string;
  workspace_id: string;
  source_server: string;
  source_uri: string;
  captured_at: string;
  checksum: string;
  classification: string;
  tower: DiligenceTower;
  content: string;
  claims: EvidenceClaim[];
  metadata: Record<string, unknown>;
}

export interface CanonicalEntity {
  entity_id: string;
  workspace_id: string;
  entity_type: string;
  attributes: Record<string, unknown>;
  source_refs: string[];
}

export interface ProvenanceRef {
  finding_id: string;
  artifact_id: string;
  transformation_step: string;
  quoted_span: string;
  timestamp: string;
}

export interface Finding {
  finding_id: string;
  workspace_id: string;
  tower: DiligenceTower;
  severity: RiskSeverity;
  probability: number;
  impact_value: number;
  confidence: number;
  status: FindingStatus;
  title: string;
  summary: string;
  evidence_refs: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ScenarioDefinition {
  name: string;
  assumptions: Record<string, number>;
}

export interface ScenarioResult {
  scenario_id: string;
  workspace_id: string;
  assumptions: Record<string, number>;
  valuation_delta: number;
  integration_delta: number;
  risk_delta: number;
  confidence_band: [number, number];
}

export interface ApprovalRequest {
  approval_id: string;
  workspace_id: string;
  object_type: "finding";
  object_id: string;
  risk_level: RiskSeverity;
  requested_by: string;
  decision: Decision | null;
  reason: string | null;
  requested_at: string;
  decided_at: string | null;
}

export interface AuditLedgerEntry {
  entry_id: string;
  workspace_id: string;
  action: string;
  actor_id: string;
  object_type: string;
  object_id: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  previous_hash: string;
  entry_hash: string;
}

export interface EvidenceQuestion {
  question_id: string;
  prompt: string;
  required: boolean;
}

export interface EvidenceRequest {
  request_id: string;
  workspace_id: string;
  finding_id: string;
  questionnaire: EvidenceQuestion[];
  status: "pending" | "submitted" | "closed";
  created_at: string;
}

export interface TowerRiskSummary {
  tower: DiligenceTower;
  total_findings: number;
  weighted_risk: number;
  avg_confidence: number;
}

export interface RiskGraph {
  workspace_id: string;
  generated_at: string;
  total_weighted_risk: number;
  open_findings: number;
  requires_approval: number;
  tower_summaries: TowerRiskSummary[];
}

export interface FindingFilters {
  tower?: DiligenceTower;
  severity?: RiskSeverity;
  status?: FindingStatus;
  min_impact?: number;
  tag?: string;
}

export interface EventEnvelope<TPayload = Record<string, unknown>> {
  event_id: string;
  event_type: string;
  workspace_id: string;
  created_at: string;
  payload: TPayload;
}

export interface EvidenceInput {
  source_uri: string;
  classification: string;
  content: string;
  tower?: DiligenceTower;
  captured_at?: string;
  claims?: EvidenceClaim[];
  metadata?: Record<string, unknown>;
}

export interface BatchManifest {
  source_server?: string;
  artifacts: EvidenceInput[];
}

export interface WorkspaceCreateInput {
  workspace_id?: string;
  tenant_id: string;
  deal_name: string;
  thesis: string;
  status?: WorkspaceStatus;
  policy_profile?: string;
  materiality_threshold?: number;
  enabled_towers?: DiligenceTower[];
}

/* ------------------------------------------------------------------ */
/*  Hybrid Tiered Pipeline Types                                       */
/* ------------------------------------------------------------------ */

export type PipelinePhase =
  | "phase1_sweep"
  | "phase1_5_index"
  | "phase2_deep"
  | "phase3_synthesis"
  | "heuristic";

/** A single chunk of a document stored in the in-memory vector index. */
export interface DocumentChunk {
  chunk_id: string;
  document_id: string;
  workspace_id: string;
  text: string;
  start_offset: number;
  end_offset: number;
  token_estimate: number;
  embedding: number[];
  metadata: {
    document_name: string;
    tower?: DiligenceTower;
    page_hint?: number;
  };
}

/** A finding produced by any phase of the hybrid pipeline. */
export interface HybridFinding {
  title: string;
  summary: string;
  management_points: string[];
  severity: RiskSeverity;
  tower: DiligenceTower;
  probability: number;
  impact_value: number;
  confidence: number;
  evidence_quotes: string[];
  phase_source: PipelinePhase;
  quote_verified: boolean;
  confidence_penalty: number;
}

export interface Phase1Result {
  document_id: string;
  document_name: string;
  model_used: string;
  summary: string;
  findings: HybridFinding[];
  escalated: boolean;
  token_estimate: number;
}

export interface Phase2Result {
  document_id: string;
  document_name: string;
  model_used: string;
  summary: string;
  findings: HybridFinding[];
  cross_doc_context_used: boolean;
}

export interface Phase3Result {
  synthesis_summary: string;
  cross_document_findings: HybridFinding[];
  coverage_gaps: string[];
}

export interface PipelineStatus {
  workspace_id: string;
  phase1_completed: number;
  phase1_total: number;
  phase2_completed: number;
  phase2_total: number;
  phase3_completed: boolean;
  chunks_indexed: number;
  total_findings: number;
  escalated_documents: number;
  pipeline_duration_ms: number;
}

export interface QuoteVerificationResult {
  quote: string;
  verified: boolean;
  best_match_score: number;
  matched_span: string;
}

export interface RAGQueryResult {
  answer: string;
  source_chunks: Array<{
    chunk_id: string;
    document_id: string;
    document_name: string;
    text: string;
    relevance_score: number;
  }>;
  confidence: number;
}
