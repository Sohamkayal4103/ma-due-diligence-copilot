import { randomUUID } from "node:crypto";
import type {
  Actor,
  DiligenceTower,
  Workspace,
  WorkspaceCreateInput,
  WorkspaceParticipant,
  WorkspaceRole,
} from "../types.js";

const DEFAULT_TOWERS: DiligenceTower[] = [
  "financial",
  "legal_regulatory",
  "commercial_market",
  "operations_supply_chain",
  "people_hr",
  "tax_jurisdiction",
  "technical_cyber",
];

export class WorkspaceService {
  private workspaces = new Map<string, Workspace>();

  createWorkspace(input: WorkspaceCreateInput): Workspace {
    const now = new Date().toISOString();
    const workspaceId = input.workspace_id ?? randomUUID();

    const workspace: Workspace = {
      workspace_id: workspaceId,
      tenant_id: input.tenant_id,
      deal_name: input.deal_name,
      thesis: input.thesis,
      status: input.status ?? "active",
      policy_profile: input.policy_profile ?? "strict-default",
      materiality_threshold: input.materiality_threshold ?? 5_000_000,
      enabled_towers: input.enabled_towers ?? [...DEFAULT_TOWERS],
      participants: [],
      created_at: now,
      updated_at: now,
    };

    this.workspaces.set(workspace.workspace_id, workspace);
    return workspace;
  }

  listWorkspaces(tenantId?: string): Workspace[] {
    const items = Array.from(this.workspaces.values());
    if (!tenantId) {
      return items;
    }
    return items.filter((workspace) => workspace.tenant_id === tenantId);
  }

  getWorkspace(workspaceId: string): Workspace | null {
    return this.workspaces.get(workspaceId) ?? null;
  }

  requireWorkspace(workspaceId: string): Workspace {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace '${workspaceId}' not found`);
    }
    return workspace;
  }

  assertWorkspaceAccess(workspaceId: string, actor: Actor): Workspace {
    const workspace = this.requireWorkspace(workspaceId);
    if (actor.tenant_id !== "*" && workspace.tenant_id !== actor.tenant_id) {
      throw new Error(
        `Access denied: actor tenant '${actor.tenant_id}' does not match workspace tenant '${workspace.tenant_id}'`
      );
    }
    return workspace;
  }

  addParticipant(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole
  ): WorkspaceParticipant {
    const workspace = this.requireWorkspace(workspaceId);
    const existing = workspace.participants.find(
      (participant) => participant.user_id === userId
    );
    if (existing) {
      existing.role = role;
      workspace.updated_at = new Date().toISOString();
      return existing;
    }

    const participant: WorkspaceParticipant = {
      user_id: userId,
      role,
      added_at: new Date().toISOString(),
    };

    workspace.participants.push(participant);
    workspace.updated_at = new Date().toISOString();
    return participant;
  }

  ensureTowerEnabled(workspaceId: string, tower: DiligenceTower): void {
    const workspace = this.requireWorkspace(workspaceId);
    if (!workspace.enabled_towers.includes(tower)) {
      throw new Error(
        `Tower '${tower}' is not enabled for workspace '${workspaceId}'`
      );
    }
  }
}
