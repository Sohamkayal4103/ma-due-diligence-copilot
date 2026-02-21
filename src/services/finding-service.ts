import { randomUUID } from "node:crypto";
import type {
  DiligenceTower,
  Finding,
  FindingFilters,
  FindingStatus,
  RiskSeverity,
} from "../types.js";

export interface FindingCreateInput {
  workspace_id: string;
  tower: DiligenceTower;
  severity: RiskSeverity;
  probability: number;
  impact_value: number;
  confidence: number;
  title: string;
  summary: string;
  evidence_refs: string[];
  tags?: string[];
  dedupe_key?: string;
}

export class FindingService {
  private findingsByWorkspace = new Map<string, Map<string, Finding>>();
  private dedupeIndexByWorkspace = new Map<string, Map<string, string>>();

  createOrMerge(input: FindingCreateInput): {
    finding: Finding;
    created: boolean;
  } {
    const wsFindings = this.getWorkspaceFindingsMap(input.workspace_id);
    const wsDedupe = this.getWorkspaceDedupeMap(input.workspace_id);

    if (input.dedupe_key) {
      const existingId = wsDedupe.get(input.dedupe_key);
      if (existingId) {
        const existing = wsFindings.get(existingId);
        if (existing) {
          existing.updated_at = new Date().toISOString();
          existing.probability = Math.max(existing.probability, input.probability);
          existing.impact_value = Math.max(existing.impact_value, input.impact_value);
          existing.confidence = Math.max(existing.confidence, input.confidence);
          existing.severity = maxSeverity(existing.severity, input.severity);
          existing.summary = `${existing.summary}\n\n[Merged update] ${input.summary}`;
          for (const artifactId of input.evidence_refs) {
            if (!existing.evidence_refs.includes(artifactId)) {
              existing.evidence_refs.push(artifactId);
            }
          }
          for (const tag of input.tags ?? []) {
            if (!existing.tags.includes(tag)) {
              existing.tags.push(tag);
            }
          }

          return { finding: existing, created: false };
        }
      }
    }

    const now = new Date().toISOString();
    const finding: Finding = {
      finding_id: randomUUID(),
      workspace_id: input.workspace_id,
      tower: input.tower,
      severity: input.severity,
      probability: clamp(input.probability),
      impact_value: Math.max(0, input.impact_value),
      confidence: clamp(input.confidence),
      status: "open",
      title: input.title,
      summary: input.summary,
      evidence_refs: [...input.evidence_refs],
      tags: input.tags ? [...input.tags] : [],
      created_at: now,
      updated_at: now,
    };

    wsFindings.set(finding.finding_id, finding);
    if (input.dedupe_key) {
      wsDedupe.set(input.dedupe_key, finding.finding_id);
    }

    return { finding, created: true };
  }

  updateStatus(
    workspaceId: string,
    findingId: string,
    status: FindingStatus
  ): Finding {
    const finding = this.requireFinding(workspaceId, findingId);
    finding.status = status;
    finding.updated_at = new Date().toISOString();
    return finding;
  }

  listFindings(workspaceId: string, filters: FindingFilters = {}): Finding[] {
    let items = Array.from(this.getWorkspaceFindingsMap(workspaceId).values());

    if (filters.tower) {
      items = items.filter((finding) => finding.tower === filters.tower);
    }
    if (filters.severity) {
      items = items.filter((finding) => finding.severity === filters.severity);
    }
    if (filters.status) {
      items = items.filter((finding) => finding.status === filters.status);
    }
    if (typeof filters.min_impact === "number") {
      items = items.filter((finding) => finding.impact_value >= filters.min_impact!);
    }
    if (filters.tag) {
      items = items.filter((finding) => finding.tags.includes(filters.tag!));
    }

    return items.sort((a, b) => {
      const severityDiff = severityWeight(b.severity) - severityWeight(a.severity);
      if (severityDiff !== 0) {
        return severityDiff;
      }
      return b.impact_value - a.impact_value;
    });
  }

  requireFinding(workspaceId: string, findingId: string): Finding {
    const finding = this.getWorkspaceFindingsMap(workspaceId).get(findingId);
    if (!finding) {
      throw new Error(
        `Finding '${findingId}' not found in workspace '${workspaceId}'`
      );
    }
    return finding;
  }

  private getWorkspaceFindingsMap(workspaceId: string): Map<string, Finding> {
    if (!this.findingsByWorkspace.has(workspaceId)) {
      this.findingsByWorkspace.set(workspaceId, new Map());
    }
    return this.findingsByWorkspace.get(workspaceId)!;
  }

  private getWorkspaceDedupeMap(workspaceId: string): Map<string, string> {
    if (!this.dedupeIndexByWorkspace.has(workspaceId)) {
      this.dedupeIndexByWorkspace.set(workspaceId, new Map());
    }
    return this.dedupeIndexByWorkspace.get(workspaceId)!;
  }
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function severityWeight(severity: RiskSeverity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function maxSeverity(a: RiskSeverity, b: RiskSeverity): RiskSeverity {
  return severityWeight(a) >= severityWeight(b) ? a : b;
}
