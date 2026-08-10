import { z } from "zod";

import { chatMessageSchema } from "./chat-message.js";
import { checkpointIdSchema } from "./checkpoint.js";
import { mcpPromptConfirmationSchema } from "./mcp-prompt.js";
import { mcpResourceAttachmentSchema } from "./mcp-resource.js";
import {
  reasoningBlockStartDataSchema,
  reasoningDeltaDataSchema,
  reasoningEndDataSchema,
  reasoningLimitDataSchema,
} from "./reasoning.js";
import { sessionIdSchema, sessionStatusSchema } from "./session.js";
import { jsonValueSchema, toolCallSchema, toolNameSchema, toolResultSchema } from "./tool.js";
import { tokenUsageSchema } from "./usage.js";

export const persistenceFormatVersion = 1 as const;
export const persistenceSessionsDirectory = "sessions" as const;
export const persistenceFormatDirectory = `v${persistenceFormatVersion}` as const;
export const sessionManifestFileName = "manifest.json" as const;
export const sessionMessagesFileName = "messages.jsonl" as const;
export const sessionEventsFileName = "events.jsonl" as const;
export const maxPersistedSessionIdBytes = 100;
export const persistenceCheckpointsDirectory = "checkpoints" as const;
export const maxPersistedCheckpointIdBytes = 100;

const persistenceFormatVersionSchema = z.literal(persistenceFormatVersion);

export const persistedSessionIdSchema = sessionIdSchema.superRefine((sessionId, context) => {
  const bytes = encodeUtf8(sessionId);

  if (bytes === undefined) {
    context.addIssue({
      code: "custom",
      message: "Persisted Session IDs must contain well-formed Unicode.",
    });
    return;
  }

  if (bytes.length > maxPersistedSessionIdBytes) {
    context.addIssue({
      code: "custom",
      message: `Persisted Session IDs must not exceed ${maxPersistedSessionIdBytes} UTF-8 bytes.`,
    });
  }
});

export const persistedCheckpointIdSchema = checkpointIdSchema.superRefine(
  (checkpointId, context) => {
    const bytes = encodeUtf8(checkpointId);

    if (bytes === undefined) {
      context.addIssue({
        code: "custom",
        message: "Persisted Checkpoint IDs must contain well-formed Unicode.",
      });
      return;
    }

    if (bytes.length > maxPersistedCheckpointIdBytes) {
      context.addIssue({
        code: "custom",
        message: `Persisted Checkpoint IDs must not exceed ${maxPersistedCheckpointIdBytes} UTF-8 bytes.`,
      });
    }
  },
);

export const sessionManifestSchema = z.strictObject({
  formatVersion: persistenceFormatVersionSchema,
  sessionId: persistedSessionIdSchema,
  status: sessionStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  lastEventSequence: z.int().min(0),
});

export const persistedMessageRecordSchema = chatMessageSchema;

const genericPersistedEventPayloadSchema = z.strictObject({
  type: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/),
  data: jsonValueSchema,
});

export const persistedReasoningEventPayloadSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("session.reasoning-start"),
    data: reasoningBlockStartDataSchema,
  }),
  z.strictObject({
    type: z.literal("session.reasoning-delta"),
    data: reasoningDeltaDataSchema,
  }),
  z.strictObject({
    type: z.literal("session.reasoning-end"),
    data: reasoningEndDataSchema,
  }),
  z.strictObject({
    type: z.literal("session.reasoning-limit"),
    data: reasoningLimitDataSchema,
  }),
]);

export const persistedMcpToolSourceSchema = z.strictObject({
  serverId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  registryName: toolNameSchema,
  mcpToolName: z.string().min(1).max(65_536),
  generation: z.number().int().positive(),
});

export const persistedMcpToolEventPayloadSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("session.mcp-tool-call"),
      data: z.strictObject({ call: toolCallSchema, source: persistedMcpToolSourceSchema }),
    }),
    z.strictObject({
      type: z.literal("session.mcp-tool-result"),
      data: z.strictObject({ result: toolResultSchema, source: persistedMcpToolSourceSchema }),
    }),
  ])
  .superRefine((payload, context) => {
    const toolName =
      payload.type === "session.mcp-tool-call" ? payload.data.call.name : payload.data.result.name;
    if (payload.data.source.registryName !== toolName) {
      context.addIssue({
        code: "custom",
        path: ["data", "source", "registryName"],
        message: "Persisted MCP source must match the correlated Tool name.",
      });
    }
  });

export const persistedMcpResourceEventPayloadSchema = z.strictObject({
  type: z.literal("session.mcp-resource-attached"),
  data: mcpResourceAttachmentSchema,
});
export const persistedMcpPromptEventPayloadSchema = z.strictObject({
  type: z.literal("session.mcp-prompt-confirmed"),
  data: mcpPromptConfirmationSchema,
});
export const persistedUsageEventPayloadSchema = z.strictObject({
  type: z.literal("session.usage"),
  data: tokenUsageSchema,
});

const persistedReasoningEventTypes = new Set([
  "session.reasoning-start",
  "session.reasoning-delta",
  "session.reasoning-end",
  "session.reasoning-limit",
]);
const persistedMcpToolEventTypes = new Set(["session.mcp-tool-call", "session.mcp-tool-result"]);
const persistedMcpResourceEventTypes = new Set(["session.mcp-resource-attached"]);
const persistedMcpPromptEventTypes = new Set(["session.mcp-prompt-confirmed"]);
const persistedUsageEventTypes = new Set(["session.usage"]);

export const persistedEventPayloadSchema = genericPersistedEventPayloadSchema.superRefine(
  (payload, context) => {
    if (
      persistedMcpPromptEventTypes.has(payload.type) &&
      !persistedMcpPromptEventPayloadSchema.safeParse(payload).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Persisted MCP Prompt events must match their strict version 1 schema.",
      });
    }
    if (
      persistedReasoningEventTypes.has(payload.type) &&
      !persistedReasoningEventPayloadSchema.safeParse(payload).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Persisted reasoning events must match their strict version 1 schema.",
      });
    }
    if (
      persistedMcpResourceEventTypes.has(payload.type) &&
      !persistedMcpResourceEventPayloadSchema.safeParse(payload).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Persisted MCP Resource events must match their strict version 1 schema.",
      });
    }
    if (
      persistedMcpToolEventTypes.has(payload.type) &&
      !persistedMcpToolEventPayloadSchema.safeParse(payload).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Persisted MCP Tool events must match their strict version 1 schema.",
      });
    }
    if (
      persistedUsageEventTypes.has(payload.type) &&
      !persistedUsageEventPayloadSchema.safeParse(payload).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Persisted Usage events must match their strict version 1 schema.",
      });
    }
  },
);

export const persistedEventRecordSchema = z.strictObject({
  sequence: z.int().positive(),
  recordedAt: z.iso.datetime({ offset: true }),
  event: persistedEventPayloadSchema,
});

export type SessionManifest = z.infer<typeof sessionManifestSchema>;
export type PersistedMessageRecord = z.infer<typeof persistedMessageRecordSchema>;
export type PersistedEventPayload = z.infer<typeof persistedEventPayloadSchema>;
export type PersistedReasoningEventPayload = z.infer<typeof persistedReasoningEventPayloadSchema>;
export type PersistedMcpToolSource = z.infer<typeof persistedMcpToolSourceSchema>;
export type PersistedMcpToolEventPayload = z.infer<typeof persistedMcpToolEventPayloadSchema>;
export type PersistedMcpResourceEventPayload = z.infer<
  typeof persistedMcpResourceEventPayloadSchema
>;
export type PersistedMcpPromptEventPayload = z.infer<typeof persistedMcpPromptEventPayloadSchema>;
export type PersistedUsageEventPayload = z.infer<typeof persistedUsageEventPayloadSchema>;
export type PersistedEventRecord = z.infer<typeof persistedEventRecordSchema>;

export interface SessionPersistencePaths {
  readonly directory: readonly [
    typeof persistenceSessionsDirectory,
    typeof persistenceFormatDirectory,
    string,
  ];
  readonly manifest: readonly [
    typeof persistenceSessionsDirectory,
    typeof persistenceFormatDirectory,
    string,
    typeof sessionManifestFileName,
  ];
  readonly messages: readonly [
    typeof persistenceSessionsDirectory,
    typeof persistenceFormatDirectory,
    string,
    typeof sessionMessagesFileName,
  ];
  readonly events: readonly [
    typeof persistenceSessionsDirectory,
    typeof persistenceFormatDirectory,
    string,
    typeof sessionEventsFileName,
  ];
}

export interface CheckpointPersistencePaths {
  readonly directory: readonly [
    typeof persistenceCheckpointsDirectory,
    typeof persistenceFormatDirectory,
  ];
  readonly checkpoint: readonly [
    typeof persistenceCheckpointsDirectory,
    typeof persistenceFormatDirectory,
    string,
  ];
}

export function getSessionPersistencePaths(sessionId: unknown): SessionPersistencePaths {
  const parsedSessionId = persistedSessionIdSchema.parse(sessionId);
  const encodedSessionId = toLowercaseHex(encodeUtf8(parsedSessionId) ?? []);
  const directory = [
    persistenceSessionsDirectory,
    persistenceFormatDirectory,
    encodedSessionId,
  ] as const;

  return {
    directory,
    manifest: [...directory, sessionManifestFileName],
    messages: [...directory, sessionMessagesFileName],
    events: [...directory, sessionEventsFileName],
  };
}

export function getCheckpointPersistencePaths(checkpointId: unknown): CheckpointPersistencePaths {
  const parsedCheckpointId = persistedCheckpointIdSchema.parse(checkpointId);
  const encodedCheckpointId = toLowercaseHex(encodeUtf8(parsedCheckpointId) ?? []);
  const directory = [persistenceCheckpointsDirectory, persistenceFormatDirectory] as const;

  return {
    directory,
    checkpoint: [...directory, `${encodedCheckpointId}.json`],
  };
}

function encodeUtf8(value: string): readonly number[] | undefined {
  const bytes: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const firstCodeUnit = value.charCodeAt(index);
    let codePoint = firstCodeUnit;

    if (firstCodeUnit >= 0xd800 && firstCodeUnit <= 0xdbff) {
      const secondCodeUnit = value.charCodeAt(index + 1);
      if (!(secondCodeUnit >= 0xdc00 && secondCodeUnit <= 0xdfff)) {
        return undefined;
      }

      codePoint = 0x10000 + ((firstCodeUnit - 0xd800) << 10) + (secondCodeUnit - 0xdc00);
      index += 1;
    } else if (firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff) {
      return undefined;
    }

    appendUtf8CodePoint(bytes, codePoint);
  }

  return bytes;
}

function appendUtf8CodePoint(bytes: number[], codePoint: number): void {
  if (codePoint <= 0x7f) {
    bytes.push(codePoint);
  } else if (codePoint <= 0x7ff) {
    bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
  } else if (codePoint <= 0xffff) {
    bytes.push(
      0xe0 | (codePoint >> 12),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
  } else {
    bytes.push(
      0xf0 | (codePoint >> 18),
      0x80 | ((codePoint >> 12) & 0x3f),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
  }
}

function toLowercaseHex(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
