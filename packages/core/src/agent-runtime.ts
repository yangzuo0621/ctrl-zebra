import type { SessionId, SessionStatus, UserMessage } from "@ctrl-zebra/protocol";

import type { DomainEvent, EventSink } from "./events.js";
import type { ModelGateway } from "./model-gateway.js";
import { SessionStateMachine, type SessionStatusChangedEvent } from "./session-state-machine.js";

export interface AgentTextDeltaEvent extends DomainEvent {
  readonly type: "agent.text-delta";
  readonly sessionId: SessionId;
  readonly text: string;
}

export type AgentRuntimeEvent = AgentTextDeltaEvent | SessionStatusChangedEvent;

export class AgentRuntime {
  readonly #modelGateway: ModelGateway;
  readonly #eventSink: EventSink<AgentRuntimeEvent>;

  constructor(modelGateway: ModelGateway, eventSink: EventSink<AgentRuntimeEvent>) {
    this.#modelGateway = modelGateway;
    this.#eventSink = eventSink;
  }

  async run(userMessage: UserMessage, signal: AbortSignal): Promise<void> {
    const session = new SessionStateMachine(userMessage.sessionId, "idle", this.#eventSink);

    try {
      session.transitionTo("preparing");
      signal.throwIfAborted();
      const stream = this.#modelGateway.stream(
        {
          messages: [{ role: "user", content: userMessage.content }],
        },
        signal,
      );
      session.transitionTo("streaming");

      for await (const event of stream) {
        if (event.type === "text.delta") {
          signal.throwIfAborted();
          this.#eventSink.emit({
            type: "agent.text-delta",
            sessionId: userMessage.sessionId,
            text: event.text,
          });
        }
      }

      signal.throwIfAborted();
      session.transitionTo("completed");
    } catch (error) {
      if (isCancellation(error, signal)) {
        if (isActiveStatus(session.status)) {
          session.transitionTo("cancelled");
        }
        return;
      }

      if (isActiveStatus(session.status)) {
        session.transitionTo("failed");
      }
      throw error;
    }
  }
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted && error === signal.reason;
}

function isActiveStatus(status: SessionStatus): boolean {
  return status === "preparing" || status === "streaming";
}
