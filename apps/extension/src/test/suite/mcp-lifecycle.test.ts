import assert from "node:assert/strict";

import * as vscode from "vscode";

const extensionId = "ctrl-zebra.ctrl-zebra";

export async function verifyMcpLifecycle(): Promise<void> {
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `Expected ${extensionId} to be available in the Extension Host.`);
  const setting = vscode.workspace.getConfiguration("ctrlZebra.mcp");

  try {
    await setting.update(
      "server",
      {
        version: 1,
        serverId: "extension_fixture",
        displayName: "Extension fixture",
        command: "",
        args: [],
      },
      vscode.ConfigurationTarget.Global,
    );
    await extension.activate();

    const rejected = await vscode.commands.executeCommand<{
      readonly generation: number;
      readonly status: string;
      readonly error?: { readonly code: string };
    }>("ctrlZebra.connectMcpServer");
    assert.equal(rejected?.generation, 0);
    assert.equal(rejected?.status, "failed");
    assert.equal(rejected?.error?.code, "configuration-invalid");

    const disconnected = await vscode.commands.executeCommand<{ readonly status: string }>(
      "ctrlZebra.disconnectMcpServer",
    );
    assert.equal(disconnected?.status, "disconnected");
  } finally {
    await vscode.commands.executeCommand("ctrlZebra.disconnectMcpServer");
    await setting.update("server", undefined, vscode.ConfigurationTarget.Global);
  }
}
