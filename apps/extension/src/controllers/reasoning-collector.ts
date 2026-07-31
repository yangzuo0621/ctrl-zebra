import type { AgentRuntimeEvent } from "@ctrl-zebra/core";
import {
  maxReasoningBlockCodePoints,
  maxReasoningBlocksPerRun,
  maxReasoningBlockUtf8Bytes,
  maxReasoningDeltaCodePoints,
  maxReasoningDeltaUtf8Bytes,
  maxReasoningRunCodePoints,
  maxReasoningRunUtf8Bytes,
  measureReasoningText,
  type ReasoningLimitData,
  takeReasoningTextPrefix,
} from "@ctrl-zebra/protocol";

export type CollectedReasoningEvent =
  | {
      readonly type: "session.reasoning-start";
      readonly sessionId: string;
      readonly blockId: string;
    }
  | {
      readonly type: "session.reasoning-delta";
      readonly sessionId: string;
      readonly blockId: string;
      readonly text: string;
    }
  | {
      readonly type: "session.reasoning-end";
      readonly sessionId: string;
      readonly blockId: string;
      readonly truncated: boolean;
    }
  | ({ readonly type: "session.reasoning-limit"; readonly sessionId: string } & ReasoningLimitData);

interface OpenReasoningBlock {
  readonly blockId: string;
  codePoints: number;
  utf8Bytes: number;
  truncated: boolean;
}

type RuntimeReasoningEvent = Extract<
  AgentRuntimeEvent,
  {
    readonly type: "agent.reasoning-start" | "agent.reasoning-delta" | "agent.reasoning-end";
  }
>;

export class ReasoningCollector {
  readonly #seenBlockIds = new Set<string>();
  #openBlock: OpenReasoningBlock | undefined;
  #suppressedBlockId: string | undefined;
  #acceptedBlocks = 0;
  #runCodePoints = 0;
  #runUtf8Bytes = 0;
  #runTruncated = false;
  #blockCountLimitSent = false;
  #closed = false;

  constructor(private readonly sessionId: string) {}

  accept(event: RuntimeReasoningEvent): readonly CollectedReasoningEvent[] {
    if (this.#closed || event.sessionId !== this.sessionId) {
      return [];
    }

    if (event.type === "agent.reasoning-start") {
      return this.#start(event.blockId);
    }
    if (event.type === "agent.reasoning-delta") {
      return this.#delta(event.blockId, event.text);
    }
    return this.#end(event.blockId);
  }

  close(): void {
    this.#closed = true;
    this.#openBlock = undefined;
    this.#suppressedBlockId = undefined;
  }

  #start(blockId: string): readonly CollectedReasoningEvent[] {
    if (
      this.#openBlock !== undefined ||
      this.#suppressedBlockId !== undefined ||
      this.#seenBlockIds.has(blockId)
    ) {
      return [];
    }
    this.#seenBlockIds.add(blockId);

    if (this.#acceptedBlocks >= maxReasoningBlocksPerRun) {
      this.#suppressedBlockId = blockId;
      if (this.#blockCountLimitSent) {
        return [];
      }
      this.#blockCountLimitSent = true;
      this.#runTruncated = true;
      return [
        {
          type: "session.reasoning-limit",
          sessionId: this.sessionId,
          scope: "run",
          reason: "block-count",
        },
      ];
    }

    this.#acceptedBlocks += 1;
    this.#openBlock = {
      blockId,
      codePoints: 0,
      utf8Bytes: 0,
      truncated: false,
    };
    return [{ type: "session.reasoning-start", sessionId: this.sessionId, blockId }];
  }

  #delta(blockId: string, text: string): readonly CollectedReasoningEvent[] {
    const block = this.#openBlock;
    if (block === undefined || block.blockId !== blockId || block.truncated || text.length === 0) {
      return [];
    }

    const measurement = measureReasoningText(text);
    if (
      measurement === undefined ||
      measurement.codePoints > maxReasoningDeltaCodePoints ||
      measurement.utf8Bytes > maxReasoningDeltaUtf8Bytes
    ) {
      return [];
    }

    if (this.#runTruncated) {
      block.truncated = true;
      return [];
    }

    const blockPrefix = takeReasoningTextPrefix(
      text,
      maxReasoningBlockCodePoints - block.codePoints,
      maxReasoningBlockUtf8Bytes - block.utf8Bytes,
    );
    const runPrefix = takeReasoningTextPrefix(
      text,
      maxReasoningRunCodePoints - this.#runCodePoints,
      maxReasoningRunUtf8Bytes - this.#runUtf8Bytes,
    );
    if (blockPrefix === undefined || runPrefix === undefined) {
      return [];
    }

    const accepted =
      blockPrefix.measurement.codePoints <= runPrefix.measurement.codePoints
        ? blockPrefix
        : runPrefix;
    const blockLimited =
      !blockPrefix.complete &&
      blockPrefix.measurement.codePoints === accepted.measurement.codePoints;
    const runLimited =
      !runPrefix.complete && runPrefix.measurement.codePoints === accepted.measurement.codePoints;
    const output: CollectedReasoningEvent[] = [];

    if (accepted.text.length > 0) {
      output.push({
        type: "session.reasoning-delta",
        sessionId: this.sessionId,
        blockId,
        text: accepted.text,
      });
      block.codePoints += accepted.measurement.codePoints;
      block.utf8Bytes += accepted.measurement.utf8Bytes;
      this.#runCodePoints += accepted.measurement.codePoints;
      this.#runUtf8Bytes += accepted.measurement.utf8Bytes;
    }

    if (blockLimited) {
      block.truncated = true;
      output.push({
        type: "session.reasoning-limit",
        sessionId: this.sessionId,
        scope: "block",
        blockId,
        reason: blockPrefix.reason ?? "code-points",
      });
    }
    if (runLimited) {
      block.truncated = true;
      this.#runTruncated = true;
      output.push({
        type: "session.reasoning-limit",
        sessionId: this.sessionId,
        scope: "run",
        reason: runPrefix.reason ?? "code-points",
      });
    }

    return output;
  }

  #end(blockId: string): readonly CollectedReasoningEvent[] {
    if (this.#suppressedBlockId === blockId) {
      this.#suppressedBlockId = undefined;
      return [];
    }

    const block = this.#openBlock;
    if (block === undefined || block.blockId !== blockId) {
      return [];
    }
    this.#openBlock = undefined;
    return [
      {
        type: "session.reasoning-end",
        sessionId: this.sessionId,
        blockId,
        truncated: block.truncated,
      },
    ];
  }
}

export function isRuntimeReasoningEvent(event: AgentRuntimeEvent): event is RuntimeReasoningEvent {
  return (
    event.type === "agent.reasoning-start" ||
    event.type === "agent.reasoning-delta" ||
    event.type === "agent.reasoning-end"
  );
}
