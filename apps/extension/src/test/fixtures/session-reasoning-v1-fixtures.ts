import type { PersistedEventRecord } from "@ctrl-zebra/protocol";

export const completeReasoningV1Events = [
  event(1, "session.reasoning-start", { blockId: "reasoning-1" }),
  event(2, "session.reasoning-delta", { blockId: "reasoning-1", text: "Check " }),
  event(3, "agent.text-delta", { text: "Answer" }),
  event(4, "session.reasoning-delta", { blockId: "reasoning-1", text: "facts." }),
  event(5, "session.reasoning-end", { blockId: "reasoning-1", truncated: false }),
] as const satisfies readonly PersistedEventRecord[];

export const partialReasoningV1Events = [
  event(1, "session.reasoning-start", { blockId: "reasoning-partial" }),
  event(2, "session.reasoning-delta", {
    blockId: "reasoning-partial",
    text: "Unfinished",
  }),
] as const satisfies readonly PersistedEventRecord[];

export const preReasoningV1Events = [
  event(1, "agent.text-delta", { text: "Legacy answer" }),
] as const satisfies readonly PersistedEventRecord[];

export const malformedReasoningV1Events = [
  event(1, "session.reasoning-start", { blockId: "reasoning-1" }),
  event(2, "session.reasoning-start", { blockId: "reasoning-2" }),
] as const satisfies readonly PersistedEventRecord[];

function event(sequence: number, type: string, data: PersistedEventRecord["event"]["data"]) {
  return {
    sequence,
    recordedAt: `2026-07-31T00:00:0${sequence}.000Z`,
    event: { type, data },
  };
}
