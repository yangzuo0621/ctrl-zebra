import { describe, expect, it } from "vitest";

import { collectMcpCatalogPages, McpCatalogCollectionError } from "./mcp-catalog-collector.js";
import { McpCatalogRefresh } from "./mcp-catalog-refresh.js";

describe("MCP catalog primitives", () => {
  it("collects bounded pages and forwards each cursor exactly once", async () => {
    const cursors: (string | undefined)[] = [];
    const values = await collectMcpCatalogPages<{ name: string }>({
      field: "tools",
      signal: new AbortController().signal,
      request: async (cursor) => {
        cursors.push(cursor);
        return cursor === undefined
          ? { tools: [{ name: "first" }], nextCursor: "next" }
          : { tools: [{ name: "second" }] };
      },
    });

    expect(values).toEqual([{ name: "first" }, { name: "second" }]);
    expect(cursors).toEqual([undefined, "next"]);
  });

  it("rejects duplicate cursors, malformed pages, and bounded overflow", async () => {
    const signal = new AbortController().signal;
    await expect(
      collectMcpCatalogPages({
        field: "tools",
        signal,
        request: async (cursor) =>
          cursor === undefined
            ? { tools: [], nextCursor: "repeat" }
            : { tools: [], nextCursor: "repeat" },
      }),
    ).rejects.toMatchObject({ code: "malformed-message" });

    await expect(
      collectMcpCatalogPages({ field: "tools", signal, request: async () => ({}) }),
    ).rejects.toMatchObject({ code: "malformed-message" });

    await expect(
      collectMcpCatalogPages({
        field: "tools",
        signal,
        maxPages: 1,
        request: async () => ({ tools: [], nextCursor: "still-paging" }),
      }),
    ).rejects.toMatchObject({ code: "limit-exceeded" });

    await expect(
      collectMcpCatalogPages({
        field: "tools",
        signal,
        maxEntries: 1,
        request: async () => ({ tools: [{ name: "one" }, { name: "two" }] }),
      }),
    ).rejects.toBeInstanceOf(McpCatalogCollectionError);
  });

  it("coalesces refresh requests and commits only complete values", async () => {
    const pending: Array<() => void> = [];
    let loads = 0;
    const refresh = new McpCatalogRefresh<string, string>({
      sameContext: (current, next) => current === next,
      isActive: () => true,
      createUnavailableError: () => new Error("unavailable"),
      clearReason: "generation ended",
      load: async () => {
        loads += 1;
        await new Promise<void>((resolve) => pending.push(resolve));
        return `value-${loads}`;
      },
    });
    refresh.setContext("generation-1");

    const first = refresh.request();
    const second = refresh.request();
    expect(second).toBe(first);
    await waitFor(() => pending.length === 1);
    pending.shift()?.();
    await waitFor(() => pending.length === 1);
    pending.shift()?.();

    await expect(first).resolves.toBe("value-2");
    expect(refresh.getState().value).toBe("value-2");
  });

  it("fences a completion after the context is cleared", async () => {
    let finish: (() => void) | undefined;
    const refresh = new McpCatalogRefresh<string, string>({
      sameContext: (current, next) => current === next,
      isActive: () => true,
      createUnavailableError: () => new Error("unavailable"),
      clearReason: "generation ended",
      load: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return "late";
      },
    });
    refresh.setContext("generation-1");
    const request = refresh.request();
    refresh.clear();
    finish?.();

    await expect(request).rejects.toMatchObject({ message: "generation ended" });
    expect(refresh.getState().value).toBeUndefined();
  });

  it("clears the prior value through the owner callback", async () => {
    let cleared: string | undefined;
    const refresh = new McpCatalogRefresh<string, string>({
      sameContext: (current, next) => current === next,
      isActive: () => true,
      createUnavailableError: () => new Error("unavailable"),
      clearReason: "generation ended",
      clearValue: (value) => {
        cleared = value;
      },
      load: async () => "stable",
    });
    refresh.setContext("generation-1");
    await refresh.request();
    refresh.clear();
    expect(cleared).toBe("stable");
    expect(refresh.getState().value).toBeUndefined();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Condition was not reached.");
}
