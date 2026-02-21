import { randomUUID } from "node:crypto";
import type { EvidenceQuestion, EvidenceRequest } from "../types.js";

export class GapRequestService {
  private requestsByWorkspace = new Map<string, Map<string, EvidenceRequest>>();

  createRequest(
    workspaceId: string,
    findingId: string,
    questionnaire: Array<{ prompt: string; required?: boolean }>
  ): EvidenceRequest {
    const request: EvidenceRequest = {
      request_id: randomUUID(),
      workspace_id: workspaceId,
      finding_id: findingId,
      questionnaire: questionnaire.map((question) =>
        this.toQuestion(question.prompt, question.required ?? true)
      ),
      status: "pending",
      created_at: new Date().toISOString(),
    };

    this.getWorkspaceRequests(workspaceId).set(request.request_id, request);
    return request;
  }

  listRequests(workspaceId: string): EvidenceRequest[] {
    return Array.from(this.getWorkspaceRequests(workspaceId).values());
  }

  private toQuestion(prompt: string, required: boolean): EvidenceQuestion {
    return {
      question_id: randomUUID(),
      prompt,
      required,
    };
  }

  private getWorkspaceRequests(
    workspaceId: string
  ): Map<string, EvidenceRequest> {
    if (!this.requestsByWorkspace.has(workspaceId)) {
      this.requestsByWorkspace.set(workspaceId, new Map());
    }
    return this.requestsByWorkspace.get(workspaceId)!;
  }
}
