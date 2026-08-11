import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { env, memoryUsage, platform } from "node:process";

import { ControlledMcpClient } from "@ctrl-zebra/mcp-client";
import {
  createGeminiModelGateway,
  createOpenAICompatibleModelGateway,
  createOpenAIModelGateway,
} from "@ctrl-zebra/providers";
import {
  ConfigurationTarget,
  commands,
  type ExtensionContext,
  Uri,
  window,
  workspace,
} from "vscode";

import {
  createGeminiApiKeySecretStorage,
  createOpenAIApiKeySecretStorage,
  createOpenAICompatibleApiKeySecretStorage,
  createProviderApiKeySecretReader,
} from "./adapters/api-key-secret-storage.js";
import { createLocalWorkspaceUriCanonicalizer } from "./adapters/canonicalize-local-workspace-uri.js";
import { createVsCodeCheckpointRestorer } from "./adapters/create-vscode-checkpoint-restorer.js";
import { createVsCodeDiffPresenter } from "./adapters/create-vscode-diff-presenter.js";
import { createVsCodeWorkspaceEditApplier } from "./adapters/create-vscode-workspace-edit-applier.js";
import {
  mcpServerSettingName,
  mcpServerSettingSection,
  readMcpServerConfiguration,
} from "./adapters/mcp-server-configuration.js";
import { NodeMcpStdioPort, selectMcpServerEnvironment } from "./adapters/mcp-stdio-port.js";
import { PerformanceBaselineRecorder } from "./adapters/performance-baseline.js";
import {
  readProviderConfiguration,
  readProviderOnboardingConfiguration,
  readProviderSelectionConfiguration,
} from "./adapters/provider-configuration.js";
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
import { combineToolRegistries } from "./controllers/combine-tool-registries.js";
import { CommandApprovalWorkflow } from "./controllers/command-approval-workflow.js";
import { FileEditApprovalWorkflow } from "./controllers/file-edit-approval-workflow.js";
import { McpConnectionController } from "./controllers/mcp-connection-controller.js";
import { McpPromptActions } from "./controllers/mcp-prompt-actions.js";
import { McpResourceActions } from "./controllers/mcp-resource-actions.js";
import { registerMcpServerCommands } from "./controllers/mcp-server-commands.js";
import { McpStartupApproval } from "./controllers/mcp-startup-approval.js";
import { McpToolApprovalWorkflow } from "./controllers/mcp-tool-approval-workflow.js";
import { McpWebviewActions } from "./controllers/mcp-webview-actions.js";
import { selectModelGateway } from "./controllers/model-gateway-selector.js";
import {
  registerModelSelectionCommand,
  selectModelCommandId,
} from "./controllers/model-selection-command.js";
import {
  registerProviderApiKeyCommands,
  saveGeminiApiKeyCommandId,
  saveOpenAIApiKeyCommandId,
  saveOpenAICompatibleApiKeyCommandId,
} from "./controllers/provider-api-key-command.js";
import {
  type ProviderOnboardingActionResult,
  ProviderOnboardingController,
} from "./controllers/provider-onboarding-controller.js";
import {
  createWorkspaceToolRegistryProvider,
  selectWorkspaceRoot,
} from "./controllers/readonly-tool-registry.js";
import {
  getAgentRuntimeDiagnosticLogEntry,
  getRunFailureLogEntry,
} from "./controllers/run-error-mapper.js";
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
  const mcpStartupApproval = new McpStartupApproval({
    now: () => new Date(),
    showWarningMessage: (message, options, item) =>
      window.showWarningMessage(message, options, item),
  });
  const mcpConnection = new McpConnectionController({
    readConfiguration() {
      const settings = workspace.getConfiguration(mcpServerSettingSection);
      return readMcpServerConfiguration({
        inspect: (setting: string) => settings.inspect<unknown>(setting),
      });
    },
    async bindWorkspace(signal) {
      workspaceTrust.requireTrusted();
      const canonicalRoot = await canonicalize(getSelectedRoot(), signal);
      signal.throwIfAborted();
      workspaceTrust.requireTrusted();
      if (canonicalRoot.scheme !== "file") {
        throw new Error("MCP Server startup requires a canonical local workspace.");
      }
      return { cwdUri: canonicalRoot.toString(), cwdPath: canonicalRoot.fsPath };
    },
    workspaceTrust,
    environment: selectMcpServerEnvironment(env, platform),
    requestStartupApproval: (operation, signal) => mcpStartupApproval.request(operation, signal),
    createPort: (operation, onFailure) => new NodeMcpStdioPort(operation, { onFailure }),
    createClient: (port) => new ControlledMcpClient(port),
    getReservedToolNames: () => [
      "list_files",
      "propose_file_edit",
      "read_file",
      "run_command",
      "search_files",
    ],
    notifyInformation: (message) => {
      void window.showInformationMessage(message);
    },
    notifyError: (message) => {
      void window.showErrorMessage(message);
    },
    log: (entry) => {
      if (entry.outcome === "failure") {
        logger.error(entry);
      } else {
        logger.info(entry);
      }
    },
  });
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
  const mcpToolApprovalWorkflow = new McpToolApprovalWorkflow({
    createId: randomUUID,
    now: () => new Date(),
    workspaceTrust,
    getToolSnapshot: () => mcpConnection.getToolSnapshot(),
  });
  const approvalWorkflow = new ToolApprovalWorkflowRouter(
    fileEditApprovalWorkflow,
    commandApprovalWorkflow,
    mcpToolApprovalWorkflow,
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
    diagnosticSink: {
      emit: (diagnostic) => {
        logger.error(getAgentRuntimeDiagnosticLogEntry(diagnostic));
      },
    },
    selectSessionRepository,
    async selectToolRegistry(signal) {
      const workspaceRegistry = await workspaceTools.get(signal);
      signal.throwIfAborted();
      const mcpSnapshot = mcpConnection.getToolSnapshot();
      return mcpSnapshot === undefined
        ? workspaceRegistry
        : {
            registry: combineToolRegistries(workspaceRegistry, mcpSnapshot.registry),
            mcpToolSources: new Map(
              mcpSnapshot.tools.map((tool) => [
                tool.registryName,
                {
                  serverId: mcpSnapshot.server.serverId,
                  displayName: mcpSnapshot.server.displayName,
                  registryName: tool.registryName,
                  mcpToolName: tool.mcpToolName,
                  generation: mcpSnapshot.generation,
                },
              ]),
            ),
          };
    },
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
            return createGeminiModelGateway({
              apiKey,
              modelId: geminiConfiguration.modelId,
              baseURL: geminiConfiguration.endpoint,
            });
          },
          "openai-compatible": ({ configuration: openAICompatibleConfiguration, apiKey }) => {
            return createOpenAICompatibleModelGateway({
              apiKey,
              baseURL: openAICompatibleConfiguration.endpoint,
              modelId: openAICompatibleConfiguration.modelId,
            });
          },
          openai: ({ configuration: openAIConfiguration, apiKey }) => {
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

  const createProviderOnboarding = () =>
    new ProviderOnboardingController({
      async readStatus() {
        try {
          const settings = workspace.getConfiguration("ctrlZebra.provider");
          const configuration = readProviderOnboardingConfiguration({
            get: (setting) => settings.get(setting),
          });
          const apiKeyConfigured = configuration.endpointValid
            ? configuration.apiKeyRequired
              ? await readApiKeyConfigured(configuration.provider)
              : true
            : false;
          return {
            provider: configuration.provider,
            apiKeyConfigured,
            modelConfigured: configuration.modelConfigured,
          };
        } catch {
          return {
            provider: "openai" as const,
            apiKeyConfigured: false,
            modelConfigured: false,
          };
        }
      },
      async run(action): Promise<ProviderOnboardingActionResult> {
        if (action === "open-settings") {
          try {
            await commands.executeCommand("workbench.action.openSettings", "ctrlZebra.provider");
            return { status: "completed" };
          } catch {
            return { status: "failed", code: "internal" };
          }
        }

        if (action === "select-model") {
          try {
            return (
              (await commands.executeCommand<ProviderOnboardingActionResult>(
                selectModelCommandId,
              )) ?? { status: "failed", code: "internal" }
            );
          } catch {
            return { status: "failed", code: "internal" };
          }
        }

        let commandId: string;
        try {
          const settings = workspace.getConfiguration("ctrlZebra.provider");
          const provider = readProviderOnboardingConfiguration({
            get: (setting) => settings.get(setting),
          }).provider;
          commandId = {
            openai: saveOpenAIApiKeyCommandId,
            gemini: saveGeminiApiKeyCommandId,
            "openai-compatible": saveOpenAICompatibleApiKeyCommandId,
          }[provider];
        } catch {
          return { status: "failed", code: "configuration" };
        }

        try {
          return (
            (await commands.executeCommand<ProviderOnboardingActionResult>(commandId)) ?? {
              status: "failed",
              code: "internal",
            }
          );
        } catch {
          return { status: "failed", code: "internal" };
        }
      },
    });

  async function readApiKeyConfigured(provider: Parameters<typeof secrets.read>[0]) {
    try {
      const apiKey = await secrets.read(provider);
      return typeof apiKey === "string" && apiKey.length > 0;
    } catch {
      return false;
    }
  }

  context.subscriptions.push(
    logger,
    workspaceTools,
    diffPresenter,
    approvalWorkflow,
    {
      dispose() {
        void mcpConnection.dispose().catch(() => {
          logger.error({
            event: "mcp_dispose_failed",
            component: "mcp",
            outcome: "failure",
            errorCode: "internal",
          });
        });
      },
    },
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${mcpServerSettingSection}.${mcpServerSettingName}`)) {
        mcpConnection.markConfigurationStale();
      }
    }),
    workspace.onDidChangeWorkspaceFolders(() => mcpConnection.markConfigurationStale()),
    workspace.onDidGrantWorkspaceTrust(() => mcpConnection.handleWorkspaceTrustChange()),
    registerMcpServerCommands({
      controller: mcpConnection,
      registerCommand: (commandId, handler) => commands.registerCommand(commandId, handler),
    }),
    registerProviderApiKeyCommands({
      storages: {
        openai: createOpenAIApiKeySecretStorage(context.secrets),
        gemini: createGeminiApiKeySecretStorage(context.secrets),
        "openai-compatible": createOpenAICompatibleApiKeySecretStorage(context.secrets),
      },
      registerCommand: (commandId, handler) => commands.registerCommand(commandId, handler),
      showInputBox: (options) => window.showInputBox(options),
      showWarningMessage: (message, options, item) =>
        window.showWarningMessage(message, options, item),
      showInformationMessage: (message) => window.showInformationMessage(message),
      showErrorMessage: (message) => window.showErrorMessage(message),
    }),
    registerModelSelectionCommand({
      readConfiguration() {
        const settings = workspace.getConfiguration("ctrlZebra.provider");
        return readProviderSelectionConfiguration({
          get: (setting) => settings.get(setting),
        });
      },
      secrets,
      updateModel: (modelId) =>
        workspace
          .getConfiguration("ctrlZebra.provider")
          .update("model", modelId, ConfigurationTarget.Global),
      registerCommand: (commandId, handler) => commands.registerCommand(commandId, handler),
      showInputBox: (options) => window.showInputBox(options),
      showQuickPick: (items, options) => window.showQuickPick(items, options),
      showInformationMessage: (message) => window.showInformationMessage(message),
      showErrorMessage: (message) => window.showErrorMessage(message),
    }),
    registerAgentView({
      extensionUri: context.extensionUri,
      registrar: (viewId, provider) => window.registerWebviewViewProvider(viewId, provider),
      chatRunner,
      approvalActions: {
        showDiff: (_requestId, approvalId) => approvalWorkflow.showDiff(approvalId),
        decide: (_requestId, approvalId, decision) => approvalWorkflow.decide(approvalId, decision),
      },
      sessionActions: createSessionRecoveryActions(selectSessionRepository),
      checkpointActions,
      reportDeliveryFailure: () => {
        logger.error({
          event: "webview_response_delivery_failed",
          component: "agent_view",
          outcome: "failure",
          errorCode: "delivery_failed",
        });
      },
      reportDisplay: () => performanceBaseline.recordFirstWebviewDisplay(),
      reportRunFailure: (error) => {
        logger.error(getRunFailureLogEntry(error));
      },
      createResourceActions: () =>
        new McpResourceActions({ connection: mcpConnection, createId: randomUUID }),
      createPromptActions: () =>
        new McpPromptActions({ connection: mcpConnection, createId: randomUUID }),
      createMcpActions: () =>
        new McpWebviewActions({
          connection: mcpConnection,
          openSettings: () => {
            void commands.executeCommand("workbench.action.openSettings", mcpServerSettingSection);
          },
        }),
      createProviderOnboarding,
    }),
  );

  performanceBaseline.recordActivationComplete();
}

export function deactivate(): void {}
