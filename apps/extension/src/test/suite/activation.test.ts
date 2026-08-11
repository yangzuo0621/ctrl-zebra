import assert from "node:assert/strict";
import * as vscode from "vscode";

const extensionId = "ctrl-zebra.ctrl-zebra";

export async function verifyExtensionActivation(): Promise<void> {
  const extension = vscode.extensions.getExtension(extensionId);

  assert.ok(extension, `Expected ${extensionId} to be available in the Extension Host.`);

  await extension.activate();

  assert.equal(extension.isActive, true, `Expected ${extensionId} to be active.`);
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("ctrlZebra.connectMcpServer"));
  assert.ok(commands.includes("ctrlZebra.disconnectMcpServer"));
  assert.ok(commands.includes("ctrlZebra.selectModel"));
  assert.ok(commands.includes("ctrlZebra.rotateOpenAIApiKey"));
  assert.ok(commands.includes("ctrlZebra.rotateGeminiApiKey"));
  assert.ok(commands.includes("ctrlZebra.rotateOpenAICompatibleApiKey"));
  assert.ok(commands.includes("ctrlZebra.deleteOpenAIApiKey"));
  assert.ok(commands.includes("ctrlZebra.deleteGeminiApiKey"));
  assert.ok(commands.includes("ctrlZebra.deleteOpenAICompatibleApiKey"));
}
