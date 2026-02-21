import type { EvidenceArtifact, Finding, ProvenanceRef } from "../types.js";

export class ProvenanceService {
  private refsByFinding = new Map<string, ProvenanceRef[]>();

  attachFindingProvenance(
    finding: Finding,
    artifacts: EvidenceArtifact[],
    transformationStep: string
  ): void {
    const refs: ProvenanceRef[] = [];

    for (const artifact of artifacts) {
      refs.push({
        finding_id: finding.finding_id,
        artifact_id: artifact.artifact_id,
        transformation_step: transformationStep,
        quoted_span: safeQuote(artifact.content),
        timestamp: new Date().toISOString(),
      });
    }

    if (!this.refsByFinding.has(finding.finding_id)) {
      this.refsByFinding.set(finding.finding_id, []);
    }

    const existing = this.refsByFinding.get(finding.finding_id)!;
    for (const ref of refs) {
      const duplicate = existing.some(
        (candidate) =>
          candidate.artifact_id === ref.artifact_id &&
          candidate.transformation_step === ref.transformation_step
      );
      if (!duplicate) {
        existing.push(ref);
      }
    }
  }

  getProvenanceChain(findingId: string): ProvenanceRef[] {
    return [...(this.refsByFinding.get(findingId) ?? [])];
  }
}

function safeQuote(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 180) {
    return trimmed;
  }
  return `${trimmed.slice(0, 177)}...`;
}
