import assert from "node:assert/strict";
import * as vscode from "vscode";

import {
  agentViewId,
  createAgentViewHtml,
  createAgentViewOptions,
  registerAgentView,
} from "../../agent-view.js";
import { saveGeminiApiKeyCommandId } from "../../controllers/gemini-api-key-command.js";

export async function verifyAgentViewRegistration(): Promise<void> {
  const disposable = { dispose() {} };
  let registeredViewId: string | undefined;
  let registeredProvider: vscode.WebviewViewProvider | undefined;

  const extensionUri = vscode.Uri.file("/ctrl-zebra");
  const registration = registerAgentView(
    extensionUri,
    (viewId, provider) => {
      registeredViewId = viewId;
      registeredProvider = provider;
      return disposable;
    },
    { async run() {} },
  );

  assert.equal(registeredViewId, agentViewId);
  assert.ok(registeredProvider, "Expected an Agent Webview View Provider to be registered.");
  assert.equal(registration, disposable);

  const commands = await vscode.commands.getCommands(true);
  const focusCommand = `${agentViewId}.focus`;

  assert.ok(commands.includes(focusCommand), `Expected ${focusCommand} to be contributed.`);
  assert.ok(
    commands.includes(saveGeminiApiKeyCommandId),
    `Expected ${saveGeminiApiKeyCommandId} to be contributed and registered.`,
  );
  await vscode.commands.executeCommand(focusCommand);

  const resolvedResources: vscode.Uri[] = [];
  const nonce = "0123456789abcdef0123456789abcdef";
  const html = createAgentViewHtml(
    {
      cspSource: "https://webview.test/&policy=restricted",
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
    nonce,
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
  assert.match(html, /default-src &#39;none&#39;/);
  assert.match(html, /style-src https:\/\/webview\.test\/&amp;policy=restricted/);
  assert.match(html, /script-src &#39;nonce-0123456789abcdef0123456789abcdef&#39;/);
  assert.match(html, /base-uri &#39;none&#39;/);
  assert.match(html, /form-action &#39;none&#39;/);
  assert.match(html, /nonce="0123456789abcdef0123456789abcdef"/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);

  const options = createAgentViewOptions(extensionUri);
  assert.equal(options.enableScripts, true);
  assert.deepEqual(options.localResourceRoots, [
    vscode.Uri.joinPath(extensionUri, "dist", "webview"),
  ]);

  const conversionFailure = new Error("Resource conversion failed.");
  assert.throws(
    () =>
      createAgentViewHtml(
        {
          cspSource: "https://webview.test",
          asWebviewUri() {
            throw conversionFailure;
          },
        },
        extensionUri,
        nonce,
      ),
    conversionFailure,
  );
}
