import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { env, memoryUsage, platform } from "node:process";

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
import { createVsCodeCheckpointRestorer } from "./adapters/create-vscode-checkpoint-restorer.js";
import { createVsCodeDiffPresenter } from "./adapters/create-vscode-diff-presenter.js";
import { createVsCodeWorkspaceEditApplier } from "./adapters/create-vscode-workspace-edit-applier.js";
import { PerformanceBaselineRecorder } from "./adapters/performance-baseline.js";
import { readProviderConfiguration } from "./adapters/provider-configuration.js";
import { SpawnCommandRunner } from "./adapters/spawn-command-runner.js";
import { createStructuredLogger } from "./adapters/structured-logger.js";
import { createWorkspaceCheckpointStoreProvider } from "./adapters/vscode-checkpoint-storage.js";
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
import { createCheckpointActions } from "./controllers/checkpoint-actions.js";
import { CommandApprovalWorkflow } from "./controllers/command-approval-workflow.js";
import { FileEditApprovalWorkflow } from "./controllers/file-edit-approval-workflow.js";
import { registerGeminiApiKeyCommand } from "./controllers/gemini-api-key-command.js";
import { selectModelGateway } from "./controllers/model-gateway-selector.js";
import {
  createWorkspaceToolRegistryProvider,
  selectWorkspaceRoot,
} from "./controllers/readonly-tool-registry.js";
import { createSessionRecoveryActions } from "./controllers/session-recovery.js";
import { ToolApprovalWorkflowRouter } from "./controllers/tool-approval-workflow.js";
import {
  selectCommandEnvironment,
  WorkspaceCommandExecutor,
} from "./controllers/workspace-command-executor.js";
import { createWorkspaceTrustPolicy } from "./controllers/workspace-trust-policy.js";

export function activate(context: ExtensionContext): void {
  const activationStartedAt = performance.now();
  const logger = createStructuredLogger(window.createOutputChannel("CtrlZebra", { log: true }));
  const performanceBaseline = new PerformanceBaselineRecorder({
    startedAt: activationStartedAt,
    now: () => performance.now(),
    readRssBytes: () => memoryUsage.rss(),
    logger,
  });
  const secrets = createProviderApiKeySecretReader(context.secrets);
  const canonicalize = createLocalWorkspaceUriCanonicalizer(realpath, Uri.file);
  const getSelectedRoot = () =>
    selectWorkspaceRoot(workspace.workspaceFolders?.map((folder) => folder.uri) ?? []);
  const createCurrentScope = () => new WorkspaceScope(getSelectedRoot(), canonicalize);
  const workspaceTrust = createWorkspaceTrustPolicy(() => workspace.isTrusted);
  const diffPresenter = createVsCodeDiffPresenter();
  const hashText = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  const selectCheckpointStore = createWorkspaceCheckpointStoreProvider(
    context.storageUri,
    workspace.fs,
    hashText,
  );
  const checkpointActions = createCheckpointActions({
    selectStore: selectCheckpointStore,
    async restore(store, checkpointId, signal) {
      await createVsCodeCheckpointRestorer(createCurrentScope(), store).restore(
        checkpointId,
        signal,
      );
    },
  });
  const fileEditApprovalWorkflow = new FileEditApprovalWorkflow({
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
    async applyPlan(plan, ownership, signal) {
      try {
        const checkpointStore = await selectCheckpointStore();
        signal.throwIfAborted();
        await createVsCodeWorkspaceEditApplier(
          createCurrentScope(),
          async (checkpoint, checkpointSignal) => {
            await checkpointStore.create(checkpoint, checkpointSignal);
          },
          randomUUID,
          () => new Date(),
          () => workspaceTrust.requireTrusted(),
        ).apply(plan, ownership, signal);
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
    workspaceTrust,
  });
  const commandExecutor = new WorkspaceCommandExecutor({
    getSelectedRoot,
    createScope: (root) => new WorkspaceScope(root, canonicalize),
    joinPath: joinWorkspacePath,
    stat: (uri) => Promise.resolve(workspace.fs.stat(uri)),
    runner: new SpawnCommandRunner(),
    workspaceTrust,
    environment: selectCommandEnvironment(env, platform),
  });
  const commandApprovalWorkflow = new CommandApprovalWorkflow({
    createId: randomUUID,
    now: () => new Date(),
    bindCwd: (cwd, signal) => commandExecutor.bindCwd(cwd, signal),
    workspaceTrust,
  });
  const approvalWorkflow = new ToolApprovalWorkflowRouter(
    fileEditApprovalWorkflow,
    commandApprovalWorkflow,
  );
  const workspaceTools = createWorkspaceToolRegistryProvider({
    getWorkspaceRoots: () => workspace.workspaceFolders?.map((folder) => folder.uri) ?? [],
    canonicalize,
    findFiles: findWorkspaceFiles,
    joinPath: joinWorkspacePath,
    readPrefix: readWorkspaceFilePrefix,
    onDidChangeWorkspaceFolders: (listener) => workspace.onDidChangeWorkspaceFolders(listener),
    onDidGrantWorkspaceTrust: (listener) => workspace.onDidGrantWorkspaceTrust(listener),
    createProposeFileEditWorkspace: (root, scope) =>
      new VsCodeProposeFileEditWorkspace(root, scope, joinWorkspacePath),
    commandExecutor,
    workspaceTrust,
  });
  const selectSessionRepository = createWorkspaceSessionRepositoryProvider(
    context.storageUri,
    workspace.fs,
  );
  const chatRunner = createSelectingChatRunner({
    selectSessionRepository,
    selectToolRegistry: (signal) => workspaceTools.get(signal),
    approvalWorkflow,
    async selectModelGateway() {
      const settings = workspace.getConfiguration("ctrlZebra.provider");
      const configuration = readProviderConfiguration({
        get: (setting) => settings.get(setting),
      });

      return selectModelGateway({
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
    },
  });

  context.subscriptions.push(
    logger,
    workspaceTools,
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
      createSessionRecoveryActions(selectSessionRepository),
      checkpointActions,
      () => {
        logger.error({
          event: "webview_response_delivery_failed",
          component: "agent_view",
          outcome: "failure",
          errorCode: "delivery_failed",
        });
      },
      () => performanceBaseline.recordFirstWebviewDisplay(),
    ),
  );

  performanceBaseline.recordActivationComplete();
}

export function deactivate(): void {}
