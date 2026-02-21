import { randomUUID } from "node:crypto";
import type { CanonicalEntity, EvidenceArtifact } from "../types.js";

export interface NormalizeResult {
  created_entities: CanonicalEntity[];
  linked_entity_ids: string[];
}

export class CanonicalModelService {
  private entitiesByWorkspace = new Map<string, Map<string, CanonicalEntity>>();
  private entityIndexByWorkspace = new Map<string, Map<string, string>>();

  normalizeEvidence(artifact: EvidenceArtifact): NormalizeResult {
    const wsEntities = this.getWorkspaceEntitiesMap(artifact.workspace_id);
    const wsIndex = this.getWorkspaceEntityIndex(artifact.workspace_id);

    const keys: Array<{
      entity_type: string;
      entity_key: string;
      attributes: Record<string, unknown>;
    }> = [];

    for (const claim of artifact.claims) {
      keys.push({
        entity_type: inferEntityTypeFromSubject(claim.subject),
        entity_key: `${claim.subject}`,
        attributes: { subject: claim.subject, [`claim_${claim.field}`]: claim.value },
      });
    }

    const inlineSignals = extractInlineEntities(artifact.content);
    for (const signal of inlineSignals) {
      keys.push(signal);
    }

    if (keys.length === 0) {
      const fallback = {
        entity_type: "document",
        entity_key: `${artifact.source_server}:${artifact.source_uri}`,
        attributes: {
          source_server: artifact.source_server,
          source_uri: artifact.source_uri,
          classification: artifact.classification,
        },
      };
      keys.push(fallback);
    }

    const created: CanonicalEntity[] = [];
    const linked: string[] = [];

    for (const key of keys) {
      const indexKey = `${key.entity_type}:${key.entity_key}`;
      const existingId = wsIndex.get(indexKey);

      if (existingId) {
        const existing = wsEntities.get(existingId);
        if (existing) {
          existing.attributes = { ...existing.attributes, ...key.attributes };
          if (!existing.source_refs.includes(artifact.artifact_id)) {
            existing.source_refs.push(artifact.artifact_id);
          }
          linked.push(existing.entity_id);
        }
        continue;
      }

      const entity: CanonicalEntity = {
        entity_id: randomUUID(),
        workspace_id: artifact.workspace_id,
        entity_type: key.entity_type,
        attributes: key.attributes,
        source_refs: [artifact.artifact_id],
      };

      wsEntities.set(entity.entity_id, entity);
      wsIndex.set(indexKey, entity.entity_id);
      created.push(entity);
      linked.push(entity.entity_id);
    }

    return { created_entities: created, linked_entity_ids: linked };
  }

  listEntities(workspaceId: string): CanonicalEntity[] {
    return Array.from(this.getWorkspaceEntitiesMap(workspaceId).values());
  }

  private getWorkspaceEntitiesMap(
    workspaceId: string
  ): Map<string, CanonicalEntity> {
    if (!this.entitiesByWorkspace.has(workspaceId)) {
      this.entitiesByWorkspace.set(workspaceId, new Map());
    }
    return this.entitiesByWorkspace.get(workspaceId)!;
  }

  private getWorkspaceEntityIndex(
    workspaceId: string
  ): Map<string, string> {
    if (!this.entityIndexByWorkspace.has(workspaceId)) {
      this.entityIndexByWorkspace.set(workspaceId, new Map());
    }
    return this.entityIndexByWorkspace.get(workspaceId)!;
  }
}

function inferEntityTypeFromSubject(subject: string): string {
  const value = subject.toLowerCase();
  if (value.startsWith("customer") || value.includes("client")) {
    return "customer";
  }
  if (value.startsWith("vendor") || value.includes("supplier")) {
    return "supplier";
  }
  if (value.startsWith("contract")) {
    return "contract";
  }
  if (value.startsWith("employee") || value.includes("talent")) {
    return "employee";
  }
  return "entity";
}

function extractInlineEntities(content: string): Array<{
  entity_type: string;
  entity_key: string;
  attributes: Record<string, unknown>;
}> {
  const lines = content.split(/\r?\n/);
  const entities: Array<{
    entity_type: string;
    entity_key: string;
    attributes: Record<string, unknown>;
  }> = [];

  for (const line of lines) {
    const match = line.match(/^\s*(Customer|Entity|Contract|Supplier|Employee)\s*:\s*(.+)$/i);
    if (!match) {
      continue;
    }

    const [, kindRaw, valueRaw] = match;
    const kind = kindRaw.toLowerCase();
    const value = valueRaw.trim();

    entities.push({
      entity_type: kind,
      entity_key: value.toLowerCase(),
      attributes: {
        name: value,
        source_hint: "inline",
      },
    });
  }

  return entities;
}
