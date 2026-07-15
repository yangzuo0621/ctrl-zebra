import assert from "node:assert/strict";
import * as vscode from "vscode";

import { agentViewId, createAgentViewHtml, registerAgentView } from "../../agent-view.js";

export async function verifyAgentViewRegistration(): Promise<void> {
  const disposable = { dispose() {} };
  let registeredViewId: string | undefined;
  let registeredProvider: vscode.WebviewViewProvider | undefined;

  const extensionUri = vscode.Uri.file("/ctrl-zebra");
  const registration = registerAgentView(extensionUri, (viewId, provider) => {
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

  const resolvedResources: vscode.Uri[] = [];
  const html = createAgentViewHtml(
    {
      asWebviewUri(resource) {
        resolvedResources.push(resource);
        return vscode.Uri.from({
          scheme: "https",
          authority: "webview.test",
          path: resource.path,
          query: "theme=dark&contrast=high",
        });
      },
    },
    extensionUri,
  );

  assert.deepEqual(
    resolvedResources.map((resource) => resource.path),
    ["/ctrl-zebra/dist/webview/main.js", "/ctrl-zebra/dist/webview/main.css"],
  );
  assert.match(
    html,
    /href="https:\/\/webview\.test\/ctrl-zebra\/dist\/webview\/main\.css\?theme%3Ddark%26contrast%3Dhigh"/,
  );
  assert.match(
    html,
    /src="https:\/\/webview\.test\/ctrl-zebra\/dist\/webview\/main\.js\?theme%3Ddark%26contrast%3Dhigh"/,
  );

  const conversionFailure = new Error("Resource conversion failed.");
  assert.throws(
    () =>
      createAgentViewHtml(
        {
          asWebviewUri() {
            throw conversionFailure;
          },
        },
        extensionUri,
      ),
    conversionFailure,
  );
}
