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

  async run(userMessage: UserMessage): Promise<void> {
    const session = new SessionStateMachine(userMessage.sessionId, "idle", this.#eventSink);

    try {
      session.transitionTo("preparing");
      const stream = this.#modelGateway.stream(
        {
          messages: [{ role: "user", content: userMessage.content }],
        },
        new AbortController().signal,
      );
      session.transitionTo("streaming");

      for await (const event of stream) {
        if (event.type === "text.delta") {
          this.#eventSink.emit({
            type: "agent.text-delta",
            sessionId: userMessage.sessionId,
            text: event.text,
          });
        }
      }

      session.transitionTo("completed");
    } catch (error) {
      if (isActiveStatus(session.status)) {
        session.transitionTo("failed");
      }
      throw error;
    }
  }
}

function isActiveStatus(status: SessionStatus): boolean {
  return status === "preparing" || status === "streaming";
}
