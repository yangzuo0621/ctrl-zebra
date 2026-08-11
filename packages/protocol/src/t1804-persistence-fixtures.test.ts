import { describe, expect, it } from "vitest";

import { persistedEventPayloadSchema, persistedMcpProvenanceSchema } from "./persistence.js";

const modernProvenance = {
  configuredMode: "modern-only",
  negotiatedEra: "modern",
  negotiatedVersion: "2026-07-28",
} as const;
const legacyProvenance = {
  configuredMode: "dual",
  negotiatedEra: "legacy",
  negotiatedVersion: "2025-11-25",
} as const;

describe("T1804 persistence provenance fixtures", () => {
  it("accepts bounded modern and legacy provenance on MCP events", () => {
    expect(persistedMcpProvenanceSchema.parse(modernProvenance)).toEqual(modernProvenance);
    expect(persistedMcpProvenanceSchema.parse(legacyProvenance)).toEqual(legacyProvenance);

    expect(
      persistedEventPayloadSchema.parse({
        type: "session.mcp-tool-call",
        data: {
          call: { id: "call-1", name: "mcp_fixture_lookup_123456789abc", input: {} },
          source: {
            serverId: "fixture_server",
            registryName: "mcp_fixture_lookup_123456789abc",
            mcpToolName: "lookup",
            generation: 1,
          },
          provenance: modernProvenance,
        },
      }),
    ).toMatchObject({ type: "session.mcp-tool-call", data: { provenance: modernProvenance } });

    expect(
      persistedEventPayloadSchema.parse({
        type: "session.mcp-resource-attached",
        data: {
          snapshotId: "snapshot-1",
          serverId: "fixture_server",
          uri: "memory://fixture",
          mimeType: "text/plain",
          text: "deterministic fixture",
          truncated: false,
          provenance: legacyProvenance,
        },
      }),
    ).toMatchObject({
      type: "session.mcp-resource-attached",
      data: { provenance: legacyProvenance },
    });

    expect(
      persistedEventPayloadSchema.parse({
        type: "session.mcp-prompt-confirmed",
        data: {
          serverId: "fixture_server",
          promptName: "review",
          projectedText: "deterministic prompt fixture",
          provenance: modernProvenance,
        },
      }),
    ).toMatchObject({
      type: "session.mcp-prompt-confirmed",
      data: { provenance: modernProvenance },
    });
  });

  it("keeps old records readable but rejects invalid provenance and secrets", () => {
    expect(
      persistedEventPayloadSchema.safeParse({
        type: "session.mcp-resource-attached",
        data: {
          snapshotId: "snapshot-legacy",
          serverId: "fixture_server",
          uri: "memory://fixture",
          mimeType: "text/plain",
          text: "old record without provenance",
          truncated: false,
        },
      }).success,
    ).toBe(true);
    expect(
      persistedMcpProvenanceSchema.safeParse({
        configuredMode: "modern-only",
        negotiatedEra: "legacy",
        negotiatedVersion: "2025-11-25",
      }).success,
    ).toBe(false);
    expect(
      persistedEventPayloadSchema.safeParse({
        type: "session.mcp-prompt-confirmed",
        data: {
          serverId: "fixture_server",
          promptName: "review",
          projectedText: "fixture",
          provenance: { ...modernProvenance, apiKey: "never-persist" },
        },
      }).success,
    ).toBe(false);
  });
});
