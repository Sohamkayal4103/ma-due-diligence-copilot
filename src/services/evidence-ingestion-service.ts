import { randomUUID } from "node:crypto";
import type {
  BatchManifest,
  EvidenceArtifact,
  EvidenceInput,
} from "../types.js";
import { stableChecksum } from "../utils/hash.js";

export interface IngestBatchResult {
  source_server: string;
  ingested: EvidenceArtifact[];
  deduped: EvidenceArtifact[];
}

export class EvidenceIngestionService {
  private artifactsByWorkspace = new Map<string, Map<string, EvidenceArtifact>>();
  private checksumIndexByWorkspace = new Map<string, Map<string, string>>();

  ingestBatch(
    workspaceId: string,
    sourceServer: string,
    batchManifest: BatchManifest,
    defaultTower: EvidenceArtifact["tower"]
  ): IngestBatchResult {
    const wsArtifacts = this.getWorkspaceArtifactsMap(workspaceId);
    const wsChecksumIndex = this.getWorkspaceChecksumIndex(workspaceId);

    const ingested: EvidenceArtifact[] = [];
    const deduped: EvidenceArtifact[] = [];

    for (const input of batchManifest.artifacts) {
      const checksum = this.computeChecksum(sourceServer, input);
      const existingId = wsChecksumIndex.get(checksum);
      if (existingId) {
        const existing = wsArtifacts.get(existingId);
        if (existing) {
          deduped.push(existing);
        }
        continue;
      }

      const artifact = this.buildArtifact(
        workspaceId,
        sourceServer,
        input,
        checksum,
        defaultTower
      );

      wsArtifacts.set(artifact.artifact_id, artifact);
      wsChecksumIndex.set(checksum, artifact.artifact_id);
      ingested.push(artifact);
    }

    return {
      source_server: sourceServer,
      ingested,
      deduped,
    };
  }

  listArtifacts(workspaceId: string): EvidenceArtifact[] {
    return Array.from(this.getWorkspaceArtifactsMap(workspaceId).values());
  }

  getArtifact(workspaceId: string, artifactId: string): EvidenceArtifact | null {
    return this.getWorkspaceArtifactsMap(workspaceId).get(artifactId) ?? null;
  }

  private buildArtifact(
    workspaceId: string,
    sourceServer: string,
    input: EvidenceInput,
    checksum: string,
    defaultTower: EvidenceArtifact["tower"]
  ): EvidenceArtifact {
    return {
      artifact_id: randomUUID(),
      workspace_id: workspaceId,
      source_server: sourceServer,
      source_uri: input.source_uri,
      captured_at: input.captured_at ?? new Date().toISOString(),
      checksum,
      classification: input.classification,
      tower: input.tower ?? defaultTower,
      content: input.content,
      claims: input.claims ?? [],
      metadata: input.metadata ?? {},
    };
  }

  private computeChecksum(
    sourceServer: string,
    input: EvidenceInput
  ): string {
    return stableChecksum({
      source_server: sourceServer,
      source_uri: input.source_uri,
      classification: input.classification,
      content: input.content,
      tower: input.tower,
      claims: input.claims ?? [],
      metadata: input.metadata ?? {},
    });
  }

  private getWorkspaceArtifactsMap(
    workspaceId: string
  ): Map<string, EvidenceArtifact> {
    if (!this.artifactsByWorkspace.has(workspaceId)) {
      this.artifactsByWorkspace.set(workspaceId, new Map());
    }
    return this.artifactsByWorkspace.get(workspaceId)!;
  }

  private getWorkspaceChecksumIndex(
    workspaceId: string
  ): Map<string, string> {
    if (!this.checksumIndexByWorkspace.has(workspaceId)) {
      this.checksumIndexByWorkspace.set(workspaceId, new Map());
    }
    return this.checksumIndexByWorkspace.get(workspaceId)!;
  }
}
