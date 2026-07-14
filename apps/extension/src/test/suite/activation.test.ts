import assert from "node:assert/strict";
import * as vscode from "vscode";

const extensionId = "ctrl-zebra.ctrl-zebra";

export async function verifyExtensionActivation(): Promise<void> {
  const extension = vscode.extensions.getExtension(extensionId);

  assert.ok(extension, `Expected ${extensionId} to be available in the Extension Host.`);

  await extension.activate();

  assert.equal(extension.isActive, true, `Expected ${extensionId} to be active.`);
}
