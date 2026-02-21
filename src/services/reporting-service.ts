import type {
  ApprovalRequest,
  Finding,
  PackageType,
  ScenarioResult,
  Workspace,
} from "../types.js";

export interface IcPackage {
  package_type: PackageType;
  generated_at: string;
  workspace: Pick<Workspace, "workspace_id" | "deal_name" | "tenant_id" | "thesis" | "status">;
  summary: {
    total_findings: number;
    critical_findings: number;
    approvals_pending: number;
    expected_valuation_delta: number;
  };
  sections: Record<string, unknown>;
}

export class ReportingService {
  generateIcPackage(params: {
    packageType: PackageType;
    workspace: Workspace;
    findings: Finding[];
    approvals: ApprovalRequest[];
    scenarios: ScenarioResult[];
  }): IcPackage {
    const { packageType, workspace, findings, approvals, scenarios } = params;

    const criticalFindings = findings.filter(
      (finding) => finding.severity === "critical"
    );
    const pendingApprovals = approvals.filter(
      (approval) => approval.decision === null
    );

    const expectedValuationDelta = scenarios.length
      ? scenarios.reduce((sum, scenario) => sum + scenario.valuation_delta, 0) /
        scenarios.length
      : -findings.reduce(
          (sum, finding) => sum + finding.impact_value * finding.probability,
          0
        );

    const topFindings = findings.slice(0, 10).map((finding) => ({
      finding_id: finding.finding_id,
      title: finding.title,
      tower: finding.tower,
      severity: finding.severity,
      impact_value: finding.impact_value,
      confidence: finding.confidence,
      status: finding.status,
      evidence_refs: finding.evidence_refs,
    }));

    const sections = {
      red_flag_register: topFindings,
      scenario_snapshot: scenarios,
      pending_approvals: pendingApprovals,
      negotiation_levers: buildNegotiationLevers(topFindings),
      day1_day100_priorities: buildIntegrationPriorities(topFindings),
      assumptions_register: buildAssumptionsRegister(workspace, scenarios),
    } as const;

    return {
      package_type: packageType,
      generated_at: new Date().toISOString(),
      workspace: {
        workspace_id: workspace.workspace_id,
        deal_name: workspace.deal_name,
        tenant_id: workspace.tenant_id,
        thesis: workspace.thesis,
        status: workspace.status,
      },
      summary: {
        total_findings: findings.length,
        critical_findings: criticalFindings.length,
        approvals_pending: pendingApprovals.length,
        expected_valuation_delta: round(expectedValuationDelta),
      },
      sections,
    };
  }
}

function buildNegotiationLevers(
  topFindings: Array<{
    title: string;
    severity: string;
    tower: string;
    impact_value: number;
  }>
): Array<{ lever: string; rationale: string }> {
  return topFindings.slice(0, 5).map((finding) => ({
    lever: `Adjust pricing/escrow for ${finding.tower}`,
    rationale:
      `Finding '${finding.title}' has severity '${finding.severity}' ` +
      `with estimated impact ${finding.impact_value.toLocaleString()}.`,
  }));
}

function buildIntegrationPriorities(
  topFindings: Array<{ title: string; tower: string; severity: string }>
): Array<{ priority: string; rationale: string }> {
  return topFindings.slice(0, 5).map((finding, index) => ({
    priority: `P${index + 1}: ${finding.tower} stabilization workstream`,
    rationale: `Address '${finding.title}' (${finding.severity}) before Day-100 milestones.`,
  }));
}

function buildAssumptionsRegister(
  workspace: Workspace,
  scenarios: ScenarioResult[]
): Record<string, unknown> {
  return {
    workspace_materiality_threshold: workspace.materiality_threshold,
    enabled_towers: workspace.enabled_towers,
    scenario_count: scenarios.length,
    scenario_assumptions: scenarios.map((scenario) => scenario.assumptions),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
