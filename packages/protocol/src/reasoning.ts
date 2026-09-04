import { z } from "zod";

import { utf8BytesForCodePoint } from "./text-primitives.js";

export const maxReasoningBlockIdCharacters = 128;
export const maxReasoningDeltaCodePoints = 8_192;
export const maxReasoningDeltaUtf8Bytes = 32_768;
export const maxReasoningBlockCodePoints = 32_768;
export const maxReasoningBlockUtf8Bytes = 131_072;
export const maxReasoningRunCodePoints = 65_536;
export const maxReasoningRunUtf8Bytes = 262_144;
export const maxReasoningBlocksPerRun = 32;

export interface ReasoningTextMeasurement {
  readonly codePoints: number;
  readonly utf8Bytes: number;
}

export interface ReasoningTextPrefix {
  readonly text: string;
  readonly measurement: ReasoningTextMeasurement;
  readonly complete: boolean;
  readonly reason?: "code-points" | "utf8-bytes";
}

export const reasoningBlockIdSchema = z.string().min(1).max(maxReasoningBlockIdCharacters);

export const reasoningDeltaTextSchema = createReasoningTextSchema(
  maxReasoningDeltaCodePoints,
  maxReasoningDeltaUtf8Bytes,
);

export const reasoningBlockStartDataSchema = z.strictObject({
  blockId: reasoningBlockIdSchema,
});

export const reasoningDeltaDataSchema = z.strictObject({
  blockId: reasoningBlockIdSchema,
  text: reasoningDeltaTextSchema,
});

export const reasoningEndDataSchema = z.strictObject({
  blockId: reasoningBlockIdSchema,
  truncated: z.boolean(),
});

export const reasoningBlockLimitDataSchema = z.strictObject({
  scope: z.literal("block"),
  blockId: reasoningBlockIdSchema,
  reason: z.enum(["code-points", "utf8-bytes"]),
});

export const reasoningRunLimitDataSchema = z.strictObject({
  scope: z.literal("run"),
  reason: z.enum(["code-points", "utf8-bytes", "block-count"]),
});

export const reasoningLimitDataSchema = z.discriminatedUnion("scope", [
  reasoningBlockLimitDataSchema,
  reasoningRunLimitDataSchema,
]);

const restoredReasoningContentSchema = createReasoningTextSchema(
  maxReasoningBlockCodePoints,
  maxReasoningBlockUtf8Bytes,
);

const restoredReasoningBlockShape = {
  blockId: reasoningBlockIdSchema,
  startSequence: z.int().positive(),
  content: restoredReasoningContentSchema,
  truncated: z.boolean(),
};

export const completeRestoredReasoningBlockSchema = z
  .strictObject({
    ...restoredReasoningBlockShape,
    endSequence: z.int().positive(),
    state: z.literal("complete"),
  })
  .refine(({ startSequence, endSequence }) => endSequence > startSequence, {
    message: "A reasoning block must end after it starts.",
    path: ["endSequence"],
  });

export const partialRestoredReasoningBlockSchema = z.strictObject({
  ...restoredReasoningBlockShape,
  state: z.literal("partial"),
});

export const restoredReasoningBlockSchema = z.discriminatedUnion("state", [
  completeRestoredReasoningBlockSchema,
  partialRestoredReasoningBlockSchema,
]);

export const restoredReasoningSchema = z
  .strictObject({
    sessionId: z.string().min(1).max(128),
    blocks: z.array(restoredReasoningBlockSchema).max(maxReasoningBlocksPerRun),
    runTruncated: z.boolean(),
  })
  .superRefine(({ blocks }, context) => {
    let codePoints = 0;
    let utf8Bytes = 0;
    const blockIds = new Set<string>();
    let previousEndSequence = 0;
    let partialSeen = false;

    for (const [index, block] of blocks.entries()) {
      if (blockIds.has(block.blockId)) {
        context.addIssue({
          code: "custom",
          message: "Restored reasoning block IDs must be unique.",
          path: ["blocks", index, "blockId"],
        });
      }
      blockIds.add(block.blockId);

      if (partialSeen || block.startSequence <= previousEndSequence) {
        context.addIssue({
          code: "custom",
          message: "Restored reasoning blocks must preserve non-overlapping event order.",
          path: ["blocks", index, "startSequence"],
        });
      }
      if (block.state === "complete") {
        previousEndSequence = block.endSequence;
      } else {
        partialSeen = true;
      }

      const measurement = measureReasoningText(block.content);
      if (measurement === undefined) {
        continue;
      }
      codePoints += measurement.codePoints;
      utf8Bytes += measurement.utf8Bytes;
    }

    if (codePoints > maxReasoningRunCodePoints) {
      context.addIssue({
        code: "custom",
        message: "Restored reasoning exceeds the run code-point limit.",
        path: ["blocks"],
      });
    }
    if (utf8Bytes > maxReasoningRunUtf8Bytes) {
      context.addIssue({
        code: "custom",
        message: "Restored reasoning exceeds the run UTF-8 byte limit.",
        path: ["blocks"],
      });
    }
  });

export type ReasoningBlockStartData = z.infer<typeof reasoningBlockStartDataSchema>;
export type ReasoningDeltaData = z.infer<typeof reasoningDeltaDataSchema>;
export type ReasoningEndData = z.infer<typeof reasoningEndDataSchema>;
export type ReasoningLimitData = z.infer<typeof reasoningLimitDataSchema>;
export type RestoredReasoningBlock = z.infer<typeof restoredReasoningBlockSchema>;
export type RestoredReasoning = z.infer<typeof restoredReasoningSchema>;

export function measureReasoningText(value: string): ReasoningTextMeasurement | undefined {
  if (!value.isWellFormed()) {
    return undefined;
  }

  return { codePoints: [...value].length, utf8Bytes: new TextEncoder().encode(value).byteLength };
}

export function takeReasoningTextPrefix(
  value: string,
  maxCodePoints: number,
  maxUtf8Bytes: number,
): ReasoningTextPrefix | undefined {
  let codePoints = 0;
  let utf8Bytes = 0;
  let end = 0;

  for (let index = 0; index < value.length; index += 1) {
    const firstCodeUnit = value.charCodeAt(index);
    let codePoint = firstCodeUnit;
    let codeUnits = 1;

    if (firstCodeUnit >= 0xd800 && firstCodeUnit <= 0xdbff) {
      const secondCodeUnit = value.charCodeAt(index + 1);
      if (!(secondCodeUnit >= 0xdc00 && secondCodeUnit <= 0xdfff)) {
        return undefined;
      }
      codePoint = 0x10000 + ((firstCodeUnit - 0xd800) << 10) + (secondCodeUnit - 0xdc00);
      codeUnits = 2;
    } else if (firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff) {
      return undefined;
    }

    const nextCodePoints = codePoints + 1;
    const nextUtf8Bytes = utf8Bytes + utf8BytesForCodePoint(codePoint);
    const exceedsCodePoints = nextCodePoints > maxCodePoints;
    const exceedsUtf8Bytes = nextUtf8Bytes > maxUtf8Bytes;
    if (exceedsCodePoints || exceedsUtf8Bytes) {
      return {
        text: value.slice(0, end),
        measurement: { codePoints, utf8Bytes },
        complete: false,
        reason: exceedsUtf8Bytes ? "utf8-bytes" : "code-points",
      };
    }

    codePoints = nextCodePoints;
    utf8Bytes = nextUtf8Bytes;
    end = index + codeUnits;
    index += codeUnits - 1;
  }

  return {
    text: value,
    measurement: { codePoints, utf8Bytes },
    complete: true,
  };
}

function createReasoningTextSchema(maxCodePoints: number, maxUtf8Bytes: number) {
  return z
    .string()
    .min(1)
    .superRefine((value, context) => {
      const measurement = measureReasoningText(value);
      if (measurement === undefined) {
        context.addIssue({
          code: "custom",
          message: "Reasoning text must contain well-formed Unicode.",
        });
        return;
      }
      if (measurement.codePoints > maxCodePoints) {
        context.addIssue({
          code: "custom",
          message: `Reasoning text must not exceed ${maxCodePoints} Unicode code points.`,
        });
      }
      if (measurement.utf8Bytes > maxUtf8Bytes) {
        context.addIssue({
          code: "custom",
          message: `Reasoning text must not exceed ${maxUtf8Bytes} UTF-8 bytes.`,
        });
      }
    });
}
