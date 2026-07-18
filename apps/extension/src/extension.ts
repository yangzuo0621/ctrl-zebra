import { realpath } from "node:fs/promises";

import {
  createGeminiModelGateway,
  createOpenAICompatibleModelGateway,
  createOpenAIModelGateway,
} from "@ctrl-zebra/providers";
import { commands, type ExtensionContext, Uri, window, workspace } from "vscode";

import {
  createGeminiApiKeySecretStorage,
  createProviderApiKeySecretReader,
} from "./adapters/api-key-secret-storage.js";
import { createLocalWorkspaceUriCanonicalizer } from "./adapters/canonicalize-local-workspace-uri.js";
import { readProviderConfiguration } from "./adapters/provider-configuration.js";
import { findWorkspaceFiles } from "./adapters/vscode-workspace-find-files.js";
import {
  joinWorkspacePath,
  readWorkspaceFilePrefix,
} from "./adapters/vscode-workspace-read-file.js";
import { registerAgentView } from "./agent-view.js";
import { createSelectingChatRunner } from "./controllers/chat-runner.js";
import { registerGeminiApiKeyCommand } from "./controllers/gemini-api-key-command.js";
import {
  getProviderSetupErrorMessage,
  selectModelGateway,
} from "./controllers/model-gateway-selector.js";
import { createReadonlyToolRegistryProvider } from "./controllers/readonly-tool-registry.js";

export function activate(context: ExtensionContext): void {
  const secrets = createProviderApiKeySecretReader(context.secrets);
  const readonlyTools = createReadonlyToolRegistryProvider({
    getWorkspaceRoots: () => workspace.workspaceFolders?.map((folder) => folder.uri) ?? [],
    canonicalize: createLocalWorkspaceUriCanonicalizer(realpath, Uri.file),
    findFiles: findWorkspaceFiles,
    joinPath: joinWorkspacePath,
    readPrefix: readWorkspaceFilePrefix,
    onDidChangeWorkspaceFolders: (listener) => workspace.onDidChangeWorkspaceFolders(listener),
  });
  const chatRunner = createSelectingChatRunner({
    selectToolRegistry: (signal) => readonlyTools.get(signal),
    async selectModelGateway() {
      try {
        const settings = workspace.getConfiguration("ctrlZebra.provider");
        const configuration = readProviderConfiguration({
          get: (setting) => settings.get(setting),
        });

        return await selectModelGateway({
          configuration,
          requiredCapabilities: ["text-streaming", "tool-calling"],
          secrets,
          factories: {
            gemini: ({ configuration: geminiConfiguration, apiKey }) => {
              if (geminiConfiguration.provider !== "gemini" || apiKey === undefined) {
                throw new Error("Invalid internal Gemini Provider factory input.");
              }

              return createGeminiModelGateway({
                apiKey,
                modelId: geminiConfiguration.modelId,
                baseURL: geminiConfiguration.endpoint,
              });
            },
            "openai-compatible": ({ configuration: openAICompatibleConfiguration, apiKey }) => {
              if (openAICompatibleConfiguration.provider !== "openai-compatible") {
                throw new Error("Invalid internal OpenAI-Compatible Provider factory input.");
              }

              return createOpenAICompatibleModelGateway({
                apiKey,
                baseURL: openAICompatibleConfiguration.endpoint,
                modelId: openAICompatibleConfiguration.modelId,
              });
            },
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
    readonlyTools,
    registerGeminiApiKeyCommand({
      storage: createGeminiApiKeySecretStorage(context.secrets),
      registerCommand: (commandId, handler) => commands.registerCommand(commandId, handler),
      showInputBox: (options) => window.showInputBox(options),
      showInformationMessage: (message) => window.showInformationMessage(message),
      showErrorMessage: (message) => window.showErrorMessage(message),
    }),
    registerAgentView(
      context.extensionUri,
      (viewId, provider) => window.registerWebviewViewProvider(viewId, provider),
      chatRunner,
    ),
  );
}

export function deactivate(): void {}
