import assert from "node:assert/strict";
import * as vscode from "vscode";

import { agentViewId, registerAgentView } from "../../agent-view.js";

export async function verifyAgentViewRegistration(): Promise<void> {
  const disposable = { dispose() {} };
  let registeredViewId: string | undefined;
  let registeredProvider: vscode.WebviewViewProvider | undefined;

  const registration = registerAgentView((viewId, provider) => {
    registeredViewId = viewId;
    registeredProvider = provider;
    return disposable;
  });

  assert.equal(registeredViewId, agentViewId);
  assert.ok(registeredProvider, "Expected an Agent Webview View Provider to be registered.");
  assert.equal(registration, disposable);

  const commands = await vscode.commands.getCommands(true);
  const focusCommand = `${agentViewId}.focus`;

  assert.ok(commands.includes(focusCommand), `Expected ${focusCommand} to be contributed.`);
  await vscode.commands.executeCommand(focusCommand);
}
