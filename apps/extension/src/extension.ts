import { type ExtensionContext, window } from "vscode";

import { registerAgentView } from "./agent-view.js";

export function activate(context: ExtensionContext): void {
  context.subscriptions.push(
    registerAgentView((viewId, provider) => window.registerWebviewViewProvider(viewId, provider)),
  );
}

export function deactivate(): void {}
