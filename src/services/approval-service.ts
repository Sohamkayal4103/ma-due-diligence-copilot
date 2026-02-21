import { randomUUID } from "node:crypto";
import type { ApprovalRequest, Decision, Finding, RiskSeverity } from "../types.js";

export class ApprovalService {
  private approvalsByWorkspace = new Map<string, Map<string, ApprovalRequest>>();
  private findingToApproval = new Map<string, string>();

  createOrGetApproval(
    workspaceId: string,
    finding: Finding,
    requestedBy: string,
    riskLevel: RiskSeverity
  ): { approval: ApprovalRequest; created: boolean } {
    const existingId = this.findingToApproval.get(finding.finding_id);
    if (existingId) {
      const existing = this.getWorkspaceApprovals(workspaceId).get(existingId);
      if (existing) {
        return { approval: existing, created: false };
      }
    }

    const approval: ApprovalRequest = {
      approval_id: randomUUID(),
      workspace_id: workspaceId,
      object_type: "finding",
      object_id: finding.finding_id,
      risk_level: riskLevel,
      requested_by: requestedBy,
      decision: null,
      reason: null,
      requested_at: new Date().toISOString(),
      decided_at: null,
    };

    this.getWorkspaceApprovals(workspaceId).set(approval.approval_id, approval);
    this.findingToApproval.set(finding.finding_id, approval.approval_id);
    return { approval, created: true };
  }

  decideApproval(
    workspaceId: string,
    findingId: string,
    decision: Decision,
    reason: string
  ): ApprovalRequest {
    const approval = this.requireApprovalByFinding(workspaceId, findingId);
    approval.decision = decision;
    approval.reason = reason;
    approval.decided_at = new Date().toISOString();
    return approval;
  }

  listApprovals(workspaceId: string): ApprovalRequest[] {
    return Array.from(this.getWorkspaceApprovals(workspaceId).values()).sort(
      (a, b) => a.requested_at.localeCompare(b.requested_at)
    );
  }

  requireApprovalByFinding(
    workspaceId: string,
    findingId: string
  ): ApprovalRequest {
    const approvalId = this.findingToApproval.get(findingId);
    if (!approvalId) {
      throw new Error(`No approval request found for finding '${findingId}'`);
    }

    const approval = this.getWorkspaceApprovals(workspaceId).get(approvalId);
    if (!approval) {
      throw new Error(
        `Approval '${approvalId}' not found in workspace '${workspaceId}'`
      );
    }

    return approval;
  }

  private getWorkspaceApprovals(
    workspaceId: string
  ): Map<string, ApprovalRequest> {
    if (!this.approvalsByWorkspace.has(workspaceId)) {
      this.approvalsByWorkspace.set(workspaceId, new Map());
    }
    return this.approvalsByWorkspace.get(workspaceId)!;
  }
}
