import { createOpenAIModelGateway } from "@ctrl-zebra/providers";
import { type ExtensionContext, window, workspace } from "vscode";

import { createProviderApiKeySecretReader } from "./adapters/api-key-secret-storage.js";
import { readProviderConfiguration } from "./adapters/provider-configuration.js";
import { registerAgentView } from "./agent-view.js";
import { createSelectingChatRunner } from "./controllers/chat-runner.js";
import {
  getProviderSetupErrorMessage,
  selectModelGateway,
} from "./controllers/model-gateway-selector.js";

export function activate(context: ExtensionContext): void {
  const secrets = createProviderApiKeySecretReader(context.secrets);
  const chatRunner = createSelectingChatRunner({
    async selectModelGateway() {
      try {
        const settings = workspace.getConfiguration("ctrlZebra.provider");
        const configuration = readProviderConfiguration({
          get: (setting) => settings.get(setting),
        });

        return await selectModelGateway({
          configuration,
          requiredCapabilities: ["text-streaming"],
          secrets,
          factories: {
            openai: ({ configuration: openAIConfiguration, apiKey }) => {
              if (openAIConfiguration.provider !== "openai" || apiKey === undefined) {
                throw new Error("Invalid internal OpenAI Provider factory input.");
              }

              return createOpenAIModelGateway({
                apiKey,
                modelId: openAIConfiguration.modelId,
                baseURL: openAIConfiguration.endpoint,
              });
            },
          },
        });
      } catch (error) {
        const message = getProviderSetupErrorMessage(error);
        if (message !== undefined) {
          await window.showErrorMessage(message);
        }
        throw error;
      }
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
