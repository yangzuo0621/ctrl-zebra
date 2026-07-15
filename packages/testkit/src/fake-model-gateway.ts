import type { ModelEvent, ModelGateway, ModelRequest } from "@ctrl-zebra/core";

export class FakeModelGateway implements ModelGateway {
  readonly #events: readonly ModelEvent[];

  constructor(events: readonly ModelEvent[]) {
    this.#events = [...events];
  }

  async *stream(_request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    signal.throwIfAborted();

    for (const event of this.#events) {
      signal.throwIfAborted();
      yield event;
    }
  }
}
