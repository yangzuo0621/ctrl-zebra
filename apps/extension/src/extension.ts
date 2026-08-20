import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { env, memoryUsage, platform } from "node:process";
import type {
  FileCreatePlan,
  FileDeletePlan,
  FileRenamePlan,
  WorkspaceEditPlan,
} from "@ctrl-zebra/core";
import { ControlledMcpClient } from "@ctrl-zebra/mcp-client";
import {
  type ExtensionToWebviewMessage,
  isApprovedExternalLink,
  persistenceCheckpointsDirectory,
  persistenceSessionsDirectory,
  protocolVersion,
} from "@ctrl-zebra/protocol";
import {
  createGeminiModelGateway,
  createOpenAICompatibleModelGateway,
  createOpenAIModelGateway,
} from "@ctrl-zebra/providers";
import {
  ConfigurationTarget,
  commands,
  type ExtensionContext,
  languages,
  Position,
  ProgressLocation,
  Uri,
  env as vscodeEnv,
  version as vscodeVersion,
  window,
  workspace,
} from "vscode";

import {
  createGeminiApiKeySecretStorage,
  createOpenAIApiKeySecretStorage,
  createOpenAICompatibleApiKeySecretStorage,
  createProviderApiKeyPresenceReader,
  createProviderApiKeySecretReader,
} from "./adapters/api-key-secret-storage.js";
import { createLocalWorkspaceUriCanonicalizer } from "./adapters/canonicalize-local-workspace-uri.js";
import { createVsCodeCheckpointRestorer } from "./adapters/create-vscode-checkpoint-restorer.js";
import { createVsCodeDiffPresenter } from "./adapters/create-vscode-diff-presenter.js";
import { createVsCodeFileCreateApplier } from "./adapters/create-vscode-file-create-applier.js";
import { createVsCodeFileDeleteApplier } from "./adapters/create-vscode-file-delete-applier.js";
import { createVsCodeFileRenameApplier } from "./adapters/create-vscode-file-rename-applier.js";
import { createVsCodeWorkspaceEditApplier } from "./adapters/create-vscode-workspace-edit-applier.js";
import { toDiagnosticsRuntime } from "./adapters/diagnostics-export.js";
import { FileCreateConflictError } from "./adapters/file-create-applier.js";
import { FileDeleteConflictError } from "./adapters/file-delete-applier.js";
import { FileRenameConflictError } from "./adapters/file-rename-applier.js";
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
import {
  readRunBudgetConfiguration,
  runBudgetSettingSection,
} from "./adapters/run-budget-configuration.js";
import {
  readSessionRetentionConfiguration,
  sessionRetentionSettingSection,
} from "./adapters/session-retention-configuration.js";
import { SpawnCommandRunner } from "./adapters/spawn-command-runner.js";
import { createStructuredLogger } from "./adapters/structured-logger.js";
import { VscodeBoundedTextStorage } from "./adapters/vscode-bounded-text-storage.js";
import { createWorkspaceCheckpointStoreProvider } from "./adapters/vscode-checkpoint-storage.js";
import { VsCodeDiagnostics } from "./adapters/vscode-diagnostics.js";
import { createVscodeDiagnosticsExportPort } from "./adapters/vscode-diagnostics-export.js";
import { VsCodeEditorContext } from "./adapters/vscode-editor-context.js";
import { isVscodeFileNotFound } from "./adapters/vscode-file-system-error.js";
import { VsCodeLanguageServices } from "./adapters/vscode-language-services.js";
import {
  clearConfigurationEntries,
  clearMemento,
  clearProviderSecrets,
  mcpConfigurationEntries,
  nonMcpConfigurationEntries,
} from "./adapters/vscode-local-data.js";
import { VsCodeProposeFileCreateWorkspace } from "./adapters/vscode-propose-file-create-workspace.js";
import { VsCodeProposeFileDeleteRenameWorkspace } from "./adapters/vscode-propose-file-delete-rename-workspace.js";
import {
  readSupportedWorkspaceText,
  UnsupportedWorkspaceTextError,
  VsCodeProposeFileEditWorkspace,
} from "./adapters/vscode-propose-file-edit-workspace.js";
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
import {
  classifyDiagnosticsErrorCategory,
  DiagnosticsExportController,
} from "./controllers/diagnostic-export.js";
import {
  createEditorContextSourceFingerprint,
  EditorContextEntryController,
} from "./controllers/editor-context-entry.js";
import { FileCreateApprovalWorkflow } from "./controllers/file-create-approval-workflow.js";
import { FileDeleteApprovalWorkflow } from "./controllers/file-delete-approval-workflow.js";
import { FileEditApprovalWorkflow } from "./controllers/file-edit-approval-workflow.js";
import { FileRenameApprovalWorkflow } from "./controllers/file-rename-approval-workflow.js";
import {
  clearLocalDataCommandId,
  combineLocalDataClearCounts,
  LocalDataClearController,
  type LocalDataClearCounts,
  type LocalDataClearReport,
} from "./controllers/local-data-clear.js";
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
  ProviderApiKeyOperationCoordinator,
  registerProviderApiKeyCommands,
  saveGeminiApiKeyCommandId,
  saveOpenAIApiKeyCommandId,
  saveOpenAICompatibleApiKeyCommandId,
} from "./controllers/provider-api-key-command.js";
import { registerProviderConnectionCheckCommand } from "./controllers/provider-connection-check-command.js";
import {
  type ProviderOnboardingActionResult,
  ProviderOnboardingController,
} from "./controllers/provider-onboarding-controller.js";
import {
  createWorkspaceToolRegistryProvider,
  selectWorkspaceRoot,
  WorkspaceRootSelectionError,
} from "./controllers/readonly-tool-registry.js";
import {
  getAgentRuntimeDiagnosticLogEntry,
  getRunFailureLogEntry,
} from "./controllers/run-error-mapper.js";
import { createSessionRecoveryActions } from "./controllers/session-recovery.js";
import { ToolApprovalWorkflowRouter } from "./controllers/tool-approval-workflow.js";
import type { HostRunStatus } from "./controllers/webview-run-message-handler.js";
import {
  selectCommandEnvironment,
  WorkspaceCommandExecutor,
} from "./controllers/workspace-command-executor.js";
import { WorkspaceEditApprovalWorkflow } from "./controllers/workspace-edit-approval-workflow.js";
import { WorkspaceFileReferenceActions } from "./controllers/workspace-file-reference-actions.js";
import { createWorkspaceTrustPolicy } from "./controllers/workspace-trust-policy.js";

export function activate(context: ExtensionContext): void {
  const activationStartedAt = performance.now();
  const logger = createStructuredLogger(window.createOutputChannel("CtrlZebra", { log: true }));
  const performanceOutput =
    env.CTRL_ZEBRA_PERFORMANCE_BENCHMARK === "1" ? env.CTRL_ZEBRA_PERFORMANCE_OUTPUT : undefined;
  const performanceBaseline = new PerformanceBaselineRecorder({
    startedAt: activationStartedAt,
    now: () => performance.now(),
    readRssBytes: () => memoryUsage.rss(),
    logger,
    onSample:
      performanceOutput === undefined
        ? undefined
        : (sample) => appendFileSync(performanceOutput, `${JSON.stringify(sample)}\n`, "utf8"),
  });
  const secrets = createProviderApiKeySecretReader(context.secrets);
  const providerApiKeyPresence = createProviderApiKeyPresenceReader(context.secrets);
  const providerApiKeyStorages = {
    openai: createOpenAIApiKeySecretStorage(context.secrets),
    gemini: createGeminiApiKeySecretStorage(context.secrets),
    "openai-compatible": createOpenAICompatibleApiKeySecretStorage(context.secrets),
  } as const;
  const providerApiKeyCoordinator = new ProviderApiKeyOperationCoordinator();
  const canonicalize = createLocalWorkspaceUriCanonicalizer(realpath, Uri.file);
  const getSelectedRoot = () =>
    selectWorkspaceRoot(workspace.workspaceFolders?.map((folder) => folder.uri) ?? []);
  const createCurrentScope = () => new WorkspaceScope(getSelectedRoot(), canonicalize);
  const workspaceTrust = createWorkspaceTrustPolicy(() => workspace.isTrusted);
  const isEditorContextEnabled = () =>
    workspace.getConfiguration("ctrlZebra.editorContext").get<boolean>("enabled", false) === true;
  const mcpStartupApproval = new McpStartupApproval({
    now: () => new Date(),
    showWarningMessage: (message, options, item) =>
      window.showWarningMessage(message, options, item),
  });
  let diagnosticsExport: DiagnosticsExportController;
  let currentRunStatus: HostRunStatus = "idle";
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
    createClient: (port, options) => new ControlledMcpClient(port, options),
    getReservedToolNames: () => [
      "list_files",
      "propose_file_edit",
      "propose_file_create",
      "propose_file_delete",
      "propose_file_rename",
      "propose_workspace_edit",
      "read_file",
      "read_editor_context",
      "get_diagnostics",
      "find_definition",
      "find_references",
      "list_symbols",
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
      if (entry.outcome === "failure") {
        diagnosticsExport.recordErrorCategory("mcp");
      }
    },
  });
  diagnosticsExport = new DiagnosticsExportController({
    createId: randomUUID,
    readInput: () => {
      let provider: unknown = "unknown";
      try {
        provider = readProviderOnboardingConfiguration(
          workspace.getConfiguration("ctrlZebra.provider"),
        ).provider;
      } catch {
        // A corrupt Provider setting is represented as unknown in the export.
      }

      const mcp = mcpConnection.getState();
      return {
        extensionVersion: context.extension.packageJSON?.version,
        vscodeVersion,
        platform,
        provider,
        errors: [],
        mcp: {
          status:
            mcp.status === "disconnected" && mcp.server === undefined && mcp.generation === 0
              ? "unconfigured"
              : mcp.status,
          generation: mcp.generation,
          protocolMode: mcp.configuredMode,
          ...(mcp.connection?.protocolVersion === undefined
            ? {}
            : { negotiatedVersion: mcp.connection.protocolVersion }),
          ...(mcp.error === undefined ? {} : { errorCategory: "mcp" }),
        },
        runtime: toDiagnosticsRuntime(performanceBaseline.getSnapshot(), currentRunStatus),
      };
    },
    target: createVscodeDiagnosticsExportPort(
      (options) => window.showSaveDialog(options),
      workspace.fs,
    ),
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
  const validateWorkspaceEditPlan = async (
    plan: WorkspaceEditPlan,
    signal: AbortSignal,
  ): Promise<void> => {
    const scope = createCurrentScope();
    for (const file of plan.files) {
      const canonical = await scope.validate(Uri.parse(file.uri, true), signal);
      signal.throwIfAborted();
      if (canonical.toString() !== file.uri) {
        throw new WorkspaceScopeError("canonicalization-failed");
      }
    }
  };
  const workspaceEditApprovalWorkflow = new WorkspaceEditApprovalWorkflow({
    createId: randomUUID,
    now: () => new Date(),
    async bindPlan(plan, signal) {
      const root = getSelectedRoot();
      const scope = new WorkspaceScope(root, canonicalize);
      for (const file of plan.files) {
        const canonical = await scope.validate(Uri.parse(file.uri, true), signal);
        signal.throwIfAborted();
        if (canonical.toString() !== file.uri) {
          throw new WorkspaceScopeError("canonicalization-failed");
        }
      }
      return root.toString();
    },
    validatePlan: validateWorkspaceEditPlan,
    async presentDiff(plan, signal) {
      await validateWorkspaceEditPlan(plan, signal);
      for (const file of plan.files) {
        await diffPresenter.present(file, signal, { requireBoundedText: true });
      }
    },
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
          { requireSupportedText: true },
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
  const validateFileCreatePlan = async (
    plan: FileCreatePlan,
    signal: AbortSignal,
  ): Promise<void> => {
    const root = getSelectedRoot();
    const scope = new WorkspaceScope(root, canonicalize);
    const canonical = await scope.validateNewFile(Uri.parse(plan.uri, true), signal);
    if (canonical.toString() !== plan.uri) {
      throw new WorkspaceScopeError("canonicalization-failed");
    }
    const target = await workspace.fs.stat(canonical).then(
      () => true,
      (error) => {
        if (isVscodeFileNotFound(error)) return false;
        throw error;
      },
    );
    if (target) {
      throw new FileCreateConflictError();
    }
  };
  const fileCreateApprovalWorkflow = new FileCreateApprovalWorkflow({
    createId: randomUUID,
    now: () => new Date(),
    hashText,
    async bindPlan(plan, signal) {
      const root = getSelectedRoot();
      const scope = new WorkspaceScope(root, canonicalize);
      const canonical = await scope.validateNewFile(Uri.parse(plan.uri, true), signal);
      if (canonical.toString() !== plan.uri) {
        throw new WorkspaceScopeError("canonicalization-failed");
      }
      return root.toString();
    },
    validatePlan: validateFileCreatePlan,
    presentDiff: async (plan, signal) => {
      await validateFileCreatePlan(plan, signal);
      await diffPresenter.presentTextPair(plan.path, "", plan.content, signal);
    },
    async applyPlan(plan, ownership, signal) {
      try {
        const checkpointStore = await selectCheckpointStore();
        signal.throwIfAborted();
        await createVsCodeFileCreateApplier(
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
        if (error instanceof FileCreateConflictError || error instanceof WorkspaceScopeError) {
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
  const validateFileDeletePlan = async (
    plan: FileDeletePlan,
    signal: AbortSignal,
  ): Promise<void> => {
    const canonical = await createCurrentScope().validate(Uri.parse(plan.uri, true), signal);
    if (canonical.toString() !== plan.uri) {
      throw new WorkspaceScopeError("canonicalization-failed");
    }
    let text: string;
    try {
      text = await readSupportedWorkspaceText(canonical, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof UnsupportedWorkspaceTextError) {
        throw new FileDeleteConflictError();
      }
      throw error;
    }
    if (hashText(text) !== plan.beforeHash) throw new FileDeleteConflictError();
  };
  const fileDeleteApprovalWorkflow = new FileDeleteApprovalWorkflow({
    createId: randomUUID,
    now: () => new Date(),
    hashText,
    async bindPlan(plan, signal) {
      const root = getSelectedRoot();
      const canonical = await new WorkspaceScope(root, canonicalize).validate(
        Uri.parse(plan.uri, true),
        signal,
      );
      if (canonical.toString() !== plan.uri) {
        throw new WorkspaceScopeError("canonicalization-failed");
      }
      return root.toString();
    },
    validatePlan: validateFileDeletePlan,
    presentDiff: (plan, signal) =>
      diffPresenter.presentTextPair(plan.path, plan.beforeContent, "", signal),
    async applyPlan(plan, ownership, signal) {
      try {
        const checkpointStore = await selectCheckpointStore();
        signal.throwIfAborted();
        await createVsCodeFileDeleteApplier(
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
        if (error instanceof FileDeleteConflictError || error instanceof WorkspaceScopeError) {
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
  const validateFileRenamePlan = async (
    plan: FileRenamePlan,
    signal: AbortSignal,
  ): Promise<void> => {
    const scope = createCurrentScope();
    const source = await scope.validate(Uri.parse(plan.sourceUri, true), signal);
    signal.throwIfAborted();
    const target = await scope.validateNewFile(Uri.parse(plan.targetUri, true), signal);
    signal.throwIfAborted();
    if (source.toString() !== plan.sourceUri || target.toString() !== plan.targetUri) {
      throw new WorkspaceScopeError("canonicalization-failed");
    }
    let sourceText: string;
    try {
      sourceText = await readSupportedWorkspaceText(source, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof UnsupportedWorkspaceTextError) {
        throw new FileRenameConflictError();
      }
      throw error;
    }
    if (hashText(sourceText) !== plan.beforeHash) throw new FileRenameConflictError();
    try {
      await workspace.fs.stat(target);
      throw new FileRenameConflictError();
    } catch (error) {
      signal.throwIfAborted();
      if (!isVscodeFileNotFound(error)) throw error;
    }
  };
  const fileRenameApprovalWorkflow = new FileRenameApprovalWorkflow({
    createId: randomUUID,
    now: () => new Date(),
    hashText,
    async bindPlan(plan, signal) {
      const root = getSelectedRoot();
      const scope = new WorkspaceScope(root, canonicalize);
      const source = await scope.validate(Uri.parse(plan.sourceUri, true), signal);
      signal.throwIfAborted();
      const target = await scope.validateNewFile(Uri.parse(plan.targetUri, true), signal);
      signal.throwIfAborted();
      if (source.toString() !== plan.sourceUri || target.toString() !== plan.targetUri) {
        throw new WorkspaceScopeError("canonicalization-failed");
      }
      return root.toString();
    },
    validatePlan: validateFileRenamePlan,
    presentDiff: (plan, signal) =>
      diffPresenter.presentTextPair(
        `${plan.sourcePath} → ${plan.targetPath}`,
        plan.beforeContent,
        plan.beforeContent,
        signal,
      ),
    async applyPlan(plan, ownership, signal) {
      try {
        const checkpointStore = await selectCheckpointStore();
        signal.throwIfAborted();
        await createVsCodeFileRenameApplier(
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
        if (error instanceof FileRenameConflictError || error instanceof WorkspaceScopeError) {
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
    fileCreateApprovalWorkflow,
    fileDeleteApprovalWorkflow,
    fileRenameApprovalWorkflow,
    workspaceEditApprovalWorkflow,
  );
  const editorContext = new VsCodeEditorContext({
    getActiveEditor: () => window.activeTextEditor,
    getSelectedRoot: () => getSelectedRoot(),
    createScope: (root) => new WorkspaceScope(root, canonicalize),
    isEnabled: isEditorContextEnabled,
    isTrusted: () => workspace.isTrusted,
  });
  const getEditorContextAvailability = async (
    scope: "selection" | "active-editor",
  ): Promise<
    | "disabled"
    | "no-editor"
    | "no-selection"
    | "untrusted-workspace"
    | "unsupported-document"
    | "outside-workspace"
    | "unavailable"
    | undefined
  > => {
    if (!isEditorContextEnabled()) return "disabled";
    if (!workspace.isTrusted) return "untrusted-workspace";
    const editor = window.activeTextEditor;
    if (editor === undefined) return "no-editor";
    if (scope === "selection" && editor.selection === undefined) return "no-selection";
    if (editor.document === undefined || editor.document.uri === undefined) {
      return "unsupported-document";
    }
    if (editor.document.uri.scheme !== "file") return "unsupported-document";
    const root = getSelectedRoot();
    if (root === undefined) return "outside-workspace";
    try {
      await new WorkspaceScope(root, canonicalize).validate(
        editor.document.uri,
        new AbortController().signal,
      );
    } catch (error) {
      if (error instanceof WorkspaceScopeError && error.code === "outside-workspace") {
        return "outside-workspace";
      }
      if (error instanceof WorkspaceScopeError && error.code === "invalid-uri") {
        return "unsupported-document";
      }
      return "unavailable";
    }
    return undefined;
  };
  const editorContextEntry = new EditorContextEntryController({
    readContext: (scope, signal) => editorContext.readEditorContext({ scope }, signal),
    isEnabled: isEditorContextEnabled,
    getAvailability: getEditorContextAvailability,
    getSourceFingerprint: (scope) => {
      const editor = window.activeTextEditor;
      if (editor === undefined || editor.document === undefined) return undefined;
      return createEditorContextSourceFingerprint({
        scheme: editor.document.uri.scheme,
        authority: editor.document.uri.authority,
        path: editor.document.uri.path,
        documentVersion: editor.document.version,
        languageId: editor.document.languageId,
        ...(scope === "selection" && editor.selection !== undefined
          ? {
              range: {
                start: editor.selection.start,
                end: editor.selection.end,
              },
            }
          : {}),
      });
    },
    createId: randomUUID,
    focusView: () => commands.executeCommand("ctrlZebra.agentView.focus"),
  });
  const workspaceFileReferenceActions = new Set<WorkspaceFileReferenceActions>();
  const createWorkspaceFileReferenceActions = () => {
    let actions: WorkspaceFileReferenceActions | undefined;
    actions = new WorkspaceFileReferenceActions({
      getSelectedRoot: () => {
        try {
          return getSelectedRoot();
        } catch (error) {
          if (error instanceof WorkspaceRootSelectionError && error.code === "missing-workspace") {
            return undefined;
          }
          throw error;
        }
      },
      createScope: (root) => new WorkspaceScope(root, canonicalize),
      joinPath: joinWorkspacePath,
      findFiles: findWorkspaceFiles,
      readPrefix: readWorkspaceFilePrefix,
      getFileFingerprint: async (uri) => {
        const stat = await workspace.fs.stat(uri);
        const document = workspace.textDocuments.find(
          (candidate) => candidate.uri.toString() === uri.toString(),
        );
        return `${stat.mtime}:${stat.size}:${document?.version ?? ""}`;
      },
      getLanguageId: (uri) =>
        workspace.textDocuments.find((document) => document.uri.toString() === uri.toString())
          ?.languageId,
      getDocumentVersion: (uri) =>
        workspace.textDocuments.find((document) => document.uri.toString() === uri.toString())
          ?.version,
      createId: randomUUID,
      onDispose: () => {
        if (actions !== undefined) workspaceFileReferenceActions.delete(actions);
      },
    });
    workspaceFileReferenceActions.add(actions);
    return actions;
  };
  let editorTransitionToken = 0;
  const notifyEditorTransition = (
    reason: "editor-changed" | "selection-changed" | "document-changed",
    scope: "selection" | "active-editor",
  ) => {
    editorTransitionToken += 1;
    const token = editorTransitionToken;
    void getEditorContextAvailability(scope).then(
      (availability) => {
        if (token !== editorTransitionToken) return;
        if (availability === "untrusted-workspace") {
          editorContextEntry.invalidate("trust-lost");
        } else if (
          availability === "unsupported-document" ||
          availability === "outside-workspace" ||
          availability === "no-editor"
        ) {
          editorContextEntry.invalidate("editor-unavailable");
        } else {
          editorContextEntry.notifyTransition([reason]);
        }
      },
      () => {
        if (token === editorTransitionToken) editorContextEntry.invalidate("editor-unavailable");
      },
    );
  };
  const diagnostics = new VsCodeDiagnostics({
    getActiveEditor: () => window.activeTextEditor,
    getSelectedRoot: () => getSelectedRoot(),
    createScope: (root) => new WorkspaceScope(root, canonicalize),
    joinPath: joinWorkspacePath,
    getDiagnostics: (uri) =>
      uri === undefined ? languages.getDiagnostics() : languages.getDiagnostics(uri),
    getDocument: (uri) =>
      workspace.textDocuments.find((document) => document.uri.toString() === uri.toString()),
    isTrusted: () => workspace.isTrusted,
    isEnabled: () => true,
  });
  const languageServices = new VsCodeLanguageServices({
    getSelectedRoot: () => getSelectedRoot(),
    createScope: (root) => new WorkspaceScope(root, canonicalize),
    joinPath: joinWorkspacePath,
    getDocument: (uri) =>
      workspace.textDocuments.find((document) => document.uri.toString() === uri.toString()),
    executeDefinitionProvider: async (uri, position) =>
      commands.executeCommand<unknown>(
        "vscode.executeDefinitionProvider",
        uri,
        new Position(position.line, position.character),
      ),
    executeReferenceProvider: async (uri, position) =>
      commands.executeCommand<unknown>(
        "vscode.executeReferenceProvider",
        uri,
        new Position(position.line, position.character),
      ),
    executeDocumentSymbolProvider: async (uri) =>
      commands.executeCommand<unknown>("vscode.executeDocumentSymbolProvider", uri),
    isTrusted: () => workspace.isTrusted,
    isEnabled: () => true,
  });
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
    createProposeFileCreateWorkspace: (root, scope) =>
      new VsCodeProposeFileCreateWorkspace(root, scope, joinWorkspacePath),
    createProposeFileDeleteWorkspace: (root, scope) =>
      new VsCodeProposeFileDeleteRenameWorkspace(root, scope, joinWorkspacePath),
    createProposeFileRenameWorkspace: (root, scope) =>
      new VsCodeProposeFileDeleteRenameWorkspace(root, scope, joinWorkspacePath),
    createProposeWorkspaceEditWorkspace: (root, scope) =>
      new VsCodeProposeFileEditWorkspace(root, scope, joinWorkspacePath, {
        requireSupportedText: true,
      }),
    commandExecutor,
    workspaceTrust,
    editorContext,
    diagnostics,
    languageServices,
  });
  const selectSessionRepository = createWorkspaceSessionRepositoryProvider(
    context.storageUri,
    workspace.fs,
  );
  const workspaceLocalStorage =
    context.storageUri === undefined
      ? undefined
      : new VscodeBoundedTextStorage({
          root: context.storageUri,
          fileSystem: workspace.fs,
          joinPath: Uri.joinPath,
          isFileNotFound: isVscodeFileNotFound,
        });
  const globalLocalStorage = new VscodeBoundedTextStorage({
    root: context.globalStorageUri,
    fileSystem: workspace.fs,
    joinPath: Uri.joinPath,
    isFileNotFound: isVscodeFileNotFound,
  });
  const localDataClear = new LocalDataClearController({
    async clearSessions() {
      if (context.storageUri === undefined) return { deleted: 0, failed: 0 };
      const repository = await selectSessionRepository();
      return (await repository.clear?.()) ?? { deleted: 0, failed: 1 };
    },
    async clearCheckpoints() {
      if (context.storageUri === undefined) return { deleted: 0, failed: 0 };
      const store = await selectCheckpointStore();
      return (await store.clear?.(new AbortController().signal)) ?? { deleted: 0, failed: 1 };
    },
    async clearTemporaryFiles() {
      const reports: LocalDataClearCounts[] = [];
      if (workspaceLocalStorage !== undefined) {
        try {
          reports.push(
            await workspaceLocalStorage.clearRootEntries([
              persistenceSessionsDirectory,
              persistenceCheckpointsDirectory,
            ]),
          );
        } catch {
          reports.push({ deleted: 0, failed: 1 });
        }
      }
      try {
        reports.push(await globalLocalStorage.clearRootEntries([]));
      } catch {
        reports.push({ deleted: 0, failed: 1 });
      }
      return reports.reduce(combineLocalDataClearCounts, { deleted: 0, failed: 0 });
    },
    async clearCaches() {
      return { deleted: 0, failed: 0 };
    },
    async clearProviderSecret() {
      return await clearProviderSecrets(providerApiKeyStorages);
    },
    async clearProviderConfiguration() {
      return await clearConfigurationEntries(
        { getConfiguration: (section, scope) => workspace.getConfiguration(section, scope) },
        nonMcpConfigurationEntries,
      );
    },
    async clearMcpConfiguration() {
      return await clearConfigurationEntries(
        { getConfiguration: (section, scope) => workspace.getConfiguration(section, scope) },
        mcpConfigurationEntries,
      );
    },
    async clearOtherLocalState() {
      const reports: LocalDataClearCounts[] = [];
      try {
        reports.push(await clearMemento(context.globalState));
      } catch {
        reports.push({ deleted: 0, failed: 1 });
      }
      try {
        reports.push(await clearMemento(context.workspaceState));
      } catch {
        reports.push({ deleted: 0, failed: 1 });
      }
      return reports.reduce(combineLocalDataClearCounts, { deleted: 0, failed: 0 });
    },
  });
  localDataClear.registerOperationLock(
    () => providerApiKeyCoordinator.acquireExclusive(),
    "running",
  );
  localDataClear.registerOperationLock(async () => {
    return await mcpConnection.acquireExclusive();
  }, "resource");

  async function requestLocalDataClear(
    requestId?: string,
    post?: (message: ExtensionToWebviewMessage) => void,
  ): Promise<LocalDataClearReport | undefined> {
    const confirmation = await window.showWarningMessage(
      "This permanently deletes CtrlZebra Sessions, Checkpoints, temporary files, caches, Provider API keys, MCP/Provider settings, and other CtrlZebra local state. It does not delete workspace files, user code, VS Code data outside CtrlZebra, or other extensions. Continue?",
      { modal: true },
      "Clear CtrlZebra data",
    );
    if (confirmation !== "Clear CtrlZebra data") {
      if (requestId !== undefined && post !== undefined) {
        post({
          protocolVersion,
          type: "extension/local-data-clear-result",
          requestId,
          outcome: "cancelled",
          categories: [],
          message: "CtrlZebra local-data clearing was cancelled.",
        });
      }
      return undefined;
    }

    const report = await localDataClear.run();
    if (requestId !== undefined && post !== undefined) {
      post({
        protocolVersion,
        type: "extension/local-data-clear-result",
        requestId,
        outcome: report.outcome,
        categories: report.categories.map((category) => ({ ...category })),
        message:
          report.outcome === "completed"
            ? "CtrlZebra local data was cleared."
            : "Some CtrlZebra local data could not be cleared. Retry to continue.",
      });
    }
    if (report.outcome === "completed") {
      void window.showInformationMessage("CtrlZebra local data was cleared.");
    } else {
      void window.showWarningMessage(
        "Some CtrlZebra local data could not be cleared. Retry the command to continue.",
      );
    }
    return report;
  }

  const chatRunner = createSelectingChatRunner({
    readRunTokenBudget: () =>
      readRunBudgetConfiguration(workspace.getConfiguration(runBudgetSettingSection)),
    diagnosticSink: {
      emit: (diagnostic) => {
        const entry = getAgentRuntimeDiagnosticLogEntry(diagnostic);
        diagnosticsExport.recordErrorCategory(classifyDiagnosticsErrorCategory(entry.errorCode));
        logger.error(entry);
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
              mcpSnapshot.tools.map((tool) => {
                const connection = mcpConnection.getState().connection;
                const provenance =
                  connection?.configuredMode === undefined || connection.negotiated === undefined
                    ? undefined
                    : connection.negotiated.era === "modern"
                      ? {
                          configuredMode: connection.configuredMode,
                          negotiatedEra: "modern" as const,
                          negotiatedVersion: "2026-07-28" as const,
                        }
                      : connection.configuredMode === "dual"
                        ? {
                            configuredMode: "dual" as const,
                            negotiatedEra: "legacy" as const,
                            negotiatedVersion: "2025-11-25" as const,
                          }
                        : undefined;
                return [
                  tool.registryName,
                  {
                    serverId: mcpSnapshot.server.serverId,
                    displayName: mcpSnapshot.server.displayName,
                    registryName: tool.registryName,
                    mcpToolName: tool.mcpToolName,
                    generation: mcpSnapshot.generation,
                    ...(provenance === undefined ? {} : { provenance }),
                  },
                ] as const;
              }),
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
        providerApiKeyCoordinator,
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
          if (!configuration.endpointValid) {
            return {
              provider: configuration.provider,
              apiKeyConfigured: false,
              modelConfigured: false,
            };
          }
          const apiKeyConfigured = configuration.apiKeyRequired
            ? await readApiKeyConfigured(configuration.provider)
            : true;
          if (apiKeyConfigured === undefined) return undefined;
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
      async run(action): Promise<ProviderOnboardingActionResult | undefined> {
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
            return await commands.executeCommand<ProviderOnboardingActionResult>(
              selectModelCommandId,
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
          return await commands.executeCommand<ProviderOnboardingActionResult | undefined>(
            commandId,
          );
        } catch {
          return { status: "failed", code: "internal" };
        }
      },
    });

  async function readApiKeyConfigured(provider: Parameters<typeof secrets.read>[0]) {
    let presence: Awaited<ReturnType<typeof providerApiKeyPresence.read>> | undefined;
    try {
      presence = await providerApiKeyCoordinator.run(provider, () =>
        providerApiKeyPresence.read(provider),
      );
    } catch {
      return undefined;
    }
    if (presence === undefined || presence === "unavailable") return undefined;
    return presence === "present";
  }

  context.subscriptions.push(
    logger,
    {
      dispose() {
        providerApiKeyCoordinator.dispose();
      },
    },
    workspaceTools,
    editorContext,
    diagnostics,
    languageServices,
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
      if (event.affectsConfiguration("ctrlZebra.provider")) {
        providerApiKeyCoordinator.invalidate();
      }
      if (event.affectsConfiguration(`${mcpServerSettingSection}.${mcpServerSettingName}`)) {
        mcpConnection.markConfigurationStale();
      }
      if (event.affectsConfiguration("ctrlZebra.editorContext.enabled")) {
        editorContextEntry.onSettingChanged(isEditorContextEnabled());
      }
    }),
    workspace.onDidChangeWorkspaceFolders(() => {
      mcpConnection.markConfigurationStale();
      editorContextEntry.invalidate("workspace-changed");
      for (const actions of workspaceFileReferenceActions) {
        actions.clearForBoundaryChange("workspace-changed");
      }
    }),
    workspace.onDidGrantWorkspaceTrust(() => {
      mcpConnection.handleWorkspaceTrustChange();
      for (const actions of workspaceFileReferenceActions) {
        actions.clearForBoundaryChange("trust-lost");
      }
    }),
    window.onDidChangeActiveTextEditor((editor) => {
      if (editor === undefined) {
        editorTransitionToken += 1;
        editorContextEntry.invalidate("editor-unavailable");
        return;
      }
      notifyEditorTransition("editor-changed", "active-editor");
    }),
    window.onDidChangeTextEditorSelection(() =>
      notifyEditorTransition("selection-changed", "selection"),
    ),
    workspace.onDidChangeTextDocument((event) => {
      notifyEditorTransition("document-changed", "active-editor");
      for (const actions of workspaceFileReferenceActions) {
        actions.notifyChanged(event.document.uri, "changed");
      }
    }),
    workspace.onDidDeleteFiles((event) => {
      for (const actions of workspaceFileReferenceActions) {
        for (const uri of event.files) actions.notifyChanged(uri, "deleted");
      }
    }),
    {
      dispose() {
        editorContextEntry.dispose();
      },
    },
    commands.registerCommand("ctrlZebra.askAboutSelection", async () => {
      await editorContextEntry.ask("selection");
    }),
    commands.registerCommand("ctrlZebra.askAboutFile", async () => {
      await editorContextEntry.ask("active-editor");
    }),
    registerMcpServerCommands({
      controller: mcpConnection,
      registerCommand: (commandId, handler) => commands.registerCommand(commandId, handler),
    }),
    commands.registerCommand(clearLocalDataCommandId, () => requestLocalDataClear()),
    registerProviderApiKeyCommands({
      coordinator: providerApiKeyCoordinator,
      storages: providerApiKeyStorages,
      presence: providerApiKeyPresence,
      registerCommand: (commandId, handler) => commands.registerCommand(commandId, handler),
      showInputBox: (options) => window.showInputBox(options),
      showWarningMessage: (message, options, item) =>
        window.showWarningMessage(message, options, item),
      showInformationMessage: (message) => window.showInformationMessage(message),
      showErrorMessage: (message) => window.showErrorMessage(message),
    }),
    registerModelSelectionCommand({
      isBlocked: () => localDataClear.isRunning,
      readConfiguration() {
        const settings = workspace.getConfiguration("ctrlZebra.provider");
        return readProviderSelectionConfiguration({
          get: (setting) => settings.get(setting),
        });
      },
      secrets,
      providerApiKeyCoordinator,
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
    registerProviderConnectionCheckCommand({
      readConfiguration() {
        const settings = workspace.getConfiguration("ctrlZebra.provider");
        return readProviderConfiguration({
          get: (setting) => settings.get(setting),
        });
      },
      secrets,
      providerApiKeyCoordinator,
      registerCommand: (commandId, handler) => commands.registerCommand(commandId, handler),
      runWithProgress: (task) =>
        window.withProgress(
          {
            location: ProgressLocation.Notification,
            cancellable: true,
            title: "CtrlZebra: Check Provider Connection",
          },
          (_progress, token) => task(token),
        ),
      showInformationMessage: (message) => window.showInformationMessage(message),
      showErrorMessage: (message) => window.showErrorMessage(message),
      log: (entry) => {
        if (entry.outcome === "failure") {
          logger.error(entry);
        } else {
          logger.info(entry);
        }
      },
    }),
    registerAgentView({
      extensionUri: context.extensionUri,
      registrar: (viewId, provider) => window.registerWebviewViewProvider(viewId, provider),
      chatRunner,
      approvalActions: {
        showDiff: (_requestId, approvalId) => approvalWorkflow.showDiff(approvalId),
        decide: (_requestId, approvalId, decision) => approvalWorkflow.decide(approvalId, decision),
      },
      sessionActions: createSessionRecoveryActions(
        selectSessionRepository,
        undefined,
        selectCheckpointStore,
        {
          readPolicy: () =>
            readSessionRetentionConfiguration(
              workspace.getConfiguration(sessionRetentionSettingSection),
            ),
          onCleanup: (report) => {
            if (report.outcome !== "completed") {
              return;
            }
            if (report.deletedSessions > 0 || report.deletedCheckpoints > 0) {
              void window.showInformationMessage(
                `Automatic cleanup removed ${report.deletedSessions} expired Session${report.deletedSessions === 1 ? "" : "s"} and ${report.deletedCheckpoints} owned Checkpoint${report.deletedCheckpoints === 1 ? "" : "s"}.`,
              );
            }
            if (report.failedSessions > 0 || report.failedCheckpoints > 0) {
              void window.showWarningMessage(
                "Automatic Session cleanup could not remove all expired local data. Retry by refreshing Session history.",
              );
            }
          },
          onFailure: () => {
            void window.showWarningMessage(
              "Automatic Session cleanup is unavailable. Retry by refreshing Session history.",
            );
          },
        },
      ),
      checkpointActions,
      reportDeliveryFailure: () => {
        logger.error({
          event: "webview_response_delivery_failed",
          component: "agent_view",
          outcome: "failure",
          errorCode: "delivery_failed",
        });
      },
      reportReady: () => performanceBaseline.recordFirstWebviewDisplay(),
      reportRunFailure: (error) => {
        const failure = getRunFailureLogEntry(error);
        diagnosticsExport.recordErrorCategory(classifyDiagnosticsErrorCategory(failure.errorCode));
        logger.error(failure);
      },
      reportRunStatus: (status) => {
        currentRunStatus = status;
      },
      createResourceActions: () =>
        new McpResourceActions({ connection: mcpConnection, createId: randomUUID }),
      createPromptActions: () =>
        new McpPromptActions({ connection: mcpConnection, createId: randomUUID }),
      createWorkspaceFileReferenceActions,
      createMcpActions: () =>
        new McpWebviewActions({
          connection: mcpConnection,
          openSettings: () => {
            void commands.executeCommand("workbench.action.openSettings", mcpServerSettingSection);
          },
        }),
      createProviderOnboarding,
      editorContext: editorContextEntry,
      localDataClear: {
        controller: localDataClear,
        request: (requestId, post) => {
          void requestLocalDataClear(requestId, post);
        },
      },
      diagnosticsExport,
      openExternalLink: (href) => {
        if (!isApprovedExternalLink(href)) {
          return;
        }

        try {
          const uri = Uri.parse(href, true);
          if (uri.scheme !== "http" && uri.scheme !== "https") {
            return;
          }
          void vscodeEnv.openExternal(uri).then(undefined, () => {
            logger.error({
              event: "webview_external_link_failed",
              component: "agent_view",
              outcome: "failure",
              errorCode: "external_open_failed",
            });
          });
        } catch {
          logger.error({
            event: "webview_external_link_failed",
            component: "agent_view",
            outcome: "failure",
            errorCode: "external_uri_invalid",
          });
        }
      },
    }),
  );

  performanceBaseline.recordActivationComplete();
}

export function deactivate(): void {}
