import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { InMemorySessionRepository } from "@ctrl-zebra/core";
import { createOpenAICompatibleModelGateway } from "@ctrl-zebra/providers";
import * as vscode from "vscode";

import { createLocalWorkspaceUriCanonicalizer } from "../../adapters/canonicalize-local-workspace-uri.js";
import { VsCodeProposeFileEditWorkspace } from "../../adapters/vscode-propose-file-edit-workspace.js";
import { findWorkspaceFiles } from "../../adapters/vscode-workspace-find-files.js";
import {
  joinWorkspacePath,
  readWorkspaceFilePrefix,
} from "../../adapters/vscode-workspace-read-file.js";
import { type ChatRunnerEvent, createSelectingChatRunner } from "../../controllers/chat-runner.js";
import { createWorkspaceToolRegistryProvider } from "../../controllers/readonly-tool-registry.js";

const modelId = "marketplace-smoke";
const maximumRequestBytes = 256 * 1024;

export async function verifyMarketplaceSmoke(): Promise<void> {
  if (process.env.CTRL_ZEBRA_MARKETPLACE_SMOKE !== "1") {
    return;
  }

  assert.equal(
    vscode.workspace.workspaceFolders?.length,
    1,
    "Marketplace smoke requires exactly one workspace folder.",
  );

  const provider = await startProvider();
  const readonlyTools = createWorkspaceToolRegistryProvider({
    getWorkspaceRoots: () => vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [],
    canonicalize: createLocalWorkspaceUriCanonicalizer(realpath, vscode.Uri.file),
    findFiles: findWorkspaceFiles,
    joinPath: joinWorkspacePath,
    readPrefix: readWorkspaceFilePrefix,
    onDidChangeWorkspaceFolders: (listener) =>
      vscode.workspace.onDidChangeWorkspaceFolders(listener),
    onDidGrantWorkspaceTrust: () => ({ dispose() {} }),
    createProposeFileEditWorkspace: (root, scope) =>
      new VsCodeProposeFileEditWorkspace(root, scope, joinWorkspacePath),
    commandExecutor: {
      run: async () => ({
        output: { stdout: "", stderr: "", exitCode: 0, signal: null },
        truncated: false,
      }),
    },
    workspaceTrust: {
      isTrusted: () => false,
      requireTrusted() {
        throw new Error("Marketplace smoke does not enable dangerous tools.");
      },
    },
  });
  const repository = new InMemorySessionRepository();
  const runner = createSelectingChatRunner({
    selectSessionRepository: async () => repository,
    selectToolRegistry: (signal) => readonlyTools.get(signal),
    selectModelGateway: async () =>
      createOpenAICompatibleModelGateway({ baseURL: provider.baseUrl, modelId }),
  });

  try {
    const firstTurn: ChatRunnerEvent[] = [];
    await runner.run(
      "List the README, read it, and finish the Marketplace smoke path.",
      AbortSignal.timeout(60_000),
      (event) => firstTurn.push(event),
    );

    for (const toolName of ["list_files", "read_file"]) {
      assert.ok(
        firstTurn.some(
          (event) =>
            event.type === "agent.tool-state" &&
            event.status === "success" &&
            event.call.name === toolName,
        ),
        `Expected ${toolName} to complete through the real workspace Tool registry.`,
      );
    }
    assert.ok(
      firstTurn.some(
        (event) => event.type === "agent.text-delta" && event.text.includes("TOOL_SMOKE_OK"),
      ),
      "Expected the deterministic Provider to complete the Tool loop.",
    );
    const sessionId = firstTurn.find((event) => event.type === "session.status-changed")?.sessionId;
    assert.ok(sessionId, "Expected the first Marketplace turn to allocate a Session.");

    const secondTurn: ChatRunnerEvent[] = [];
    await runner.run(
      "Continue with the Marketplace second turn.",
      AbortSignal.timeout(60_000),
      (event) => secondTurn.push(event),
      [],
      [],
      sessionId,
    );
    assert.ok(
      secondTurn.some(
        (event) => event.type === "agent.text-delta" && event.text.includes("MULTI_TURN_SMOKE_OK"),
      ),
      "Expected a second turn on the persisted Session.",
    );
    assert.ok(
      secondTurn.some(
        (event) => event.type === "session.status-changed" && event.status === "completed",
      ),
      "Expected the multi-turn Marketplace smoke Session to complete.",
    );
    assert.equal(provider.authorizationObserved(), false, "Loopback smoke must not send a secret.");
  } finally {
    readonlyTools.dispose();
    await provider.close();
  }
}

interface TestProvider {
  readonly baseUrl: string;
  authorizationObserved(): boolean;
  close(): Promise<void>;
}

async function startProvider(): Promise<TestProvider> {
  let sawAuthorization = false;
  const server = createServer((request, response) => {
    sawAuthorization ||= request.headers.authorization !== undefined;
    void handleRequest(request, response).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error("Provider smoke failed."));
    });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Marketplace Provider did not bind to a loopback TCP port.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    authorizationObserved: () => sawAuthorization,
    close: () => closeServer(server),
  };
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"not-found"}');
    return;
  }

  const body = parseRequest(await readRequest(request));
  const messages = Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
  const lastUser = [...messages]
    .reverse()
    .find((message) => message.role === "user" && typeof message.content === "string");
  const lastUserContent = typeof lastUser?.content === "string" ? lastUser.content : undefined;
  const toolResults = messages.filter((message) => message.role === "tool").length;

  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
    connection: "keep-alive",
  });

  if (lastUserContent?.includes("second turn")) {
    writeTextCompletion(response, "MULTI_TURN_SMOKE_OK");
  } else if (toolResults === 0) {
    writeToolCompletion(response, "marketplace-list", "list_files", '{"glob":"README.md"}');
  } else if (toolResults === 1) {
    writeToolCompletion(response, "marketplace-read", "read_file", '{"path":"README.md"}');
  } else {
    writeTextCompletion(response, "TOOL_SMOKE_OK");
  }
  response.end("data: [DONE]\n\n");
}

function writeToolCompletion(
  response: ServerResponse,
  toolCallId: string,
  toolName: string,
  argumentsJson: string,
): void {
  writeEvent(response, {
    choices: [
      {
        delta: {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: toolCallId,
              type: "function",
              function: { name: toolName, arguments: argumentsJson },
            },
          ],
        },
        finish_reason: null,
        index: 0,
      },
    ],
  });
  writeEvent(response, {
    choices: [{ delta: {}, finish_reason: "tool_calls", index: 0 }],
  });
}

function writeTextCompletion(response: ServerResponse, text: string): void {
  writeEvent(response, {
    choices: [{ delta: { role: "assistant", content: text }, finish_reason: null, index: 0 }],
  });
  writeEvent(response, { choices: [{ delta: {}, finish_reason: "stop", index: 0 }] });
}

function writeEvent(response: ServerResponse, value: object): void {
  response.write(
    `data: ${JSON.stringify({
      id: "marketplace-smoke-completion",
      object: "chat.completion.chunk",
      created: 0,
      model: modelId,
      ...value,
    })}\n\n`,
  );
}

async function readRequest(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    length += chunk.byteLength;
    if (length > maximumRequestBytes) {
      throw new Error("Marketplace Provider request exceeded its bounded fixture limit.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

function parseRequest(body: string): Record<string, unknown> {
  const value = JSON.parse(body) as unknown;
  if (!isRecord(value)) {
    throw new Error("Marketplace Provider request was not a JSON object.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
