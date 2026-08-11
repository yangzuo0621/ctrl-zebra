import { describe, expect, it } from "vitest";

import {
  McpServerConfigurationError,
  parseMcpServerConfiguration,
  readMcpServerConfiguration,
} from "./mcp-server-configuration.js";

const validConfiguration = {
  version: 1,
  serverId: "local_fixture",
  displayName: "Local fixture",
  command: "node",
  args: ["server.mjs", "--stdio"],
} as const;
const validDualConfiguration = {
  version: 2,
  protocolMode: "dual",
  serverId: "local_fixture",
  displayName: "Local fixture",
  command: "node",
  args: ["server.mjs", "--stdio"],
} as const;

describe("MCP Server configuration", () => {
  it("reads and freezes version 1 as effective modern-only without rewriting the setting", () => {
    const configuration = readMcpServerConfiguration({
      inspect: () => ({ globalValue: validConfiguration }),
    });

    expect(configuration).toEqual({ ...validConfiguration, protocolMode: "modern-only" });
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.args)).toBe(true);
  });

  it.each([
    "modern-only",
    "dual",
  ] as const)("accepts explicit version 2 %s mode", (protocolMode) => {
    const configuration = parseMcpServerConfiguration({
      ...validDualConfiguration,
      protocolMode,
    });

    expect(configuration).toEqual({ ...validDualConfiguration, protocolMode });
    expect(configuration.version).toBe(2);
  });

  it("requires an explicitly configured global value", () => {
    expect(() => readMcpServerConfiguration({ inspect: () => undefined })).toThrowError(
      expect.objectContaining({ code: "configuration-missing" }),
    );
  });

  it.each([
    ["workspace", { globalValue: validConfiguration, workspaceValue: validConfiguration }],
    ["folder", { globalValue: validConfiguration, workspaceFolderValue: validConfiguration }],
    ["language", { globalValue: validConfiguration, globalLanguageValue: validConfiguration }],
  ])("rejects a %s override instead of merging it", (_name, inspected) => {
    expect(() => readMcpServerConfiguration({ inspect: () => inspected })).toThrowError(
      expect.objectContaining({ code: "configuration-scope-invalid" }),
    );
  });

  it.each([
    ["unknown field", { ...validConfiguration, cwd: "." }],
    ["unknown version", { ...validConfiguration, version: 2 }],
    ["version 1 mode field", { ...validConfiguration, protocolMode: "modern-only" }],
    ["version 2 missing mode", { ...validDualConfiguration, protocolMode: undefined }],
    ["unknown mode", { ...validDualConfiguration, protocolMode: "future" }],
    ["version 2 unknown field", { ...validDualConfiguration, extra: true }],
    ["invalid identity", { ...validConfiguration, serverId: "Local-Server" }],
    ["empty display name", { ...validConfiguration, displayName: "" }],
    [
      "unpaired surrogate",
      { ...validConfiguration, displayName: `bad${String.fromCharCode(0xd800)}` },
    ],
    ["command line", { ...validConfiguration, command: "node\nother" }],
    ["NUL argument", { ...validConfiguration, args: ["bad\0argument"] }],
    ["credential argument", { ...validConfiguration, args: ["--api-key=test-secret"] }],
    ["too many arguments", { ...validConfiguration, args: Array(65).fill("x") }],
    ["oversized argument", { ...validConfiguration, args: ["x".repeat(4_097)] }],
    ["oversized argument list", { ...validConfiguration, args: Array(9).fill("x".repeat(4_000)) }],
  ])("rejects %s with a safe fixed error", (_name, value) => {
    let failure: unknown;
    try {
      parseMcpServerConfiguration(value);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(McpServerConfigurationError);
    expect(failure).toMatchObject({ code: "configuration-invalid" });
    expect(String(failure)).toBe(
      "McpServerConfigurationError: The MCP Server configuration is invalid.",
    );
    expect(String(failure)).not.toContain("test-secret");
  });

  it("rejects accessor properties without invoking them", () => {
    const value = Object.defineProperty({ ...validConfiguration }, "command", {
      enumerable: true,
      get() {
        throw new Error("getter secret");
      },
    });

    expect(() => parseMcpServerConfiguration(value)).toThrowError(
      expect.objectContaining({ code: "configuration-invalid" }),
    );
  });
});
