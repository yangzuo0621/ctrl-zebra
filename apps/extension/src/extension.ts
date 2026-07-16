import { type ExtensionContext, window } from "vscode";

import { createOpenAIApiKeySecretStorage } from "./adapters/api-key-secret-storage.js";
import { registerAgentView } from "./agent-view.js";
import { createChatRunner } from "./controllers/chat-runner.js";

export function activate(context: ExtensionContext): void {
  const chatRunner = createChatRunner({
    apiKeyStorage: createOpenAIApiKeySecretStorage(context.secrets),
    async requestApiKey(signal) {
      const apiKey = await window.showInputBox({
        title: "Connect CtrlZebra to OpenAI",
        prompt: "Enter an OpenAI API key. It will be stored in VS Code SecretStorage.",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) =>
          value.trim().length === 0 ? "An API key is required." : undefined,
      });
      signal.throwIfAborted();
      return apiKey;
    },
  });

  context.subscriptions.push(
    registerAgentView(
      context.extensionUri,
      (viewId, provider) => window.registerWebviewViewProvider(viewId, provider),
      chatRunner,
    ),
  );
}

export function deactivate(): void {}
