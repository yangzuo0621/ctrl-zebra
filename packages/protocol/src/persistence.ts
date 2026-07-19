import { z } from "zod";

import { chatMessageSchema } from "./chat-message.js";
import { sessionIdSchema, sessionStatusSchema } from "./session.js";
import { jsonValueSchema } from "./tool.js";

export const persistenceFormatVersion = 1 as const;
export const persistenceSessionsDirectory = "sessions" as const;
export const persistenceFormatDirectory = `v${persistenceFormatVersion}` as const;
export const sessionManifestFileName = "manifest.json" as const;
export const sessionMessagesFileName = "messages.jsonl" as const;
export const sessionEventsFileName = "events.jsonl" as const;
export const maxPersistedSessionIdBytes = 100;

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

export const sessionManifestSchema = z.strictObject({
  formatVersion: persistenceFormatVersionSchema,
  sessionId: persistedSessionIdSchema,
  status: sessionStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  lastEventSequence: z.int().min(0),
});

export const persistedMessageRecordSchema = chatMessageSchema;

export const persistedEventPayloadSchema = z.strictObject({
  type: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/),
  data: jsonValueSchema,
});

export const persistedEventRecordSchema = z.strictObject({
  sequence: z.int().positive(),
  recordedAt: z.iso.datetime({ offset: true }),
  event: persistedEventPayloadSchema,
});

export type SessionManifest = z.infer<typeof sessionManifestSchema>;
export type PersistedMessageRecord = z.infer<typeof persistedMessageRecordSchema>;
export type PersistedEventPayload = z.infer<typeof persistedEventPayloadSchema>;
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
