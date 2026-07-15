export interface DomainEvent {
  readonly type: string;
}

export interface EventSink<Event extends DomainEvent = DomainEvent> {
  emit(event: Event): void;
}
