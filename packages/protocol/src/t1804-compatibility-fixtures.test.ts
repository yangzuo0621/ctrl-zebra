import { describe, expect, it } from "vitest";

import {
  mcpDiagnosticsProjectionSchema,
  mcpErrorSchema,
  mcpNegotiatedConnectionSchema,
  mcpNegotiatedProvenanceSchema,
  mcpNegotiatedSchema,
  mcpProtocolModeSchema,
} from "./mcp-connection.js";

const server = { serverId: "fixture_server", displayName: "Deterministic fixture" } as const;
const unavailableCapabilities = {
  tools: false,
  toolsListChanged: false,
  resources: false,
  resourceTemplates: false,
  resourcesListChanged: false,
  prompts: false,
  promptsListChanged: false,
} as const;
const modernCapabilities = {
  tools: true,
  toolsListChanged: false,
  resources: false,
  resourceTemplates: false,
  resourcesListChanged: false,
  prompts: false,
  promptsListChanged: false,
} as const;

describe("T1804 compatibility fixtures", () => {
  it("accepts only the closed protocol modes and negotiated era/version pairs", () => {
    expect(mcpProtocolModeSchema.safeParse("modern-only").success).toBe(true);
    expect(mcpProtocolModeSchema.safeParse("dual").success).toBe(true);
    expect(mcpProtocolModeSchema.safeParse("future").success).toBe(false);
    expect(mcpNegotiatedSchema.parse({ era: "modern", version: "2026-07-28" })).toEqual({
      era: "modern",
      version: "2026-07-28",
    });
    expect(mcpNegotiatedSchema.parse({ era: "legacy", version: "2025-11-25" })).toEqual({
      era: "legacy",
      version: "2025-11-25",
    });
    expect(mcpNegotiatedSchema.safeParse({ era: "modern", version: "2025-11-25" }).success).toBe(
      false,
    );
    expect(mcpNegotiatedSchema.safeParse({ era: "legacy", version: "2026-07-28" }).success).toBe(
      false,
    );
    expect(
      mcpNegotiatedSchema.safeParse({ era: "modern", version: "2026-07-28", extra: true }).success,
    ).toBe(false);
  });

  it("enforces modern-only provenance and permits legacy only in dual", () => {
    expect(
      mcpNegotiatedProvenanceSchema.parse({
        configuredMode: "modern-only",
        negotiatedEra: "modern",
        negotiatedVersion: "2026-07-28",
      }),
    ).toEqual({
      configuredMode: "modern-only",
      negotiatedEra: "modern",
      negotiatedVersion: "2026-07-28",
    });
    expect(
      mcpNegotiatedProvenanceSchema.parse({
        configuredMode: "dual",
        negotiatedEra: "legacy",
        negotiatedVersion: "2025-11-25",
      }),
    ).toEqual({
      configuredMode: "dual",
      negotiatedEra: "legacy",
      negotiatedVersion: "2025-11-25",
    });
    expect(
      mcpNegotiatedProvenanceSchema.safeParse({
        configuredMode: "modern-only",
        negotiatedEra: "legacy",
        negotiatedVersion: "2025-11-25",
      }).success,
    ).toBe(false);
    expect(
      mcpNegotiatedProvenanceSchema.safeParse({
        configuredMode: "dual",
        negotiatedEra: "legacy",
        negotiatedVersion: "2025-11-25",
        secret: "never-persist",
      }).success,
    ).toBe(false);
  });

  it("accepts valid state combinations and rejects illegal negotiated projections", () => {
    const base = {
      server,
      generation: 1,
      configuredMode: "modern-only" as const,
      configurationStale: false,
    };
    expect(
      mcpNegotiatedConnectionSchema.parse({
        ...base,
        status: "disconnected",
        capabilities: unavailableCapabilities,
      }),
    ).toMatchObject({ status: "disconnected", configuredMode: "modern-only" });
    expect(
      mcpNegotiatedConnectionSchema.parse({
        ...base,
        status: "connected",
        negotiated: { era: "modern", version: "2026-07-28" },
        capabilities: modernCapabilities,
      }),
    ).toMatchObject({ status: "connected", negotiated: { era: "modern" } });
    expect(
      mcpNegotiatedConnectionSchema.parse({
        ...base,
        status: "failed",
        capabilities: unavailableCapabilities,
        error: { code: "protocol-incompatible", message: "Protocol version is unsupported." },
      }),
    ).toMatchObject({ status: "failed", error: { code: "protocol-incompatible" } });
    expect(
      mcpNegotiatedConnectionSchema.safeParse({
        ...base,
        status: "connected",
        capabilities: modernCapabilities,
      }).success,
    ).toBe(false);
    expect(
      mcpNegotiatedConnectionSchema.safeParse({
        ...base,
        status: "connected",
        negotiated: { era: "legacy", version: "2025-11-25" },
        capabilities: modernCapabilities,
      }).success,
    ).toBe(false);
    expect(
      mcpNegotiatedConnectionSchema.safeParse({
        ...base,
        status: "failed",
        capabilities: { ...unavailableCapabilities, tools: true },
        error: { code: "connect-failed", message: "Connection failed." },
      }).success,
    ).toBe(false);
    expect(
      mcpNegotiatedConnectionSchema.safeParse({
        ...base,
        status: "disconnected",
        capabilities: unavailableCapabilities,
        negotiated: { era: "modern", version: "2026-07-28" },
      }).success,
    ).toBe(false);
    expect(
      mcpNegotiatedConnectionSchema.parse({
        generation: 0,
        status: "disconnected",
        configuredMode: "modern-only",
        configurationStale: false,
        capabilities: unavailableCapabilities,
      }),
    ).toMatchObject({ status: "disconnected", generation: 0 });
    expect(
      mcpNegotiatedConnectionSchema.parse({
        generation: 0,
        status: "failed",
        configuredMode: "modern-only",
        configurationStale: false,
        capabilities: unavailableCapabilities,
        error: { code: "configuration-invalid", message: "Configure one valid MCP Server." },
      }),
    ).toMatchObject({ status: "failed", generation: 0 });
  });

  it("keeps stable errors closed and bounded", () => {
    expect(
      mcpErrorSchema.parse({ code: "protocol-incompatible", message: "Unsupported version." }),
    ).toEqual({ code: "protocol-incompatible", message: "Unsupported version." });
    expect(mcpErrorSchema.safeParse({ code: "future-error", message: "ignored" }).success).toBe(
      false,
    );
    expect(
      mcpErrorSchema.safeParse({ code: "malformed-message", message: "x".repeat(1_025) }).success,
    ).toBe(false);
    expect(
      mcpErrorSchema.safeParse({
        code: "malformed-message",
        message: "Malformed response.",
        raw: "never-crosses-boundary",
      }).success,
    ).toBe(false);
  });

  it("projects closed recovery facts for each configured mode", () => {
    const modern = mcpDiagnosticsProjectionSchema.parse({
      kind: "protocol-incompatible",
      server,
      generation: 1,
      connectionStatus: "failed",
      configuredMode: "modern-only",
      supportedVersions: ["2026-07-28"],
      connectionEstablished: false,
      nextStep: "open-settings",
    });
    expect(modern).toMatchObject({
      configuredMode: "modern-only",
      supportedVersions: ["2026-07-28"],
    });

    const dual = mcpDiagnosticsProjectionSchema.parse({
      kind: "protocol-incompatible",
      server,
      generation: 1,
      connectionStatus: "failed",
      configuredMode: "dual",
      supportedVersions: ["2026-07-28", "2025-11-25"],
      connectionEstablished: false,
      nextStep: "open-settings",
    });
    expect(dual).toMatchObject({
      configuredMode: "dual",
      supportedVersions: ["2026-07-28", "2025-11-25"],
    });

    expect(
      mcpDiagnosticsProjectionSchema.safeParse({
        kind: "protocol-incompatible",
        server,
        generation: 1,
        connectionStatus: "failed",
        configuredMode: "dual",
        supportedVersions: ["2026-07-28"],
        connectionEstablished: false,
        nextStep: "open-settings",
      }).success,
    ).toBe(false);
    expect(
      mcpDiagnosticsProjectionSchema.safeParse({
        kind: "protocol-incompatible",
        server,
        generation: 1,
        connectionStatus: "failed",
        configuredMode: "dual",
        supportedVersions: ["2026-07-28", "2025-11-25"],
        connectionEstablished: false,
        nextStep: "open-settings",
        fallbackAttempted: true,
      }).success,
    ).toBe(false);
  });
});
