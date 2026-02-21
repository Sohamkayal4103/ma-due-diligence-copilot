import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "../types.js";

type EventHandler<TPayload extends Record<string, unknown> = Record<string, unknown>> = (
  event: EventEnvelope<TPayload>
) => Promise<void> | void;

export class InMemoryEventBus {
  private handlers = new Map<string, Set<EventHandler<any>>>();
  private allHandlers = new Set<EventHandler<any>>();
  private events: EventEnvelope[] = [];

  subscribe<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    eventType: string,
    handler: EventHandler<TPayload>
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  subscribeAll<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    handler: EventHandler<TPayload>
  ): () => void {
    this.allHandlers.add(handler);
    return () => this.allHandlers.delete(handler);
  }

  async publish<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    eventType: string,
    workspaceId: string,
    payload: TPayload
  ): Promise<EventEnvelope<TPayload>> {
    const event: EventEnvelope<TPayload> = {
      event_id: randomUUID(),
      event_type: eventType,
      workspace_id: workspaceId,
      created_at: new Date().toISOString(),
      payload,
    };

    this.events.push(event);

    const handlers = this.handlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        await handler(event);
      }
    }

    for (const handler of this.allHandlers) {
      await handler(event);
    }

    return event;
  }

  getEvents(workspaceId?: string): EventEnvelope[] {
    if (!workspaceId) {
      return [...this.events];
    }
    return this.events.filter((event) => event.workspace_id === workspaceId);
  }
}
