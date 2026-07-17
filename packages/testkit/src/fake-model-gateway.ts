import type { ModelEvent, ModelGateway, ModelRequest } from "@ctrl-zebra/core";

export class FakeModelGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];
  readonly #steps: readonly (readonly ModelEvent[])[];
  #nextStep = 0;

  constructor(steps: readonly (readonly ModelEvent[])[]) {
    this.#steps = steps.map((events) => [...events]);
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    signal.throwIfAborted();
    this.requests.push(request);
    const events = this.#steps[this.#nextStep];
    this.#nextStep += 1;

    if (events === undefined) {
      throw new Error("FakeModelGateway has no scripted response for this request.");
    }

    for (const event of events) {
      signal.throwIfAborted();
      yield event;
    }
  }
}
