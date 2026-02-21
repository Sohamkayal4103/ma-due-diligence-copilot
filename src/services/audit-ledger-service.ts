import { randomUUID } from "node:crypto";
import type { AuditLedgerEntry } from "../types.js";
import { stableChecksum } from "../utils/hash.js";

export class AuditLedgerService {
  private entriesByWorkspace = new Map<string, AuditLedgerEntry[]>();

  appendEntry(params: {
    workspace_id: string;
    action: string;
    actor_id: string;
    object_type: string;
    object_id: string;
    metadata?: Record<string, unknown>;
  }): AuditLedgerEntry {
    const entries = this.getWorkspaceEntries(params.workspace_id);
    const previousHash = entries.length
      ? entries[entries.length - 1].entry_hash
      : "GENESIS";
    const timestamp = new Date().toISOString();

    const entryPayload = {
      workspace_id: params.workspace_id,
      action: params.action,
      actor_id: params.actor_id,
      object_type: params.object_type,
      object_id: params.object_id,
      metadata: params.metadata ?? {},
      timestamp,
      previous_hash: previousHash,
    };

    const entry: AuditLedgerEntry = {
      entry_id: randomUUID(),
      ...entryPayload,
      entry_hash: stableChecksum(entryPayload),
    };

    entries.push(entry);
    return entry;
  }

  listEntries(workspaceId: string): AuditLedgerEntry[] {
    return [...this.getWorkspaceEntries(workspaceId)];
  }

  private getWorkspaceEntries(workspaceId: string): AuditLedgerEntry[] {
    if (!this.entriesByWorkspace.has(workspaceId)) {
      this.entriesByWorkspace.set(workspaceId, []);
    }
    return this.entriesByWorkspace.get(workspaceId)!;
  }
}
