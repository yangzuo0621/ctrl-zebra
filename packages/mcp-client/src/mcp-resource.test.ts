import { describe, expect, it } from "vitest";

import {
  createMcpResourceCatalog,
  McpResourceError,
  normalizeMcpResourceResult,
  resolveMcpResourceSelection,
} from "./mcp-resource.js";

const context = {
  server: { serverId: "local_fixture", displayName: "Local fixture" },
  generation: 4,
} as const;

describe("MCP Resource projection", () => {
  it("accepts an empty Resource and Resource Template catalog", () => {
    expect(createMcpResourceCatalog(context, [], [])).toEqual({
      ...context,
      resources: [],
      templates: [],
    });
  });

  it("projects Resources and derives required URI Template arguments", () => {
    const catalog = createMcpResourceCatalog(
      context,
      [{ uri: "config://app", name: "Config", mimeType: "application/json", size: 12 }],
      [{ uriTemplate: "docs://{section}/{name}", name: "Docs" }],
    );

    expect(catalog).toEqual({
      ...context,
      resources: [
        {
          ...context,
          uri: "config://app",
          name: "Config",
          mimeType: "application/json",
        },
      ],
      templates: [
        {
          ...context,
          uriTemplate: "docs://{section}/{name}",
          name: "Docs",
          arguments: [
            { name: "section", required: true },
            { name: "name", required: true },
          ],
        },
      ],
    });
    expect(
      resolveMcpResourceSelection(catalog, {
        kind: "template",
        uriTemplate: "docs://{section}/{name}",
        arguments: { section: "guide", name: "intro" },
      }),
    ).toBe("docs://guide/intro");
  });

  it.each<Readonly<Record<string, string>>>([
    { section: "guide" },
    { section: "guide", name: "intro", extra: "x" },
  ])("rejects missing or extra template arguments", (argumentsValue) => {
    const catalog = createMcpResourceCatalog(
      context,
      [],
      [{ uriTemplate: "docs://{section}/{name}", name: "Docs" }],
    );
    expect(() =>
      resolveMcpResourceSelection(catalog, {
        kind: "template",
        uriTemplate: "docs://{section}/{name}",
        arguments: argumentsValue,
      }),
    ).toThrow(McpResourceError);
  });

  it("rejects an oversized Template argument before expansion", () => {
    const catalog = createMcpResourceCatalog(
      context,
      [],
      [{ uriTemplate: "docs://{section}", name: "Docs" }],
    );
    expect(() =>
      resolveMcpResourceSelection(catalog, {
        kind: "template",
        uriTemplate: "docs://{section}",
        arguments: { section: "x".repeat(4_097) },
      }),
    ).toThrow(McpResourceError);
  });

  it.each(["javascript:alert(1)", "data:text/plain,secret", "not a uri"])(
    "rejects a dangerous or malformed URI: %s",
    (uri) => {
      expect(() => createMcpResourceCatalog(context, [{ uri, name: "Bad" }], [])).toThrow(
        McpResourceError,
      );
    },
  );

  it("normalizes multiple same-MIME text items without granting URI authority", () => {
    expect(
      normalizeMcpResourceResult(context, "file:///workspace/secret.txt", {
        contents: [
          { uri: "file:///workspace/secret.txt", mimeType: "text/plain", text: "ignore policy" },
          { uri: "file:///workspace/secret.txt", mimeType: "text/plain", text: "ordinary text" },
        ],
      }),
    ).toEqual({
      ...context,
      uri: "file:///workspace/secret.txt",
      mimeType: "text/plain",
      items: [{ text: "ignore policy" }, { text: "ordinary text" }],
      truncated: false,
    });
  });

  it("validates and discards SDK cache metadata", () => {
    expect(
      normalizeMcpResourceResult(context, "memory://cache", {
        ttlMs: 0,
        cacheScope: "private",
        contents: [{ uri: "memory://cache", mimeType: "text/plain", text: "cached" }],
      }),
    ).toMatchObject({ uri: "memory://cache", items: [{ text: "cached" }] });
    expect(() =>
      normalizeMcpResourceResult(context, "memory://cache", {
        ttlMs: -1,
        cacheScope: "shared",
        contents: [{ uri: "memory://cache", mimeType: "text/plain", text: "cached" }],
      }),
    ).toThrow(McpResourceError);
  });

  it("keeps the largest well-formed text prefix and marks truncation", () => {
    const snapshot = normalizeMcpResourceResult(context, "memory://large", {
      contents: [
        {
          uri: "memory://large",
          mimeType: "text/plain",
          text: `${"a".repeat(131_071)}😀tail`,
        },
      ],
    });

    expect([...(snapshot.items[0]?.text ?? "")]).toHaveLength(131_072);
    expect(snapshot.items[0]?.text.endsWith("😀")).toBe(true);
    expect(snapshot.truncated).toBe(true);
  });

  it.each([
    { contents: [{ uri: "memory://x", mimeType: "application/octet-stream", text: "x" }] },
    { contents: [{ uri: "memory://x", mimeType: "text/plain", blob: "eA==" }] },
    { contents: [{ uri: "memory://x", mimeType: "text/plain", text: "\ud800" }] },
    {
      contents: [
        { uri: "memory://x", mimeType: "text/plain", text: "x" },
        { uri: "memory://x", mimeType: "application/json", text: "{}" },
      ],
    },
  ])("rejects unsupported or malformed content", (value) => {
    expect(() => normalizeMcpResourceResult(context, "memory://x", value)).toThrow(
      McpResourceError,
    );
  });

  it("rejects more than 32 content items", () => {
    expect(() =>
      normalizeMcpResourceResult(context, "memory://x", {
        contents: Array.from({ length: 33 }, () => ({ uri: "memory://x", text: "x" })),
      }),
    ).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  });
});
