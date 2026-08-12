import { ToolExecutionError, ToolUnavailableError } from "@ctrl-zebra/core";
import {
  Client,
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
  type ServerCapabilities,
  UnsupportedProtocolVersionError,
} from "@modelcontextprotocol/client";

import {
  type ControlledMcpClientOptions,
  type McpClientError,
  type McpClientErrorCode,
  type McpConnectedState,
  type McpConnectionState,
  type McpConnectOutcome,
  type McpDisconnectOutcome,
  type McpNegotiatedProtocol,
  type McpPromptDiscoveryContext,
  type McpResourceDiscoveryContext,
  type McpServerCapabilities,
  type McpStderrSnapshot,
  type McpStdioPort,
  type McpToolDiagnostic,
  type McpToolDiscoveryContext,
  mcpLegacyProtocolVersion,
  mcpProtocolVersion,
} from "./contracts.js";
import { createMcpClientError } from "./errors.js";
import { collectMcpCatalogPages, McpCatalogCollectionError } from "./mcp-catalog-collector.js";
import { McpCatalogRefresh } from "./mcp-catalog-refresh.js";
import { McpNegotiationFailure, negotiateMcpEra } from "./mcp-negotiation.js";
import {
  createMcpPromptCatalog,
  type McpPromptCatalogView,
  McpPromptError,
  type McpPromptResultView,
  normalizeMcpPromptResult,
  validateMcpPromptArguments,
} from "./mcp-prompt.js";
import {
  createMcpResourceCatalog,
  type McpResourceCatalogView,
  McpResourceError,
  type McpResourceSelection,
  type McpResourceSnapshotView,
  normalizeMcpResourceResult,
  resolveMcpResourceSelection,
} from "./mcp-resource.js";
import { createExternalJsonSchemaValidator } from "./mcp-tool-schema.js";
import {
  createMcpToolSnapshot,
  type McpToolSnapshot,
  McpToolSnapshotError,
  type McpToolSnapshotView,
} from "./mcp-tool-snapshot.js";
import { createControlledSdkClientOptions } from "./sdk-options.js";
import { SdkStdioTransport } from "./sdk-stdio-transport.js";

const emptyCapabilities: McpServerCapabilities = {
  tools: false,
  toolsListChanged: false,
  resources: false,
  resourceTemplates: false,
  resourcesListChanged: false,
  prompts: false,
  promptsListChanged: false,
};

export class ControlledMcpClient {
  private readonly sdkClient: Client;
  private readonly transport: SdkStdioTransport;
  private readonly protocolMode: NonNullable<ControlledMcpClientOptions["protocolMode"]>;
  private readonly probeTimeoutMs: number;
  private readonly exposeNegotiatedProjection: boolean;
  private readonly sdkClientName: string;
  private readonly sdkClientVersion: string;
  private status: McpConnectionState["status"] = "disconnected";
  private connectedState: McpConnectedState | undefined;
  private failure: McpClientError | undefined;
  private connectPromise: Promise<McpConnectOutcome> | undefined;
  private consumed = false;
  private toolDiagnostic: McpToolDiagnostic | undefined;
  private readonly toolValidator = createExternalJsonSchemaValidator();
  private readonly toolRefresh = new McpCatalogRefresh<McpToolDiscoveryContext, McpToolSnapshot>({
    sameContext: sameCatalogContext,
    isActive: () => this.status === "connected",
    createUnavailableError: () => new McpToolDiscoveryError("disconnected"),
    load: (context, controller, signal) => this.loadToolCatalog(context, controller, signal),
    commit: (_replacement, previous) => previous?.revoke(),
    clearReason: "MCP Tool snapshot connection generation ended.",
  });
  private readonly resourceRefresh = new McpCatalogRefresh<
    McpResourceDiscoveryContext,
    McpResourceCatalogView
  >({
    sameContext: sameCatalogContext,
    isActive: () => this.status === "connected",
    createUnavailableError: () => new McpResourceError("resource-unavailable"),
    load: (context, controller, signal) => this.loadResourceCatalog(context, controller, signal),
    clearReason: "MCP Resource catalog connection generation ended.",
  });
  private readonly promptRefresh = new McpCatalogRefresh<
    McpPromptDiscoveryContext,
    McpPromptCatalogView
  >({
    sameContext: sameCatalogContext,
    isActive: () => this.status === "connected",
    createUnavailableError: () => new McpPromptError("prompt-unavailable"),
    load: (context, controller, signal) => this.loadPromptCatalog(context, controller, signal),
    clearReason: "MCP Prompt catalog connection generation ended.",
  });
  private generation = 0;
  private activeGeneration = 0;
  private negotiatedEra: "modern" | "legacy" | undefined;

  constructor(port: McpStdioPort, options: ControlledMcpClientOptions = {}) {
    this.protocolMode = options.protocolMode ?? "modern-only";
    this.probeTimeoutMs = normalizeProbeTimeout(options.probeTimeoutMs);
    this.exposeNegotiatedProjection = options.protocolMode !== undefined;
    this.sdkClientName = options.clientName ?? "ctrl-zebra";
    this.sdkClientVersion = options.clientVersion ?? "0.0.0";
    this.sdkClient = new Client(
      {
        name: this.sdkClientName,
        version: this.sdkClientVersion,
      },
      createControlledSdkClientOptions(this.protocolMode),
    );
    // Keep the SDK's bounded MethodNotFound response explicit at this boundary.
    // No Server-initiated request is a CtrlZebra capability; the fallback must
    // not inspect params or dispatch into Core, Provider, Workspace, approval,
    // or persistence. The SDK still owns the JSON-RPC envelope and transport.
    this.sdkClient.fallbackRequestHandler = () => {
      throw new ProtocolError(ProtocolErrorCode.MethodNotFound, "Method not found");
    };
    this.transport = new SdkStdioTransport(port, (code) => this.handleTransportFailure(code));
    this.sdkClient.setNotificationHandler("notifications/tools/list_changed", async () => {
      if (
        this.connectedState?.capabilities.toolsListChanged !== true ||
        this.toolRefresh.getState().context === undefined
      ) {
        return;
      }
      try {
        await this.requestToolRefresh();
      } catch {
        // A rejected refresh retains the last complete current-generation snapshot.
      }
    });
    this.sdkClient.setNotificationHandler("notifications/resources/list_changed", async () => {
      if (
        this.connectedState?.capabilities.resourcesListChanged !== true ||
        this.resourceRefresh.getState().context === undefined
      ) {
        return;
      }
      try {
        await this.requestResourceRefresh();
      } catch {
        // A rejected refresh retains the last complete current-generation catalog.
      }
    });
    this.sdkClient.setNotificationHandler("notifications/prompts/list_changed", async () => {
      if (
        this.connectedState?.capabilities.promptsListChanged !== true ||
        this.promptRefresh.getState().context === undefined
      ) {
        return;
      }
      try {
        await this.requestPromptRefresh();
      } catch {
        // A rejected refresh retains the last complete current-generation catalog.
      }
    });
  }

  getState(): McpConnectionState {
    if (this.status === "connected" && this.connectedState !== undefined) {
      return this.connectedState;
    }

    if (this.status === "failed" && this.failure !== undefined) {
      return { status: "failed", capabilities: emptyCapabilities, error: this.failure };
    }

    return {
      status: this.status as "disconnected" | "connecting" | "disconnecting",
      capabilities: emptyCapabilities,
    };
  }

  getStderr(): McpStderrSnapshot {
    return this.transport.getStderr();
  }

  getToolSnapshot(): McpToolSnapshotView | undefined {
    return this.toolRefresh.getState().value?.view;
  }

  getToolDiagnostic(): McpToolDiagnostic | undefined {
    return this.toolDiagnostic;
  }

  getResourceCatalog(): McpResourceCatalogView | undefined {
    return this.resourceRefresh.getState().value;
  }

  getPromptCatalog(): McpPromptCatalogView | undefined {
    return this.promptRefresh.getState().value;
  }

  discoverPrompts(
    context: McpPromptDiscoveryContext,
    signal?: AbortSignal,
  ): Promise<McpPromptCatalogView> {
    if (this.status !== "connected" || this.connectedState === undefined) {
      return Promise.reject(new McpPromptError("prompt-unavailable"));
    }
    if (!Number.isSafeInteger(context.generation) || context.generation <= 0) {
      return Promise.reject(new McpPromptError("malformed-message"));
    }
    this.promptRefresh.setContext(context);
    return this.requestPromptRefresh(signal);
  }

  async getPrompt(
    promptName: string,
    argumentsValue: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<McpPromptResultView> {
    const state = this.promptRefresh.getState();
    const context = state.context;
    const catalog = state.value;
    const controller = state.controller;
    if (
      this.status !== "connected" ||
      context === undefined ||
      catalog === undefined ||
      controller === undefined ||
      controller.signal.aborted
    ) {
      throw new McpPromptError("prompt-unavailable");
    }
    const combinedSignal =
      signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    combinedSignal.throwIfAborted();
    const validatedArguments = validateMcpPromptArguments(catalog, promptName, argumentsValue);
    try {
      const value: unknown = await this.sdkClient.request(
        { method: "prompts/get", params: { name: promptName, arguments: validatedArguments } },
        { signal: combinedSignal },
      );
      combinedSignal.throwIfAborted();
      if (this.status !== "connected" || !this.isCurrentPromptState(context, catalog, controller)) {
        throw new McpPromptError("prompt-unavailable");
      }
      return normalizeMcpPromptResult(context, promptName, validatedArguments, value);
    } catch (error) {
      if (combinedSignal.aborted || error instanceof McpPromptError) throw error;
      if (
        error instanceof SdkError &&
        (error.code === SdkErrorCode.UnsupportedResultType ||
          error.code === SdkErrorCode.CapabilityNotSupported)
      ) {
        throw new McpPromptError("prompt-unsupported");
      }
      throw new McpPromptError("prompt-unavailable");
    }
  }

  discoverResources(
    context: McpResourceDiscoveryContext,
    signal?: AbortSignal,
  ): Promise<McpResourceCatalogView> {
    if (this.status !== "connected" || this.connectedState === undefined) {
      return Promise.reject(new McpResourceError("resource-unavailable"));
    }
    if (!Number.isSafeInteger(context.generation) || context.generation <= 0) {
      return Promise.reject(new McpResourceError("malformed-message"));
    }
    this.resourceRefresh.setContext(context);
    return this.requestResourceRefresh(signal);
  }

  async readResource(
    selection: McpResourceSelection,
    signal?: AbortSignal,
  ): Promise<McpResourceSnapshotView> {
    const state = this.resourceRefresh.getState();
    const context = state.context;
    const catalog = state.value;
    const controller = state.controller;
    if (
      this.status !== "connected" ||
      context === undefined ||
      catalog === undefined ||
      controller === undefined ||
      controller.signal.aborted
    ) {
      throw new McpResourceError("resource-unavailable");
    }
    const combinedSignal =
      signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    combinedSignal.throwIfAborted();
    const uri = resolveMcpResourceSelection(catalog, selection);
    try {
      const value: unknown = await this.sdkClient.request(
        { method: "resources/read", params: { uri } },
        { signal: combinedSignal },
      );
      combinedSignal.throwIfAborted();
      if (
        this.status !== "connected" ||
        !this.isCurrentResourceState(context, catalog, controller)
      ) {
        throw new McpResourceError("resource-unavailable");
      }
      return normalizeMcpResourceResult(context, uri, value);
    } catch (error) {
      if (combinedSignal.aborted || error instanceof McpResourceError) throw error;
      if (
        error instanceof SdkError &&
        (error.code === SdkErrorCode.UnsupportedResultType ||
          error.code === SdkErrorCode.CapabilityNotSupported)
      ) {
        throw new McpResourceError("resource-unsupported");
      }
      throw new McpResourceError("resource-unavailable");
    }
  }

  discoverTools(
    context: McpToolDiscoveryContext,
    signal?: AbortSignal,
  ): Promise<McpToolSnapshotView> {
    if (this.status !== "connected" || this.connectedState === undefined) {
      return Promise.reject(new McpToolDiscoveryError("disconnected"));
    }
    if (!Number.isSafeInteger(context.generation) || context.generation <= 0) {
      return Promise.reject(new McpToolDiscoveryError("malformed-message"));
    }
    this.toolRefresh.setContext(context);
    return this.requestToolRefresh(signal);
  }

  refreshTools(signal?: AbortSignal): Promise<McpToolSnapshotView> {
    return this.requestToolRefresh(signal);
  }

  connect(signal?: AbortSignal): Promise<McpConnectOutcome> {
    if (this.status === "connected" && this.connectedState !== undefined) {
      return Promise.resolve({ kind: "connected", connection: this.connectedState });
    }

    if (this.connectPromise !== undefined) {
      return this.connectPromise;
    }

    if (this.consumed) {
      return Promise.resolve({ kind: "failed", error: createMcpClientError("disconnected") });
    }

    this.consumed = true;
    this.status = "connecting";
    const generation = ++this.generation;
    this.activeGeneration = generation;
    this.connectPromise = this.connectOnce(signal).finally(() => {
      if (this.activeGeneration === generation && this.status !== "connected") {
        this.activeGeneration = 0;
      }
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  async disconnect(): Promise<McpDisconnectOutcome> {
    this.clearToolCatalog();
    this.clearResourceCatalog();
    this.clearPromptCatalog();
    if (this.status === "disconnected" && !this.consumed) {
      return { kind: "disconnected" };
    }

    if (this.status === "failed") {
      await this.transport.waitForCleanup();
      return { kind: "failed", error: this.failure ?? createMcpClientError("internal") };
    }

    this.status = "disconnecting";
    this.activeGeneration = ++this.generation;
    this.connectedState = undefined;
    this.transport.closeDeliveryGate();

    try {
      await this.sdkClient.close();
      await this.connectPromise;
    } catch {
      // The stable cleanup result below owns disconnect classification.
    }

    await this.transport.waitForCleanup();
    if (this.transport.failure === "termination-unconfirmed") {
      return { kind: "failed", error: this.setFailure("termination-unconfirmed") };
    }

    this.status = "disconnected";
    this.activeGeneration = 0;
    this.failure = undefined;
    return { kind: "disconnected" };
  }

  dispose(): Promise<McpDisconnectOutcome> {
    return this.disconnect();
  }

  private async connectOnce(signal?: AbortSignal): Promise<McpConnectOutcome> {
    const generation = this.activeGeneration;
    if (signal?.aborted) {
      this.status = "disconnected";
      return { kind: "cancelled" };
    }

    const abortConnection = (): void => this.transport.closeDeliveryGate();
    signal?.addEventListener("abort", abortConnection, { once: true });

    try {
      const probe = await negotiateMcpEra(this.transport, {
        mode: this.protocolMode,
        clientName: this.sdkClientName,
        clientVersion: this.sdkClientVersion,
        timeoutMs: this.probeTimeoutMs,
        generation,
        signal,
        isCurrent: () => this.isCurrentGeneration(generation),
      });
      if (!this.isCurrentGeneration(generation)) {
        throw new McpNegotiationFailure("protocol-incompatible");
      }

      this.negotiatedEra = probe.kind;
      await this.sdkClient.connect(this.transport, {
        signal,
        timeout: this.probeTimeoutMs,
        prior:
          probe.kind === "modern"
            ? { kind: "modern", discover: probe.discover }
            : { kind: "legacy" },
      });

      if (signal?.aborted || this.status === "disconnecting") {
        await this.transport.close();
        return { kind: "cancelled" };
      }

      const negotiated: McpNegotiatedProtocol =
        probe.kind === "modern"
          ? { era: "modern", version: mcpProtocolVersion }
          : { era: "legacy", version: mcpLegacyProtocolVersion };
      const expectedVersion = negotiated.version;
      if (this.transport.protocolVersion !== expectedVersion) {
        const failure = this.setFailure("protocol-incompatible");
        await this.transport.close();
        return { kind: "failed", error: failure };
      }

      const connection: McpConnectedState = {
        status: "connected",
        protocolVersion: expectedVersion,
        capabilities: projectCapabilities(this.sdkClient.getServerCapabilities()),
        ...(this.exposeNegotiatedProjection
          ? {
              configuredMode: this.protocolMode,
              negotiated,
            }
          : {}),
      };
      this.connectedState = connection;
      this.failure = undefined;
      this.status = "connected";
      return { kind: "connected", connection };
    } catch (error) {
      const cancelled = signal?.aborted === true || this.status === "disconnecting";
      this.transport.closeDeliveryGate();
      try {
        await this.sdkClient.close();
      } catch {
        // Transport cleanup and termination confirmation below remain authoritative.
      }
      await this.transport.waitForCleanup();

      if (this.transport.failure === "termination-unconfirmed") {
        return { kind: "failed", error: this.setFailure("termination-unconfirmed") };
      }

      if (cancelled) {
        if (this.status !== "disconnecting") {
          this.status = "disconnected";
        }
        return { kind: "cancelled" };
      }

      return {
        kind: "failed",
        error: this.setFailure(
          classifySdkFailure(error, this.transport.failure, this.negotiatedEra === "legacy"),
        ),
      };
    } finally {
      signal?.removeEventListener("abort", abortConnection);
    }
  }

  private handleTransportFailure(code: McpClientErrorCode): void {
    if (this.status === "disconnecting" && code !== "termination-unconfirmed") {
      return;
    }

    this.clearToolCatalog();
    this.clearResourceCatalog();
    this.clearPromptCatalog();
    this.setFailure(code);
  }

  private setFailure(code: McpClientErrorCode): McpClientError {
    this.connectedState = undefined;
    this.activeGeneration = 0;
    const failure = createMcpClientError(code);
    this.failure = failure;
    this.status = "failed";
    return failure;
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.status === "connecting" && this.activeGeneration === generation;
  }

  private requestToolRefresh(signal?: AbortSignal): Promise<McpToolSnapshotView> {
    return this.runToolRefresh(signal);
  }

  private async runToolRefresh(signal?: AbortSignal): Promise<McpToolSnapshotView> {
    try {
      const latest = await this.toolRefresh.request(signal);
      this.toolDiagnostic = undefined;
      return latest.view;
    } catch (error) {
      if (error instanceof McpToolDiscoveryError) {
        this.toolDiagnostic = isToolDiagnosticCode(error.code)
          ? error.rejectedTools.length === 0
            ? { kind: "failure", code: error.code }
            : {
                kind: "rejections",
                rejectedTools: error.rejectedTools,
                rejectedToolsTruncated: error.rejectedToolsTruncated,
              }
          : undefined;
      }
      throw error;
    }
  }

  private async loadToolCatalog(
    context: McpToolDiscoveryContext,
    controller: AbortController,
    refreshSignal: AbortSignal,
  ): Promise<McpToolSnapshot> {
    const values =
      this.connectedState?.capabilities.tools === true
        ? await this.collectToolDescriptors(refreshSignal)
        : [];
    refreshSignal.throwIfAborted();

    try {
      const replacement = createMcpToolSnapshot(
        context.server,
        context.generation,
        values,
        new Set(context.reservedToolNames ?? []),
        this.toolValidator,
        (name, argumentsValue, runSignal) =>
          this.callTool(context, controller, name, argumentsValue, runSignal),
      );
      return replacement;
    } catch (error) {
      if (error instanceof McpToolSnapshotError) {
        throw new McpToolDiscoveryError(
          error.code,
          error.rejectedTools,
          error.rejectedToolsTruncated,
        );
      }
      throw error;
    }
  }

  private async collectToolDescriptors(signal: AbortSignal): Promise<unknown[]> {
    try {
      return await collectMcpCatalogPages({
        field: "tools",
        signal,
        request: (cursor) =>
          this.sdkClient.request(
            { method: "tools/list", params: cursor === undefined ? {} : { cursor } },
            { signal },
          ),
      });
    } catch (error) {
      if (error instanceof McpCatalogCollectionError) {
        throw new McpToolDiscoveryError(error.code);
      }
      throw error;
    }
  }

  private async callTool(
    context: McpToolDiscoveryContext,
    controller: AbortController,
    name: string,
    argumentsValue: Readonly<Record<string, import("@ctrl-zebra/core").JsonValue>>,
    runSignal: AbortSignal,
  ): Promise<unknown> {
    const state = this.toolRefresh.getState();
    if (
      this.status !== "connected" ||
      state.context !== context ||
      state.controller !== controller ||
      controller.signal.aborted
    ) {
      throw new ToolUnavailableError();
    }
    const signal = AbortSignal.any([controller.signal, runSignal]);
    signal.throwIfAborted();
    try {
      const result = await this.sdkClient.callTool({ name, arguments: argumentsValue }, { signal });
      signal.throwIfAborted();
      if (
        this.status !== "connected" ||
        this.toolRefresh.getState().context !== context ||
        this.toolRefresh.getState().controller !== controller
      ) {
        throw new ToolUnavailableError();
      }
      return result;
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason;
      }
      if (error instanceof ToolUnavailableError) {
        throw error;
      }
      if (
        error instanceof SdkError &&
        (error.code === SdkErrorCode.UnsupportedResultType ||
          error.code === SdkErrorCode.CapabilityNotSupported)
      ) {
        throw new ToolExecutionError(
          "failed",
          "The external MCP Tool requested an unsupported capability.",
        );
      }
      throw new ToolExecutionError("failed", "The external MCP Tool call failed.");
    }
  }

  private requestPromptRefresh(signal?: AbortSignal): Promise<McpPromptCatalogView> {
    return this.promptRefresh.request(signal);
  }

  private async loadPromptCatalog(
    context: McpPromptDiscoveryContext,
    _controller: AbortController,
    combinedSignal: AbortSignal,
  ): Promise<McpPromptCatalogView> {
    const prompts =
      this.connectedState?.capabilities.prompts === true
        ? await this.collectPromptList(combinedSignal)
        : [];
    combinedSignal.throwIfAborted();
    return createMcpPromptCatalog(context, prompts);
  }

  private async collectPromptList(signal: AbortSignal): Promise<unknown[]> {
    try {
      return await collectMcpCatalogPages({
        field: "prompts",
        signal,
        request: (cursor) =>
          this.sdkClient.request(
            { method: "prompts/list", params: cursor === undefined ? {} : { cursor } },
            { signal },
          ),
      });
    } catch (error) {
      if (error instanceof McpCatalogCollectionError) {
        throw new McpPromptError(error.code);
      }
      throw error;
    }
  }

  private requestResourceRefresh(signal?: AbortSignal): Promise<McpResourceCatalogView> {
    return this.resourceRefresh.request(signal);
  }

  private async loadResourceCatalog(
    context: McpResourceDiscoveryContext,
    _controller: AbortController,
    combinedSignal: AbortSignal,
  ): Promise<McpResourceCatalogView> {
    const resources =
      this.connectedState?.capabilities.resources === true
        ? await this.collectResourceList("resources/list", "resources", combinedSignal)
        : [];
    const templates =
      this.connectedState?.capabilities.resourceTemplates === true
        ? await this.collectResourceList(
            "resources/templates/list",
            "resourceTemplates",
            combinedSignal,
          )
        : [];
    combinedSignal.throwIfAborted();
    return createMcpResourceCatalog(context, resources, templates);
  }

  private async collectResourceList(
    method: "resources/list" | "resources/templates/list",
    field: "resources" | "resourceTemplates",
    signal: AbortSignal,
  ): Promise<unknown[]> {
    try {
      return await collectMcpCatalogPages({
        field,
        signal,
        request: (cursor) =>
          this.sdkClient.request(
            { method, params: cursor === undefined ? {} : { cursor } },
            { signal },
          ),
      });
    } catch (error) {
      if (error instanceof McpCatalogCollectionError) {
        throw new McpResourceError(error.code);
      }
      throw error;
    }
  }

  private clearToolCatalog(): void {
    this.toolRefresh.clear();
    this.toolDiagnostic = undefined;
  }

  private clearResourceCatalog(): void {
    this.resourceRefresh.clear();
  }

  private clearPromptCatalog(): void {
    this.promptRefresh.clear();
  }

  private isCurrentPromptState(
    context: McpPromptDiscoveryContext | undefined,
    catalog: McpPromptCatalogView | undefined,
    controller: AbortController | undefined,
  ): boolean {
    const state = this.promptRefresh.getState();
    return state.context === context && state.value === catalog && state.controller === controller;
  }

  private isCurrentResourceState(
    context: McpResourceDiscoveryContext | undefined,
    catalog: McpResourceCatalogView | undefined,
    controller: AbortController | undefined,
  ): boolean {
    const state = this.resourceRefresh.getState();
    return state.context === context && state.value === catalog && state.controller === controller;
  }
}

export class McpToolDiscoveryError extends Error {
  constructor(
    readonly code: McpClientErrorCode,
    readonly rejectedTools: readonly {
      readonly mcpToolName: string;
      readonly reason: import("./contracts.js").McpToolRejectionReason;
    }[] = [],
    readonly rejectedToolsTruncated = false,
  ) {
    super(createMcpClientError(code).message);
    this.name = "McpToolDiscoveryError";
  }
}

function sameCatalogContext<
  TContext extends {
    readonly server: { readonly serverId: string };
    readonly generation: number;
  },
>(current: TContext, next: TContext): boolean {
  return current.generation === next.generation && current.server.serverId === next.server.serverId;
}

function isToolDiagnosticCode(
  code: McpClientErrorCode,
): code is "invalid-schema" | "limit-exceeded" | "malformed-message" {
  return code === "invalid-schema" || code === "limit-exceeded" || code === "malformed-message";
}

function projectCapabilities(capabilities: ServerCapabilities | undefined): McpServerCapabilities {
  return {
    tools: capabilities?.tools !== undefined,
    toolsListChanged: capabilities?.tools?.listChanged === true,
    resources: capabilities?.resources !== undefined,
    resourceTemplates: capabilities?.resources !== undefined,
    resourcesListChanged: capabilities?.resources?.listChanged === true,
    prompts: capabilities?.prompts !== undefined,
    promptsListChanged: capabilities?.prompts?.listChanged === true,
  };
}

function classifySdkFailure(
  error: unknown,
  transportFailure: McpClientErrorCode | undefined,
  legacyHandshake: boolean,
): McpClientErrorCode {
  if (transportFailure !== undefined) {
    return transportFailure;
  }

  if (error instanceof McpNegotiationFailure) {
    return error.code;
  }

  if (error instanceof UnsupportedProtocolVersionError) {
    return "protocol-incompatible";
  }

  if (error instanceof SdkError) {
    if (
      error.code === SdkErrorCode.EraNegotiationFailed ||
      error.code === SdkErrorCode.MethodNotSupportedByProtocolVersion
    ) {
      return "protocol-incompatible";
    }

    if (
      error.code === SdkErrorCode.CapabilityNotSupported ||
      error.code === SdkErrorCode.UnsupportedResultType
    ) {
      return "capability-unsupported";
    }

    if (error.code === SdkErrorCode.InvalidResult) {
      return "malformed-message";
    }

    if (legacyHandshake && error.code === SdkErrorCode.RequestTimeout) {
      return "protocol-incompatible";
    }

    if (error.code === SdkErrorCode.ConnectionClosed) {
      return "server-exited";
    }
  }

  // The SDK reports a legacy initialize response with an unsupported version
  // as a plain Error after validating its envelope. Do not branch on its
  // untrusted text; the handshake arm itself owns this stable classification.
  if (legacyHandshake && error instanceof Error) {
    return "protocol-incompatible";
  }

  return "connect-failed";
}

function normalizeProbeTimeout(value: number | undefined): number {
  if (value === undefined) return 5_000;
  if (!Number.isFinite(value) || value <= 0) return 5_000;
  return Math.min(Math.floor(value), 60_000);
}
