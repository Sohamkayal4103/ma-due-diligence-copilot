import type {
  Actor,
  Finding,
  RiskSeverity,
  Workspace,
  WorkspaceRole,
} from "../types.js";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  analyst: 2,
  reviewer: 3,
  admin: 4,
};

export class PolicyService {
  private readonly defaultSystemActor: Actor = {
    user_id: "system",
    tenant_id: "*",
    role: "admin",
    scopes: ["*"],
  };

  resolveActor(actor?: Actor): Actor {
    return actor ?? this.defaultSystemActor;
  }

  assertScope(actor: Actor, requiredScope: string): void {
    if (actor.scopes.includes("*")) {
      return;
    }

    const allowed = actor.scopes.includes(requiredScope);
    if (!allowed) {
      throw new Error(
        `Access denied: actor '${actor.user_id}' does not have required scope '${requiredScope}'`
      );
    }
  }

  assertMinimumRole(actor: Actor, requiredRole: WorkspaceRole): void {
    if (ROLE_RANK[actor.role] < ROLE_RANK[requiredRole]) {
      throw new Error(
        `Access denied: actor role '${actor.role}' is below required role '${requiredRole}'`
      );
    }
  }

  requiresApproval(workspace: Workspace, finding: Finding): boolean {
    if (finding.severity === "critical" || finding.severity === "high") {
      return true;
    }

    if (finding.impact_value >= workspace.materiality_threshold) {
      return true;
    }

    return false;
  }

  classifyRiskLevel(finding: Finding): RiskSeverity {
    return finding.severity;
  }
}
