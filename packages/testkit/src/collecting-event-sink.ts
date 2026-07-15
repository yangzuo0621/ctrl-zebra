import type { DomainEvent, EventSink } from "@ctrl-zebra/core";

export class CollectingEventSink<Event extends DomainEvent = DomainEvent>
  implements EventSink<Event>
{
  readonly #events: Event[] = [];

  emit(event: Event): void {
    this.#events.push(event);
  }

  get events(): readonly Event[] {
    return [...this.#events];
  }
}
