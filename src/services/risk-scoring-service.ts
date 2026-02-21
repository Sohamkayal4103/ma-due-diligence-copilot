import type { EvidenceArtifact, Finding, RiskGraph, RiskSeverity } from "../types.js";

interface SignalRule {
  keyword: string;
  title: string;
  severity: RiskSeverity;
  baseImpact: number;
  baseProbability: number;
  baseConfidence: number;
  tag: string;
}

export interface SignalFindingCandidate {
  dedupe_key: string;
  title: string;
  summary: string;
  severity: RiskSeverity;
  impact_value: number;
  probability: number;
  confidence: number;
  evidence_refs: string[];
  tags: string[];
}

const SIGNAL_RULES: SignalRule[] = [
  {
    keyword: "termination on change of control",
    title: "Change-of-control contract termination risk",
    severity: "critical",
    baseImpact: 12_500_000,
    baseProbability: 0.72,
    baseConfidence: 0.81,
    tag: "legal-contract-risk",
  },
  {
    keyword: "unresolved litigation",
    title: "Outstanding litigation exposure",
    severity: "high",
    baseImpact: 9_000_000,
    baseProbability: 0.63,
    baseConfidence: 0.78,
    tag: "legal-litigation",
  },
  {
    keyword: "customer churn",
    title: "Revenue quality deterioration",
    severity: "high",
    baseImpact: 7_500_000,
    baseProbability: 0.67,
    baseConfidence: 0.76,
    tag: "commercial-churn",
  },
  {
    keyword: "single-source supplier",
    title: "Supply concentration vulnerability",
    severity: "high",
    baseImpact: 8_750_000,
    baseProbability: 0.62,
    baseConfidence: 0.74,
    tag: "operations-concentration",
  },
  {
    keyword: "key-person dependency",
    title: "Critical talent concentration risk",
    severity: "medium",
    baseImpact: 4_000_000,
    baseProbability: 0.54,
    baseConfidence: 0.68,
    tag: "people-retention",
  },
  {
    keyword: "tax audit",
    title: "Tax authority review exposure",
    severity: "high",
    baseImpact: 6_250_000,
    baseProbability: 0.58,
    baseConfidence: 0.71,
    tag: "tax-audit",
  },
  {
    keyword: "security incident",
    title: "Security posture and incident risk",
    severity: "high",
    baseImpact: 6_500_000,
    baseProbability: 0.61,
    baseConfidence: 0.79,
    tag: "technical-cyber",
  },
];

export class RiskScoringService {
  detectSignalFindings(artifact: EvidenceArtifact): SignalFindingCandidate[] {
    const content = artifact.content.toLowerCase();
    const outputs: SignalFindingCandidate[] = [];

    for (const rule of SIGNAL_RULES) {
      if (!content.includes(rule.keyword)) {
        continue;
      }

      const metadataImpact = Number(artifact.metadata.impact_value ?? 0);
      const impact =
        metadataImpact > 0
          ? Math.max(rule.baseImpact, metadataImpact)
          : rule.baseImpact;

      outputs.push({
        dedupe_key: `signal:${artifact.tower}:${rule.keyword}`,
        title: rule.title,
        summary:
          `Detected keyword '${rule.keyword}' in source '${artifact.source_uri}'. ` +
          `This indicates ${rule.tag.replace(/-/g, " ")} exposure requiring diligence follow-up.`,
        severity: rule.severity,
        impact_value: impact,
        probability: rule.baseProbability,
        confidence: rule.baseConfidence,
        evidence_refs: [artifact.artifact_id],
        tags: [rule.tag, `tower:${artifact.tower}`],
      });
    }

    return outputs;
  }

  buildRiskGraph(workspaceId: string, findings: Finding[]): RiskGraph {
    const openFindings = findings.filter((finding) => finding.status !== "resolved");
    const requiresApproval = openFindings.filter(
      (finding) => finding.status === "requires_approval"
    ).length;

    const towerMap = new Map<string, Finding[]>();
    for (const finding of openFindings) {
      if (!towerMap.has(finding.tower)) {
        towerMap.set(finding.tower, []);
      }
      towerMap.get(finding.tower)!.push(finding);
    }

    const towerSummaries = Array.from(towerMap.entries()).map(
      ([tower, towerFindings]) => {
        const weightedRisk = towerFindings.reduce(
          (sum, finding) => sum + finding.impact_value * finding.probability,
          0
        );
        const avgConfidence =
          towerFindings.reduce((sum, finding) => sum + finding.confidence, 0) /
          Math.max(towerFindings.length, 1);

        return {
          tower: tower as RiskGraph["tower_summaries"][number]["tower"],
          total_findings: towerFindings.length,
          weighted_risk: round(weightedRisk),
          avg_confidence: round(avgConfidence),
        };
      }
    );

    const totalWeightedRisk = openFindings.reduce(
      (sum, finding) => sum + finding.impact_value * finding.probability,
      0
    );

    return {
      workspace_id: workspaceId,
      generated_at: new Date().toISOString(),
      total_weighted_risk: round(totalWeightedRisk),
      open_findings: openFindings.length,
      requires_approval: requiresApproval,
      tower_summaries: towerSummaries.sort((a, b) => b.weighted_risk - a.weighted_risk),
    };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
