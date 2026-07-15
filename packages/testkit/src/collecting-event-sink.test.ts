import { describe, expect, it } from "vitest";

import { CollectingEventSink } from "./index.js";

type TestEvent =
  | { readonly type: "session.started"; readonly sessionId: string }
  | { readonly type: "message.added"; readonly messageId: string }
  | { readonly type: "session.completed"; readonly sessionId: string };

describe("CollectingEventSink", () => {
  it("keeps events in emission order", () => {
    const sink = new CollectingEventSink<TestEvent>();
    const events = [
      { type: "session.started", sessionId: "session-1" },
      { type: "message.added", messageId: "message-1" },
      { type: "session.completed", sessionId: "session-1" },
    ] satisfies readonly TestEvent[];

    for (const event of events) {
      sink.emit(event);
    }

    expect(sink.events).toEqual(events);
  });

  it("returns a snapshot instead of its mutable internal collection", () => {
    const sink = new CollectingEventSink<TestEvent>();
    sink.emit({ type: "session.started", sessionId: "session-1" });

    const snapshot = sink.events;
    sink.emit({ type: "session.completed", sessionId: "session-1" });

    expect(snapshot).toEqual([{ type: "session.started", sessionId: "session-1" }]);
    expect(sink.events).toHaveLength(2);
  });
});
