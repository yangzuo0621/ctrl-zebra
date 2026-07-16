import { type ExtensionContext, window } from "vscode";

import { registerAgentView } from "./agent-view.js";
import { createUnconfiguredChatRunner } from "./controllers/chat-runner.js";

export function activate(context: ExtensionContext): void {
  // T0307 replaces this unavailable runner after validated Provider configuration exists.
  const chatRunner = createUnconfiguredChatRunner();

  context.subscriptions.push(
    registerAgentView(
      context.extensionUri,
      (viewId, provider) => window.registerWebviewViewProvider(viewId, provider),
      chatRunner,
    ),
  );
}

export function deactivate(): void {}
