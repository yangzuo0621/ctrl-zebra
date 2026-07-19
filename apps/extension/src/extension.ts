import { randomUUID } from "node:crypto";
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
import { createVsCodeDiffPresenter } from "./adapters/create-vscode-diff-presenter.js";
import { createVsCodeWorkspaceEditApplier } from "./adapters/create-vscode-workspace-edit-applier.js";
import { readProviderConfiguration } from "./adapters/provider-configuration.js";
import { VsCodeProposeFileEditWorkspace } from "./adapters/vscode-propose-file-edit-workspace.js";
import { createWorkspaceSessionRepositoryProvider } from "./adapters/vscode-session-storage.js";
import { findWorkspaceFiles } from "./adapters/vscode-workspace-find-files.js";
import {
  joinWorkspacePath,
  readWorkspaceFilePrefix,
} from "./adapters/vscode-workspace-read-file.js";
import { WorkspaceEditConflictError } from "./adapters/workspace-edit-applier.js";
import { WorkspaceScope, WorkspaceScopeError } from "./adapters/workspace-scope.js";
import { registerAgentView } from "./agent-view.js";
import { createSelectingChatRunner } from "./controllers/chat-runner.js";
import { FileEditApprovalWorkflow } from "./controllers/file-edit-approval-workflow.js";
import { registerGeminiApiKeyCommand } from "./controllers/gemini-api-key-command.js";
import {
  getProviderSetupErrorMessage,
  selectModelGateway,
} from "./controllers/model-gateway-selector.js";
import {
  createReadonlyToolRegistryProvider,
  selectWorkspaceRoot,
} from "./controllers/readonly-tool-registry.js";

export function activate(context: ExtensionContext): void {
  const secrets = createProviderApiKeySecretReader(context.secrets);
  const canonicalize = createLocalWorkspaceUriCanonicalizer(realpath, Uri.file);
  const getSelectedRoot = () =>
    selectWorkspaceRoot(workspace.workspaceFolders?.map((folder) => folder.uri) ?? []);
  const createCurrentScope = () => new WorkspaceScope(getSelectedRoot(), canonicalize);
  const diffPresenter = createVsCodeDiffPresenter();
  const approvalWorkflow = new FileEditApprovalWorkflow({
    createId: randomUUID,
    now: () => new Date(),
    async bindPlan(plan, signal) {
      const root = getSelectedRoot();
      const scope = new WorkspaceScope(root, canonicalize);
      const canonical = await scope.validate(Uri.parse(plan.uri, true), signal);
      if (canonical.toString() !== plan.uri) {
        throw new WorkspaceScopeError("canonicalization-failed");
      }
      return root.toString();
    },
    async validatePlan(plan, signal) {
      const canonical = await createCurrentScope().validate(Uri.parse(plan.uri, true), signal);
      if (canonical.toString() !== plan.uri) {
        throw new WorkspaceScopeError("canonicalization-failed");
      }
    },
    presentDiff: (plan, signal) => diffPresenter.present(plan, signal),
    async applyPlan(plan, signal) {
      try {
        await createVsCodeWorkspaceEditApplier(createCurrentScope()).apply(plan, signal);
        return "applied";
      } catch (error) {
        if (error instanceof WorkspaceEditConflictError || error instanceof WorkspaceScopeError) {
          return "conflict";
        }
        throw error;
      }
    },
    reportError: (message) => {
      void window.showErrorMessage(message);
    },
  });
  const readonlyTools = createReadonlyToolRegistryProvider({
    getWorkspaceRoots: () => workspace.workspaceFolders?.map((folder) => folder.uri) ?? [],
    canonicalize,
    findFiles: findWorkspaceFiles,
    joinPath: joinWorkspacePath,
    readPrefix: readWorkspaceFilePrefix,
    onDidChangeWorkspaceFolders: (listener) => workspace.onDidChangeWorkspaceFolders(listener),
    createProposeFileEditWorkspace: (root, scope) =>
      new VsCodeProposeFileEditWorkspace(root, scope, joinWorkspacePath),
  });
  const chatRunner = createSelectingChatRunner({
    selectSessionRepository: createWorkspaceSessionRepositoryProvider(
      context.storageUri,
      workspace.fs,
    ),
    selectToolRegistry: (signal) => readonlyTools.get(signal),
    approvalWorkflow,
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
    diffPresenter,
    approvalWorkflow,
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
      {
        showDiff: (_requestId, approvalId) => approvalWorkflow.showDiff(approvalId),
        decide: (_requestId, approvalId, decision) => approvalWorkflow.decide(approvalId, decision),
      },
    ),
  );
}

export function deactivate(): void {}
