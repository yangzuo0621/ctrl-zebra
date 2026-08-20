import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { createSearchFilesTool } from "@ctrl-zebra/builtin-tools";
import { InMemorySessionRepository } from "@ctrl-zebra/core";
import { ControlledMcpClient } from "@ctrl-zebra/mcp-client";
import { persistenceFormatVersion } from "@ctrl-zebra/protocol";
import * as vscode from "vscode";

import fixture from "../../../../../scripts/performance-fixtures.json";
import { NodeMcpStdioPort } from "../../adapters/mcp-stdio-port.js";
import { findWorkspaceFiles } from "../../adapters/vscode-workspace-find-files.js";
import {
  joinWorkspacePath,
  readWorkspaceFilePrefix,
} from "../../adapters/vscode-workspace-read-file.js";
import { WorkspaceFileLister } from "../../adapters/workspace-file-lister.js";
import { agentViewId } from "../../agent-view.js";
import { createSessionRecoveryActions } from "../../controllers/session-recovery.js";

interface PerformanceBenchmarkResult {
  readonly schemaVersion: 1;
  readonly fixtureVersion: number;
  readonly metrics: {
    readonly extensionActivationMs: number;
    readonly webviewFirstUsableMs: number;
    readonly sessionRestoreMs: number;
    readonly workspaceSearchMs: number;
    readonly mcpCatalogLoadMs: number;
    readonly steadyStateMemoryBytes: number;
    readonly peakMemoryBytes: number;
  };
  readonly cardinalities: {
    readonly workspaceFiles: number;
    readonly searchMatches: number;
    readonly sessionEvents: number;
    readonly restoredMessages: number;
    readonly mcpTools: number;
    readonly mcpResources: number;
    readonly mcpPrompts: number;
  };
}

export async function verifyPerformanceBenchmark(): Promise<void> {
  if (process.env.CTRL_ZEBRA_PERFORMANCE_BENCHMARK !== "1") {
    return;
  }

  const resultPath = process.env.CTRL_ZEBRA_PERFORMANCE_RESULT;
  const extensionSamplePath = process.env.CTRL_ZEBRA_PERFORMANCE_OUTPUT;
  assert.ok(resultPath, "The performance result path is required.");
  assert.ok(extensionSamplePath, "The extension performance result path is required.");

  const fixtureRoot = await mkdtemp(join(tmpdir(), "ctrl-zebra-performance-workspace-"));
  let peakMemoryBytes = process.memoryUsage().rss;
  try {
    await createWorkspaceFixture(fixtureRoot);
    const extensionSample = await readExtensionSample(extensionSamplePath);
    peakMemoryBytes = Math.max(peakMemoryBytes, extensionSample.memoryBytes);

    await vscode.commands.executeCommand(`${agentViewId}.focus`);
    const displayedSample = await readExtensionSample(extensionSamplePath, true);
    peakMemoryBytes = Math.max(peakMemoryBytes, displayedSample.memoryBytes);

    const session = await measureSessionRestore();
    peakMemoryBytes = Math.max(peakMemoryBytes, process.memoryUsage().rss);
    const search = await measureWorkspaceSearch(fixtureRoot);
    peakMemoryBytes = Math.max(peakMemoryBytes, process.memoryUsage().rss);
    const mcp = await measureMcpCatalogLoad();
    peakMemoryBytes = Math.max(peakMemoryBytes, process.memoryUsage().rss);

    const result: PerformanceBenchmarkResult = {
      schemaVersion: 1,
      fixtureVersion: fixture.schemaVersion,
      metrics: {
        extensionActivationMs: extensionSample.activationDurationMs,
        webviewFirstUsableMs: displayedSample.firstWebviewDisplayDurationMs ?? 0,
        sessionRestoreMs: session.durationMs,
        workspaceSearchMs: search.durationMs,
        mcpCatalogLoadMs: mcp.durationMs,
        steadyStateMemoryBytes: process.memoryUsage().rss,
        peakMemoryBytes,
      },
      cardinalities: {
        workspaceFiles: search.fileCount,
        searchMatches: search.matchCount,
        sessionEvents: session.eventCount,
        restoredMessages: session.messageCount,
        mcpTools: mcp.toolCount,
        mcpResources: mcp.resourceCount,
        mcpPrompts: mcp.promptCount,
      },
    };
    await mkdir(dirname(resultPath), { recursive: true });
    await writeFile(resultPath, `${JSON.stringify(result)}\n`, "utf8");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function createWorkspaceFixture(root: string): Promise<void> {
  for (let directory = 0; directory < fixture.workspace.directoryCount; directory += 1) {
    const directoryPath = join(root, `area-${directory.toString().padStart(2, "0")}`);
    await mkdir(directoryPath, { recursive: true });
    for (let file = 0; file < fixture.workspace.filesPerDirectory; file += 1) {
      const lines = Array.from({ length: fixture.workspace.linesPerFile }, (_, line) =>
        line + 1 === fixture.workspace.matchingLine
          ? `${fixture.workspace.query} area=${directory} file=${file}`
          : `bounded fixture line ${line + 1}`,
      );
      await writeFile(
        join(directoryPath, `file-${file.toString().padStart(2, "0")}.txt`),
        `${lines.join("\n")}\n`,
        "utf8",
      );
    }
  }
}

async function measureWorkspaceSearch(rootPath: string) {
  const root = vscode.Uri.file(rootPath);
  const lister = new WorkspaceFileLister(
    root,
    { validate: async (uri) => uri },
    findWorkspaceFiles,
  );
  const workspace = {
    findFiles: (request: Parameters<typeof lister.findFiles>[0], signal: AbortSignal) =>
      lister.findFiles(request, signal),
    readFile: ({ path, maxBytes }: { path: string; maxBytes: number }, signal: AbortSignal) =>
      readWorkspaceFilePrefix(joinWorkspacePath(root, path), maxBytes, signal),
  };
  const tool = createSearchFilesTool(workspace);
  const input = tool.parseInput({
    query: fixture.workspace.query,
    glob: "**/*",
    maxResults: 200,
  });
  const startedAt = performance.now();
  const output = await tool.execute(input, { signal: new AbortController().signal });
  return {
    durationMs: elapsedMilliseconds(startedAt),
    fileCount: fixture.workspace.directoryCount * fixture.workspace.filesPerDirectory,
    matchCount: output.output.matches.length,
  };
}

async function measureSessionRestore() {
  const sessionId = "performance-session";
  const repository = new InMemorySessionRepository();
  await repository.create({
    formatVersion: persistenceFormatVersion,
    sessionId,
    status: "completed",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:01:00.000Z",
    lastEventSequence: 0,
  });
  let sequence = 0;
  const append = async (event: unknown) => {
    sequence += 1;
    await repository.appendEvent(sessionId, {
      sequence,
      recordedAt: `2026-08-20T00:00:${String(Math.min(59, sequence)).padStart(2, "0")}.000Z`,
      event,
    });
  };
  for (let turn = 0; turn < fixture.session.turnCount; turn += 1) {
    await append({
      type: "session.user-message",
      data: {
        messageId: `user-${turn}`,
        sessionId,
        createdAt: "2026-08-20T00:00:00.000Z",
        role: "user",
        content: `Long-session fixture question ${turn}`,
      },
    });
    for (let delta = 0; delta < fixture.session.assistantDeltasPerTurn; delta += 1) {
      await append({
        type: "agent.text-delta",
        data: { text: `${fixture.session.deltaText} ${delta}. ` },
      });
    }
  }
  const actions = createSessionRecoveryActions(
    async () => repository,
    () => new Date("2026-08-20T00:02:00.000Z"),
  );
  const startedAt = performance.now();
  const projection = await actions.restore(sessionId);
  return {
    durationMs: elapsedMilliseconds(startedAt),
    eventCount: sequence,
    messageCount: projection.session.messages.length,
  };
}

async function measureMcpCatalogLoad() {
  const directory = await mkdtemp(join(tmpdir(), "ctrl-zebra-performance-mcp-"));
  const eventsPath = join(directory, "events.jsonl");
  const fixturePath = resolve(
    process.env.CTRL_ZEBRA_REPOSITORY_ROOT ?? process.cwd(),
    "apps",
    "extension",
    "src",
    "test",
    "fixtures",
    "mcp-server-fixture.mjs",
  );
  assert.ok(existsSync(fixturePath), `MCP benchmark fixture is missing: ${fixturePath}`);
  const port = new NodeMcpStdioPort({
    command: process.env.CTRL_ZEBRA_NODE_EXECUTABLE ?? process.execPath,
    args: [fixturePath, "--mode", "modern", "--events", eventsPath],
    cwdPath: process.cwd(),
    environment: {},
  });
  const client = new ControlledMcpClient(port, { protocolMode: "modern-only" });
  const context = {
    server: { serverId: "local_fixture", displayName: "Local fixture" },
    generation: 1,
  } as const;
  const startedAt = performance.now();
  try {
    const connected = await client.connect();
    assert.equal(connected.kind, "connected");
    const tools = await client.discoverTools(context);
    const resources = await client.discoverResources(context);
    const prompts = await client.discoverPrompts(context);
    return {
      durationMs: elapsedMilliseconds(startedAt),
      toolCount: tools.tools.length,
      resourceCount: resources.resources.length,
      promptCount: prompts.prompts.length,
    };
  } finally {
    await client.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}

async function readExtensionSample(path: string, requireDisplay = false) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const samples = (await readFile(path, "utf8").catch(() => ""))
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            activationDurationMs: number;
            firstWebviewDisplayDurationMs?: number;
            memoryBytes: number;
          },
      );
    const sample = requireDisplay
      ? samples.find((candidate) => candidate.firstWebviewDisplayDurationMs !== undefined)
      : samples[0];
    if (sample !== undefined) {
      return sample;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(
    `Timed out waiting for ${requireDisplay ? "Webview" : "activation"} performance sample at ${path}.`,
  );
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
