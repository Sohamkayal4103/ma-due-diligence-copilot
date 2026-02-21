import { randomUUID } from "node:crypto";
import { InMemoryEventBus } from "./core/event-bus.js";
import { getSourceOrThrow } from "./core/tower-registry.js";
import { ApprovalService } from "./services/approval-service.js";
import { AuditLedgerService } from "./services/audit-ledger-service.js";
import { CanonicalModelService } from "./services/canonical-model-service.js";
import { ContradictionDetectorService } from "./services/contradiction-detector-service.js";
import {
  EvidenceIngestionService,
  type IngestBatchResult,
} from "./services/evidence-ingestion-service.js";
import { FindingService } from "./services/finding-service.js";
import { GapRequestService } from "./services/gap-request-service.js";
import { PolicyService } from "./services/policy-service.js";
import { ProvenanceService } from "./services/provenance-service.js";
import {
  ReportingService,
  type IcPackage,
} from "./services/reporting-service.js";
import { RiskScoringService } from "./services/risk-scoring-service.js";
import { ScenarioService } from "./services/scenario-service.js";
import { WorkspaceService } from "./services/workspace-service.js";
import type {
  Actor,
  AuditLedgerEntry,
  BatchManifest,
  EvidenceArtifact,
  EventEnvelope,
  Finding,
  FindingFilters,
  PackageType,
  RiskGraph,
  ScenarioDefinition,
  ScenarioResult,
  Workspace,
  WorkspaceCreateInput,
} from "./types.js";

interface DecisionPayload {
  decision: "approved" | "rejected";
  reason: string;
}

export class DueDiligenceOrchestrator {
  public readonly events = new InMemoryEventBus();

  private readonly workspaces = new WorkspaceService();
  private readonly policy = new PolicyService();
  private readonly ingestion = new EvidenceIngestionService();
  private readonly canonical = new CanonicalModelService();
  private readonly contradictions = new ContradictionDetectorService();
  private readonly findings = new FindingService();
  private readonly risk = new RiskScoringService();
  private readonly scenarios = new ScenarioService();
  private readonly provenance = new ProvenanceService();
  private readonly approvals = new ApprovalService();
  private readonly audit = new AuditLedgerService();
  private readonly gaps = new GapRequestService();
  private readonly reporting = new ReportingService();

  private scenarioHistory = new Map<string, ScenarioResult[]>();

  createWorkspace(input: WorkspaceCreateInput, actor?: Actor): Workspace {
    const resolvedActor = this.policy.resolveActor(actor);
    if (
      resolvedActor.tenant_id !== "*" &&
      resolvedActor.tenant_id !== input.tenant_id
    ) {
      throw new Error(
        `Actor tenant '${resolvedActor.tenant_id}' cannot create workspace for tenant '${input.tenant_id}'`
      );
    }

    this.policy.assertScope(resolvedActor, "workspace:create");
    const workspace = this.workspaces.createWorkspace(input);
    this.workspaces.addParticipant(
      workspace.workspace_id,
      resolvedActor.user_id,
      resolvedActor.role
    );

    void this.events.publish("workspace.created", workspace.workspace_id, {
      workspace_id: workspace.workspace_id,
      tenant_id: workspace.tenant_id,
      actor: resolvedActor.user_id,
    });
    this.audit.appendEntry({
      workspace_id: workspace.workspace_id,
      action: "workspace.create",
      actor_id: resolvedActor.user_id,
      object_type: "workspace",
      object_id: workspace.workspace_id,
      metadata: {
        policy_profile: workspace.policy_profile,
        status: workspace.status,
      },
    });

    return workspace;
  }

  listWorkspaces(actor?: Actor): Workspace[] {
    const resolvedActor = this.policy.resolveActor(actor);
    this.policy.assertScope(resolvedActor, "workspace:read");
    return this.workspaces.listWorkspaces(
      resolvedActor.tenant_id === "*" ? undefined : resolvedActor.tenant_id
    );
  }

  addParticipant(
    workspaceId: string,
    userId: string,
    role: "admin" | "reviewer" | "analyst" | "viewer",
    actor?: Actor
  ) {
    const resolvedActor = this.policy.resolveActor(actor);
    this.policy.assertScope(resolvedActor, "workspace:manage");
    this.policy.assertMinimumRole(resolvedActor, "admin");
    this.workspaces.assertWorkspaceAccess(workspaceId, resolvedActor);

    const participant = this.workspaces.addParticipant(workspaceId, userId, role);

    void this.events.publish("workspace.participant_added", workspaceId, {
      user_id: userId,
      role,
      actor: resolvedActor.user_id,
    });
    this.audit.appendEntry({
      workspace_id: workspaceId,
      action: "workspace.participant_added",
      actor_id: resolvedActor.user_id,
      object_type: "workspace_participant",
      object_id: userId,
      metadata: { role },
    });

    return participant;
  }

  async ingestEvidenceBatch(params: {
    workspace_id: string;
    source_id: string;
    batch_manifest: BatchManifest;
    actor?: Actor;
  }): Promise<{
    ingest: IngestBatchResult;
    created_findings: number;
    merged_findings: number;
    created_approvals: number;
    risk_graph: RiskGraph;
  }> {
    const actor = this.policy.resolveActor(params.actor);
    const source = getSourceOrThrow(params.source_id);

    this.policy.assertScope(actor, source.required_scope);
    this.policy.assertScope(actor, "evidence:ingest");

    const workspace = this.workspaces.assertWorkspaceAccess(
      params.workspace_id,
      actor
    );
    this.workspaces.ensureTowerEnabled(workspace.workspace_id, source.tower);

    const ingestResult = this.ingestion.ingestBatch(
      workspace.workspace_id,
      params.batch_manifest.source_server ?? source.source_id,
      params.batch_manifest,
      source.tower
    );

    let createdFindings = 0;
    let mergedFindings = 0;
    let createdApprovals = 0;

    for (const artifact of ingestResult.ingested) {
      await this.events.publish("evidence.ingested", workspace.workspace_id, {
        artifact_id: artifact.artifact_id,
        source_server: artifact.source_server,
        source_uri: artifact.source_uri,
        checksum: artifact.checksum,
      });

      const normalized = this.canonical.normalizeEvidence(artifact);
      await this.events.publish("canonical.updated", workspace.workspace_id, {
        artifact_id: artifact.artifact_id,
        created_entities: normalized.created_entities.map((entity) => entity.entity_id),
        linked_entities: normalized.linked_entity_ids,
      });

      const contradictionSignals = this.contradictions.detect(artifact);
      for (const signal of contradictionSignals) {
        const { finding, created } = this.findings.createOrMerge({
          workspace_id: workspace.workspace_id,
          tower: artifact.tower,
          severity: "high",
          probability: signal.probability,
          impact_value: signal.impact_value,
          confidence: signal.confidence,
          title: signal.title,
          summary: signal.summary,
          evidence_refs: signal.evidence_refs,
          tags: ["contradiction", `tower:${artifact.tower}`],
          dedupe_key: signal.dedupe_key,
        });

        this.attachProvenance(finding.finding_id, artifact, "contradiction_detector");

        if (created) createdFindings += 1;
        else mergedFindings += 1;

        createdApprovals += this.applyPolicyGating(workspace, finding, actor.user_id);

        await this.events.publish("finding.contradiction", workspace.workspace_id, {
          finding_id: finding.finding_id,
          title: finding.title,
          severity: finding.severity,
          evidence_refs: finding.evidence_refs,
        });
      }

      const signalFindings = this.risk.detectSignalFindings(artifact);
      for (const signal of signalFindings) {
        const { finding, created } = this.findings.createOrMerge({
          workspace_id: workspace.workspace_id,
          tower: artifact.tower,
          severity: signal.severity,
          probability: signal.probability,
          impact_value: signal.impact_value,
          confidence: signal.confidence,
          title: signal.title,
          summary: signal.summary,
          evidence_refs: signal.evidence_refs,
          tags: signal.tags,
          dedupe_key: signal.dedupe_key,
        });

        this.attachProvenance(finding.finding_id, artifact, "risk_signal_detection");

        if (created) createdFindings += 1;
        else mergedFindings += 1;

        createdApprovals += this.applyPolicyGating(workspace, finding, actor.user_id);

        await this.events.publish("finding.detected", workspace.workspace_id, {
          finding_id: finding.finding_id,
          title: finding.title,
          severity: finding.severity,
          tower: finding.tower,
          status: finding.status,
        });
      }
    }

    const riskGraph = this.recomputeRiskGraph({
      workspace_id: workspace.workspace_id,
      actor,
    });

    this.audit.appendEntry({
      workspace_id: workspace.workspace_id,
      action: "evidence.batch_ingested",
      actor_id: actor.user_id,
      object_type: "source",
      object_id: params.source_id,
      metadata: {
        ingested_artifacts: ingestResult.ingested.length,
        deduped_artifacts: ingestResult.deduped.length,
        created_findings: createdFindings,
        merged_findings: mergedFindings,
      },
    });

    return {
      ingest: ingestResult,
      created_findings: createdFindings,
      merged_findings: mergedFindings,
      created_approvals: createdApprovals,
      risk_graph: riskGraph,
    };
  }

  listFindings(params: {
    workspace_id: string;
    filters?: FindingFilters;
    actor?: Actor;
  }) {
    const actor = this.policy.resolveActor(params.actor);
    this.policy.assertScope(actor, "finding:read");
    this.workspaces.assertWorkspaceAccess(params.workspace_id, actor);

    const findings = this.findings.listFindings(
      params.workspace_id,
      params.filters
    );
    this.audit.appendEntry({
      workspace_id: params.workspace_id,
      action: "finding.list",
      actor_id: actor.user_id,
      object_type: "finding_query",
      object_id: `query:${randomUUID()}`,
      metadata: {
        filters: params.filters ?? {},
        count: findings.length,
      },
    });
    return findings;
  }

  getFinding(params: {
    workspace_id: string;
    finding_id: string;
    actor?: Actor;
  }): Finding {
    const actor = this.policy.resolveActor(params.actor);
    this.policy.assertScope(actor, "finding:read");
    this.workspaces.assertWorkspaceAccess(params.workspace_id, actor);

    const finding = this.findings.requireFinding(
      params.workspace_id,
      params.finding_id
    );
    this.audit.appendEntry({
      workspace_id: params.workspace_id,
      action: "finding.read",
      actor_id: actor.user_id,
      object_type: "finding",
      object_id: params.finding_id,
      metadata: {
        status: finding.status,
        severity: finding.severity,
      },
    });

    return finding;
  }

  recomputeRiskGraph(params: {
    workspace_id: string;
    scope?: { towers?: string[] };
    actor?: Actor;
  }): RiskGraph {
    const actor = this.policy.resolveActor(params.actor);
    this.policy.assertScope(actor, "risk:recompute");
    this.workspaces.assertWorkspaceAccess(params.workspace_id, actor);

    const findings = this.findings.listFindings(params.workspace_id);
    const scopedFindings = params.scope?.towers?.length
      ? findings.filter((finding) => params.scope!.towers!.includes(finding.tower))
      : findings;

    const graph = this.risk.buildRiskGraph(params.workspace_id, scopedFindings);

    void this.events.publish("risk.updated", params.workspace_id, {
      total_weighted_risk: graph.total_weighted_risk,
      open_findings: graph.open_findings,
      requires_approval: graph.requires_approval,
    });
    this.audit.appendEntry({
      workspace_id: params.workspace_id,
      action: "risk.recompute",
      actor_id: actor.user_id,
      object_type: "risk_graph",
      object_id: `risk:${params.workspace_id}`,
      metadata: {
        scope: params.scope ?? {},
        total_weighted_risk: graph.total_weighted_risk,
      },
    });

    return graph;
  }

  runScenarios(params: {
    workspace_id: string;
    scenario_set: ScenarioDefinition[];
    actor?: Actor;
  }): ScenarioResult[] {
    const actor = this.policy.resolveActor(params.actor);
    this.policy.assertScope(actor, "scenario:run");
    this.workspaces.assertWorkspaceAccess(params.workspace_id, actor);

    const findings = this.findings.listFindings(params.workspace_id);
    const results = this.scenarios.runScenarios(
      params.workspace_id,
      findings,
      params.scenario_set
    );

    this.scenarioHistory.set(params.workspace_id, results);

    void this.events.publish("scenario.updated", params.workspace_id, {
      scenario_count: results.length,
    });
    this.audit.appendEntry({
      workspace_id: params.workspace_id,
      action: "scenario.run",
      actor_id: actor.user_id,
      object_type: "scenario_set",
      object_id: `scenario:${randomUUID()}`,
      metadata: {
        scenario_count: results.length,
        scenario_names: params.scenario_set.map((scenario) => scenario.name),
      },
    });

    return results;
  }

  requestMissingEvidence(params: {
    workspace_id: string;
    finding_id: string;
    questionnaire: Array<{ prompt: string; required?: boolean }>;
    actor?: Actor;
  }) {
    const actor = this.policy.resolveActor(params.actor);
    this.policy.assertScope(actor, "evidence:request");
    this.workspaces.assertWorkspaceAccess(params.workspace_id, actor);
    this.findings.requireFinding(params.workspace_id, params.finding_id);

    const request = this.gaps.createRequest(
      params.workspace_id,
      params.finding_id,
      params.questionnaire
    );

    void this.events.publish("elicitation.requested", params.workspace_id, {
      request_id: request.request_id,
      finding_id: params.finding_id,
      question_count: request.questionnaire.length,
    });
    this.audit.appendEntry({
      workspace_id: params.workspace_id,
      action: "evidence.request_missing",
      actor_id: actor.user_id,
      object_type: "evidence_request",
      object_id: request.request_id,
      metadata: {
        finding_id: params.finding_id,
        question_count: request.questionnaire.length,
      },
    });

    return request;
  }

  approveFinding(params: {
    workspace_id: string;
    finding_id: string;
    decision_payload: DecisionPayload;
    actor?: Actor;
  }) {
    const actor = this.policy.resolveActor(params.actor);
    this.policy.assertScope(actor, "finding:approve");
    this.policy.assertMinimumRole(actor, "reviewer");
    this.workspaces.assertWorkspaceAccess(params.workspace_id, actor);

    const approval = this.approvals.decideApproval(
      params.workspace_id,
      params.finding_id,
      params.decision_payload.decision,
      params.decision_payload.reason
    );

    const newStatus =
      params.decision_payload.decision === "approved" ? "approved" : "rejected";
    const finding = this.findings.updateStatus(
      params.workspace_id,
      params.finding_id,
      newStatus
    );

    void this.events.publish("approval.decided", params.workspace_id, {
      approval_id: approval.approval_id,
      finding_id: finding.finding_id,
      decision: approval.decision,
      actor: actor.user_id,
    });
    this.audit.appendEntry({
      workspace_id: params.workspace_id,
      action: "finding.approval_decided",
      actor_id: actor.user_id,
      object_type: "approval",
      object_id: approval.approval_id,
      metadata: {
        finding_id: params.finding_id,
        decision: approval.decision,
      },
    });

    return {
      approval,
      finding,
    };
  }

  generateIcPackage(params: {
    workspace_id: string;
    package_type: PackageType;
    actor?: Actor;
  }): IcPackage {
    const actor = this.policy.resolveActor(params.actor);
    this.policy.assertScope(actor, "report:generate");
    this.policy.assertMinimumRole(actor, "analyst");
    const workspace = this.workspaces.assertWorkspaceAccess(params.workspace_id, actor);

    const findings = this.findings.listFindings(params.workspace_id);
    const approvals = this.approvals.listApprovals(params.workspace_id);
    const scenarios = this.scenarioHistory.get(params.workspace_id) ?? [];

    const blockingFinding = findings.find(
      (finding) =>
        finding.status === "requires_approval" &&
        (finding.severity === "high" || finding.severity === "critical")
    );

    if (blockingFinding && params.package_type !== "red_flag_register") {
      throw new Error(
        `Blocked by policy: finding '${blockingFinding.finding_id}' still requires approval`
      );
    }

    if (params.package_type !== "red_flag_register") {
      const missingProvenance = findings.find(
        (finding) =>
          finding.status !== "resolved" &&
          this.provenance.getProvenanceChain(finding.finding_id).length === 0
      );

      if (missingProvenance) {
        throw new Error(
          `Blocked by policy: finding '${missingProvenance.finding_id}' is missing provenance references`
        );
      }
    }

    const pkg = this.reporting.generateIcPackage({
      packageType: params.package_type,
      workspace,
      findings,
      approvals,
      scenarios,
    });

    void this.events.publish("ic_package.generated", params.workspace_id, {
      package_type: params.package_type,
      generated_by: actor.user_id,
    });
    this.audit.appendEntry({
      workspace_id: params.workspace_id,
      action: "report.ic_package_generated",
      actor_id: actor.user_id,
      object_type: "ic_package",
      object_id: `${params.package_type}:${randomUUID()}`,
      metadata: {
        package_type: params.package_type,
        findings_count: findings.length,
      },
    });

    return pkg;
  }

  getProvenanceChain(params: {
    workspace_id: string;
    finding_id: string;
    actor?: Actor;
  }) {
    const actor = this.policy.resolveActor(params.actor);
    this.policy.assertScope(actor, "provenance:read");
    this.workspaces.assertWorkspaceAccess(params.workspace_id, actor);
    this.findings.requireFinding(params.workspace_id, params.finding_id);
    const chain = this.provenance.getProvenanceChain(params.finding_id);
    this.audit.appendEntry({
      workspace_id: params.workspace_id,
      action: "provenance.read",
      actor_id: actor.user_id,
      object_type: "finding",
      object_id: params.finding_id,
      metadata: { refs: chain.length },
    });
    return chain;
  }

  listEvents(workspaceId: string, actor?: Actor): EventEnvelope[] {
    const resolved = this.policy.resolveActor(actor);
    this.policy.assertScope(resolved, "event:read");
    this.workspaces.assertWorkspaceAccess(workspaceId, resolved);

    const events = this.events.getEvents(workspaceId);
    this.audit.appendEntry({
      workspace_id: workspaceId,
      action: "event.read",
      actor_id: resolved.user_id,
      object_type: "event_stream",
      object_id: workspaceId,
      metadata: { count: events.length },
    });
    return events;
  }

  listAuditLedger(workspaceId: string, actor?: Actor): AuditLedgerEntry[] {
    const resolved = this.policy.resolveActor(actor);
    this.policy.assertScope(resolved, "audit:read");
    this.workspaces.assertWorkspaceAccess(workspaceId, resolved);
    return this.audit.listEntries(workspaceId);
  }

  seedDemoWorkspace(): Workspace {
    const workspace = this.workspaces.createWorkspace({
      workspace_id: "demo-deal-001",
      tenant_id: "tenant-demo",
      deal_name: "Acme acquires Nova Analytics",
      thesis:
        "Acquire category-leading analytics platform and unlock GTM + infra synergies.",
      materiality_threshold: 4_500_000,
      policy_profile: "strict-default",
      status: "active",
    });

    this.workspaces.addParticipant(
      workspace.workspace_id,
      "analyst-demo",
      "analyst"
    );
    this.workspaces.addParticipant(
      workspace.workspace_id,
      "reviewer-demo",
      "reviewer"
    );
    this.audit.appendEntry({
      workspace_id: workspace.workspace_id,
      action: "workspace.seeded_demo",
      actor_id: "system",
      object_type: "workspace",
      object_id: workspace.workspace_id,
      metadata: {
        participants: workspace.participants.length,
      },
    });

    return workspace;
  }

  private applyPolicyGating(
    workspace: Workspace,
    finding: Finding,
    requestedBy: string
  ): number {
    if (!this.policy.requiresApproval(workspace, finding)) {
      return 0;
    }

    this.findings.updateStatus(
      workspace.workspace_id,
      finding.finding_id,
      "requires_approval"
    );

    const approvalResult = this.approvals.createOrGetApproval(
      workspace.workspace_id,
      finding,
      requestedBy,
      this.policy.classifyRiskLevel(finding)
    );
    if (approvalResult.created) {
      this.audit.appendEntry({
        workspace_id: workspace.workspace_id,
        action: "finding.approval_requested",
        actor_id: requestedBy,
        object_type: "finding",
        object_id: finding.finding_id,
        metadata: {
          severity: finding.severity,
          impact_value: finding.impact_value,
        },
      });
    }

    return approvalResult.created ? 1 : 0;
  }

  private attachProvenance(
    findingId: string,
    artifact: EvidenceArtifact,
    step: string
  ): void {
    const finding = this.findings.requireFinding(artifact.workspace_id, findingId);
    this.provenance.attachFindingProvenance(finding, [artifact], step);
  }
}

export const DEMO_ACTOR: Actor = {
  user_id: "analyst-demo",
  tenant_id: "tenant-demo",
  role: "analyst",
  scopes: [
    "workspace:create",
    "workspace:read",
    "workspace:manage",
    "evidence:ingest",
    "evidence:request",
    "finding:read",
    "risk:recompute",
    "scenario:run",
    "provenance:read",
    "report:generate",
    "event:read",
    "audit:read",
    "source:dataroom:read",
    "source:finance:read",
    "source:legal:read",
    "source:hr:read",
    "source:market:read",
    "source:operations:read",
    "source:tax:read",
    "source:security:read",
  ],
};

export const REVIEWER_ACTOR: Actor = {
  ...DEMO_ACTOR,
  user_id: "reviewer-demo",
  role: "reviewer",
  scopes: [...DEMO_ACTOR.scopes, "finding:approve"],
};

export function buildDefaultScenarioSet(): ScenarioDefinition[] {
  return [
    {
      name: "downside",
      assumptions: {
        downside_multiplier: 1.35,
        synergy_multiplier: 0.6,
        integration_cost: 3_000_000,
      },
    },
    {
      name: "base",
      assumptions: {
        downside_multiplier: 1,
        synergy_multiplier: 1,
        integration_cost: 1_500_000,
      },
    },
    {
      name: "upside",
      assumptions: {
        downside_multiplier: 0.75,
        synergy_multiplier: 1.3,
        integration_cost: 1_000_000,
      },
    },
  ];
}

export function buildDemoBatchForSource(
  sourceId: string
): BatchManifest {
  const batches: Record<string, BatchManifest> = {
    dataroom_vdr: {
      source_server: "dataroom_vdr",
      artifacts: [
        {
          source_uri: "vdr://contracts/top-customer-msa-01",
          classification: "contract",
          content:
            "Customer: Northwind Retail\nClause: termination on change of control\nExclusivity: exclusive",
          claims: [
            {
              subject: "customer:northwind-retail",
              field: "change_of_control_clause",
              value: "termination_allowed",
            },
            {
              subject: "customer:northwind-retail",
              field: "exclusivity",
              value: "exclusive",
            },
          ],
        },
      ],
    },
    finance_erp: {
      source_server: "finance_erp",
      artifacts: [
        {
          source_uri: "erp://revenue/q4-quality-report",
          classification: "financial-report",
          content:
            "Revenue quality note: customer churn increased in enterprise segment.",
          metadata: { impact_value: 6_700_000 },
          claims: [
            {
              subject: "kpi:net_revenue_retention",
              field: "q4",
              value: "89",
            },
          ],
        },
      ],
    },
    legal_contracts: {
      source_server: "legal_contracts",
      artifacts: [
        {
          source_uri: "legal://amendments/northwind-amendment-2025-01",
          classification: "contract-amendment",
          content:
            "Customer: Northwind Retail\nExclusivity: non-exclusive\nUnresolved litigation exposure noted.",
          claims: [
            {
              subject: "customer:northwind-retail",
              field: "exclusivity",
              value: "non-exclusive",
            },
          ],
        },
      ],
    },
  };

  return (
    batches[sourceId] ?? {
      source_server: sourceId,
      artifacts: [
        {
          source_uri: `source://${sourceId}/artifact/${randomUUID()}`,
          classification: "note",
          content: `Evidence payload from ${sourceId}`,
        },
      ],
    }
  );
}
