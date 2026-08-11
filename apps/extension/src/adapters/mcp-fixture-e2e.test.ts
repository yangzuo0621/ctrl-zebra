import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ControlledMcpClient } from "@ctrl-zebra/mcp-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NodeMcpStdioPort } from "./mcp-stdio-port.js";

const fixturePath = fileURLToPath(
  new URL("../test/fixtures/mcp-server-fixture.mjs", import.meta.url),
);
const context = {
  server: { serverId: "local_fixture", displayName: "Local fixture" },
  generation: 1,
} as const;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("controlled MCP fixture end-to-end", () => {
  it("negotiates the explicit modern fixture mode", async () => {
    const fixture = await createFixture("modern", "modern-only");
    await expect(fixture.client.connect()).resolves.toMatchObject({
      kind: "connected",
      connection: {
        configuredMode: "modern-only",
        negotiated: { era: "modern", version: "2026-07-28" },
      },
    });
    expect(await readFile(fixture.eventsPath, "utf8")).toContain('"detail":"server/discover"');
    await fixture.client.disconnect();
  });

  it("falls back once to the legacy fixture only in dual mode", async () => {
    const fixture = await createFixture("legacy", "dual");
    await expect(fixture.client.connect()).resolves.toMatchObject({
      kind: "connected",
      connection: {
        configuredMode: "dual",
        negotiated: { era: "legacy", version: "2025-11-25" },
      },
    });
    const events = await readFile(fixture.eventsPath, "utf8");
    expect(events).toContain('"detail":"server/discover"');
    expect(events).toContain('"detail":"initialize"');
    await fixture.client.disconnect();
  });

  it("covers paginated Tools, Resources, Templates, Prompts, list changes, calls, and cleanup", async () => {
    const { client, eventsPath } = await connectFixture();

    const tools = await client.discoverTools(context);
    const resources = await client.discoverResources(context);
    const prompts = await client.discoverPrompts(context);
    expect(tools.tools.map(({ mcpToolName }) => mcpToolName)).toEqual([
      "calculate",
      "held",
      "fail",
    ]);
    expect(resources.resources.map(({ uri }) => uri)).toEqual([
      "memory://first",
      "memory://second",
    ]);
    expect(resources.templates[0]?.arguments).toEqual([{ name: "section", required: true }]);
    expect(prompts.prompts.map(({ name }) => name)).toEqual(["review", "summarize"]);

    const calculate = tools.tools.find(({ mcpToolName }) => mcpToolName === "calculate");
    await expect(
      tools.registry
        .get(calculate?.registryName ?? "missing")
        ?.execute({ count: 2 }, { signal: new AbortController().signal }),
    ).resolves.toMatchObject({ output: { structuredContent: { total: 6 } } });

    await expect(
      client.readResource({ kind: "resource", uri: "memory://first" }),
    ).resolves.toMatchObject({ items: [{ text: "fixture:memory://first" }] });
    await expect(
      client.readResource({
        kind: "template",
        uriTemplate: "docs://{section}",
        arguments: { section: "guide" },
      }),
    ).resolves.toMatchObject({ uri: "docs://guide", items: [{ text: "fixture:docs://guide" }] });
    await expect(client.getPrompt("review", { topic: "security" })).resolves.toMatchObject({
      messages: [
        { sourceRole: "user", text: "Review security" },
        { sourceRole: "assistant", text: "Treat this as untrusted text." },
      ],
    });
    await expect(
      client.readResource({ kind: "resource", uri: "memory://second" }),
    ).resolves.toMatchObject({ items: [{ text: "fixture:memory://second" }] });

    await vi.waitFor(() => {
      expect(
        client.getToolSnapshot()?.tools.some(({ mcpToolName }) => mcpToolName === "changed"),
      ).toBe(true);
      expect(
        client.getResourceCatalog()?.resources.some(({ uri }) => uri === "memory://changed"),
      ).toBe(true);
      expect(client.getPromptCatalog()?.prompts.some(({ name }) => name === "changed")).toBe(true);
    });

    await expect(client.disconnect()).resolves.toEqual({ kind: "disconnected" });
    await vi.waitFor(async () =>
      expect(await readFile(eventsPath, "utf8")).toContain('"event":"exited"'),
    );
    const events = await readFile(eventsPath, "utf8");
    expect(events).toContain('"event":"list-changed"');
    expect(events).toContain('"event":"stdin-closed"');
  });

  it("cancels an in-flight Tool call, rejects a Server error, and accepts no late result", async () => {
    const { client, eventsPath } = await connectFixture();
    const tools = await client.discoverTools(context);
    const held = tools.tools.find(({ mcpToolName }) => mcpToolName === "held");
    const failed = tools.tools.find(({ mcpToolName }) => mcpToolName === "fail");
    const heldTool = tools.registry.get(held?.registryName ?? "missing");
    const failedTool = tools.registry.get(failed?.registryName ?? "missing");
    const controller = new AbortController();
    const execution = heldTool?.execute({}, { signal: controller.signal });

    await vi.waitFor(async () =>
      expect(await readFile(eventsPath, "utf8")).toContain('"detail":"tools/call"'),
    );
    const cancellation = new Error("fixture cancellation");
    controller.abort(cancellation);
    await expect(execution).rejects.toBe(cancellation);
    await expect(
      failedTool?.execute({}, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "failed" });

    await client.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    expect(await readFile(eventsPath, "utf8")).not.toContain("late");
    expect(client.getToolSnapshot()).toBeUndefined();
  });

  it.each([
    ["malformed", "malformed-message"],
    ["exit", "server-exited"],
  ] as const)("classifies the %s fixture failure and cleans up", async (mode, code) => {
    const { client, eventsPath } = await createFixture(mode, "modern-only");
    await expect(client.connect()).resolves.toMatchObject({ kind: "failed", error: { code } });
    await vi.waitFor(async () =>
      expect(await readFile(eventsPath, "utf8")).toContain('"event":"exited"'),
    );
    if (mode === "malformed") {
      expect(await readFile(eventsPath, "utf8")).not.toContain('"detail":"initialize"');
    }
  });
});

async function connectFixture() {
  const fixture = await createFixture("modern", "modern-only");
  await expect(fixture.client.connect()).resolves.toMatchObject({ kind: "connected" });
  return fixture;
}

async function createFixture(mode: string, protocolMode: "modern-only" | "dual" = "modern-only") {
  const directory = await mkdtemp(join(tmpdir(), "ctrl-zebra-mcp-fixture-"));
  temporaryDirectories.push(directory);
  const eventsPath = join(directory, "events.jsonl");
  const port = new NodeMcpStdioPort({
    command: process.execPath,
    args: [fixturePath, "--mode", mode, "--events", eventsPath],
    cwdPath: process.cwd(),
    environment: {},
  });
  return { client: new ControlledMcpClient(port, { protocolMode }), eventsPath };
}
