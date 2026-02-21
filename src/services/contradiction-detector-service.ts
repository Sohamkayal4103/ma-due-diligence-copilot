import type { EvidenceArtifact } from "../types.js";

export interface DetectedContradiction {
  dedupe_key: string;
  title: string;
  summary: string;
  impact_value: number;
  confidence: number;
  probability: number;
  evidence_refs: string[];
}

interface ClaimRecord {
  value: string;
  artifact_id: string;
  source_server: string;
}

export class ContradictionDetectorService {
  private claimLedger = new Map<string, Map<string, ClaimRecord[]>>();

  detect(artifact: EvidenceArtifact): DetectedContradiction[] {
    const workspaceLedger = this.getWorkspaceLedger(artifact.workspace_id);
    const contradictions: DetectedContradiction[] = [];

    for (const claim of artifact.claims) {
      const claimKey = `${claim.subject}::${claim.field}`;
      const prior = workspaceLedger.get(claimKey) ?? [];

      for (const previous of prior) {
        if (normalize(previous.value) === normalize(claim.value)) {
          continue;
        }

        const dedupeKey = `${claimKey}:${normalize(previous.value)}:${normalize(claim.value)}`;
        contradictions.push({
          dedupe_key: dedupeKey,
          title: `Contradiction detected: ${claim.subject} ${claim.field}`,
          summary:
            `Value mismatch for '${claim.subject}.${claim.field}'. ` +
            `Source '${previous.source_server}' reports '${previous.value}', while ` +
            `source '${artifact.source_server}' reports '${claim.value}'.`,
          impact_value: 8_500_000,
          confidence: 0.87,
          probability: 0.75,
          evidence_refs: [previous.artifact_id, artifact.artifact_id],
        });
      }

      prior.push({
        value: claim.value,
        artifact_id: artifact.artifact_id,
        source_server: artifact.source_server,
      });
      workspaceLedger.set(claimKey, prior);
    }

    return contradictions;
  }

  private getWorkspaceLedger(
    workspaceId: string
  ): Map<string, ClaimRecord[]> {
    if (!this.claimLedger.has(workspaceId)) {
      this.claimLedger.set(workspaceId, new Map());
    }
    return this.claimLedger.get(workspaceId)!;
  }
}

function normalize(input: string): string {
  return input.trim().toLowerCase();
}
