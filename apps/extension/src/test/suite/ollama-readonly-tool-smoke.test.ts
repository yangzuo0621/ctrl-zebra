import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";

import type { AgentRuntimeEvent } from "@ctrl-zebra/core";
import { createOpenAICompatibleModelGateway } from "@ctrl-zebra/providers";
import * as vscode from "vscode";

import { createLocalWorkspaceUriCanonicalizer } from "../../adapters/canonicalize-local-workspace-uri.js";
import { findWorkspaceFiles } from "../../adapters/vscode-workspace-find-files.js";
import {
  joinWorkspacePath,
  readWorkspaceFilePrefix,
} from "../../adapters/vscode-workspace-read-file.js";
import { createSelectingChatRunner } from "../../controllers/chat-runner.js";
import { createReadonlyToolRegistryProvider } from "../../controllers/readonly-tool-registry.js";

const ollamaBaseUrl = "http://127.0.0.1:11434/v1";

export async function verifyOllamaReadonlyToolSmoke(): Promise<void> {
  const modelId = process.env.CTRL_ZEBRA_OLLAMA_SMOKE_MODEL;
  if (modelId === undefined) {
    return;
  }

  assert.equal(
    vscode.workspace.workspaceFolders?.length,
    1,
    "Ollama smoke test requires exactly one workspace folder.",
  );

  const readonlyTools = createReadonlyToolRegistryProvider({
    getWorkspaceRoots: () => vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [],
    canonicalize: createLocalWorkspaceUriCanonicalizer(realpath, vscode.Uri.file),
    findFiles: findWorkspaceFiles,
    joinPath: joinWorkspacePath,
    readPrefix: readWorkspaceFilePrefix,
    onDidChangeWorkspaceFolders: (listener) =>
      vscode.workspace.onDidChangeWorkspaceFolders(listener),
  });
  const events: AgentRuntimeEvent[] = [];
  const runner = createSelectingChatRunner({
    selectToolRegistry: (signal) => readonlyTools.get(signal),
    selectModelGateway: async () =>
      createOpenAICompatibleModelGateway({
        apiKey: "ollama",
        baseURL: ollamaBaseUrl,
        modelId,
      }),
  });

  try {
    await runner.run(
      'Use list_files exactly once with {"glob":"package.json"}. Do not use another tool. After the tool result, answer SMOKE_OK.',
      AbortSignal.timeout(120_000),
      (event) => events.push(event),
    );
  } finally {
    readonlyTools.dispose();
  }

  const successfulList = events.find(
    (event) =>
      event.type === "agent.tool-state" &&
      event.status === "success" &&
      event.call.name === "list_files",
  );
  assert.ok(successfulList, "Expected the real model to call list_files successfully.");
  assert.ok(
    events.some((event) => event.type === "session.status-changed" && event.status === "completed"),
    "Expected the real model/tool loop to complete.",
  );
}
