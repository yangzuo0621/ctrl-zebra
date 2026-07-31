import type { ModelEvent, ModelGateway, ModelRequest } from "@ctrl-zebra/core";

export type FakeModelGatewayStep = readonly ModelEvent[] | Error;

export class FakeModelGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];
  readonly #steps: readonly FakeModelGatewayStep[];
  #nextStep = 0;

  constructor(steps: readonly FakeModelGatewayStep[]) {
    this.#steps = steps.map((step) => (step instanceof Error ? step : [...step]));
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    signal.throwIfAborted();
    this.requests.push(request);
    const events = this.#steps[this.#nextStep];
    this.#nextStep += 1;

    if (events === undefined) {
      throw new Error("FakeModelGateway has no scripted response for this request.");
    }
    if (events instanceof Error) {
      throw events;
    }

    for (const event of events) {
      signal.throwIfAborted();
      yield event;
    }
  }
}
