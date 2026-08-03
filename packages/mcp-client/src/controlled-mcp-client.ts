import { ToolExecutionError, ToolUnavailableError } from "@ctrl-zebra/core";
import {
  Client,
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
  type McpResourceDiscoveryContext,
  type McpServerCapabilities,
  type McpStderrSnapshot,
  type McpStdioPort,
  type McpToolDiscoveryContext,
  maxMcpListEntries,
  maxMcpListPages,
  mcpProtocolVersion,
} from "./contracts.js";
import { createMcpClientError } from "./errors.js";
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
import { controlledSdkClientOptions } from "./sdk-options.js";
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
  private status: McpConnectionState["status"] = "disconnected";
  private connectedState: McpConnectedState | undefined;
  private failure: McpClientError | undefined;
  private connectPromise: Promise<McpConnectOutcome> | undefined;
  private consumed = false;
  private toolContext: McpToolDiscoveryContext | undefined;
  private toolSnapshot: McpToolSnapshot | undefined;
  private toolRefreshPromise: Promise<McpToolSnapshotView> | undefined;
  private toolRefreshRequested = false;
  private toolController: AbortController | undefined;
  private readonly toolValidator = createExternalJsonSchemaValidator();
  private resourceContext: McpResourceDiscoveryContext | undefined;
  private resourceCatalog: McpResourceCatalogView | undefined;
  private resourceRefreshPromise: Promise<McpResourceCatalogView> | undefined;
  private resourceRefreshRequested = false;
  private resourceController: AbortController | undefined;

  constructor(port: McpStdioPort, options: ControlledMcpClientOptions = {}) {
    this.sdkClient = new Client(
      {
        name: options.clientName ?? "ctrl-zebra",
        version: options.clientVersion ?? "0.0.0",
      },
      controlledSdkClientOptions,
    );
    this.transport = new SdkStdioTransport(port, (code) => this.handleTransportFailure(code));
    this.sdkClient.setNotificationHandler("notifications/tools/list_changed", async () => {
      if (
        this.connectedState?.capabilities.toolsListChanged !== true ||
        this.toolContext === undefined
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
        this.resourceContext === undefined
      ) {
        return;
      }
      try {
        await this.requestResourceRefresh();
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
    return this.toolSnapshot?.view;
  }

  getResourceCatalog(): McpResourceCatalogView | undefined {
    return this.resourceCatalog;
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
    if (
      this.resourceContext === undefined ||
      this.resourceContext.generation !== context.generation ||
      this.resourceContext.server.serverId !== context.server.serverId
    ) {
      this.clearResourceCatalog();
      this.resourceContext = context;
      this.resourceController = new AbortController();
    }
    return this.requestResourceRefresh(signal);
  }

  async readResource(
    selection: McpResourceSelection,
    signal?: AbortSignal,
  ): Promise<McpResourceSnapshotView> {
    const context = this.resourceContext;
    const catalog = this.resourceCatalog;
    const controller = this.resourceController;
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
        context !== this.resourceContext ||
        catalog !== this.resourceCatalog ||
        controller !== this.resourceController
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
    if (
      this.toolContext === undefined ||
      this.toolContext.generation !== context.generation ||
      this.toolContext.server.serverId !== context.server.serverId
    ) {
      this.clearToolSnapshot();
      this.toolContext = context;
      this.toolController = new AbortController();
    }
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
    this.connectPromise = this.connectOnce(signal).finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  async disconnect(): Promise<McpDisconnectOutcome> {
    this.clearToolSnapshot();
    this.clearResourceCatalog();
    if (this.status === "disconnected" && !this.consumed) {
      return { kind: "disconnected" };
    }

    if (this.status === "failed") {
      await this.transport.waitForCleanup();
      return { kind: "failed", error: this.failure ?? createMcpClientError("internal") };
    }

    this.status = "disconnecting";
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
    this.failure = undefined;
    return { kind: "disconnected" };
  }

  dispose(): Promise<McpDisconnectOutcome> {
    return this.disconnect();
  }

  private async connectOnce(signal?: AbortSignal): Promise<McpConnectOutcome> {
    if (signal?.aborted) {
      this.status = "disconnected";
      return { kind: "cancelled" };
    }

    const abortConnection = (): void => this.transport.closeDeliveryGate();
    signal?.addEventListener("abort", abortConnection, { once: true });

    try {
      await this.sdkClient.connect(this.transport, { signal });

      if (signal?.aborted || this.status === "disconnecting") {
        await this.transport.close();
        return { kind: "cancelled" };
      }

      if (this.transport.protocolVersion !== mcpProtocolVersion) {
        const failure = this.setFailure("protocol-incompatible");
        await this.transport.close();
        return { kind: "failed", error: failure };
      }

      const connection: McpConnectedState = {
        status: "connected",
        protocolVersion: mcpProtocolVersion,
        capabilities: projectCapabilities(this.sdkClient.getServerCapabilities()),
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
        error: this.setFailure(classifySdkFailure(error, this.transport.failure)),
      };
    } finally {
      signal?.removeEventListener("abort", abortConnection);
    }
  }

  private handleTransportFailure(code: McpClientErrorCode): void {
    if (this.status === "disconnecting" && code !== "termination-unconfirmed") {
      return;
    }

    this.clearToolSnapshot();
    this.clearResourceCatalog();
    this.setFailure(code);
  }

  private setFailure(code: McpClientErrorCode): McpClientError {
    this.connectedState = undefined;
    const failure = createMcpClientError(code);
    this.failure = failure;
    this.status = "failed";
    return failure;
  }

  private requestToolRefresh(signal?: AbortSignal): Promise<McpToolSnapshotView> {
    this.toolRefreshRequested = true;
    if (this.toolRefreshPromise !== undefined) {
      return this.toolRefreshPromise;
    }
    const refresh = this.runToolRefreshes(signal).finally(() => {
      if (this.toolRefreshPromise === refresh) {
        this.toolRefreshPromise = undefined;
      }
    });
    this.toolRefreshPromise = refresh;
    return refresh;
  }

  private async runToolRefreshes(signal?: AbortSignal): Promise<McpToolSnapshotView> {
    let latest = this.toolSnapshot?.view;
    do {
      this.toolRefreshRequested = false;
      latest = await this.refreshToolsOnce(signal);
    } while (this.toolRefreshRequested);
    if (latest === undefined) {
      throw new McpToolDiscoveryError("internal");
    }
    return latest;
  }

  private async refreshToolsOnce(signal?: AbortSignal): Promise<McpToolSnapshotView> {
    const context = this.toolContext;
    const controller = this.toolController;
    if (context === undefined || controller === undefined || this.status !== "connected") {
      throw new McpToolDiscoveryError("disconnected");
    }
    const refreshSignal =
      signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    refreshSignal.throwIfAborted();

    const values =
      this.connectedState?.capabilities.tools === true
        ? await this.collectToolDescriptors(refreshSignal)
        : [];
    refreshSignal.throwIfAborted();
    if (context !== this.toolContext || this.status !== "connected") {
      throw new McpToolDiscoveryError("disconnected");
    }

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
      this.toolSnapshot?.revoke();
      this.toolSnapshot = replacement;
      return replacement.view;
    } catch (error) {
      if (error instanceof McpToolSnapshotError) {
        throw new McpToolDiscoveryError(error.code);
      }
      throw error;
    }
  }

  private async collectToolDescriptors(signal: AbortSignal): Promise<unknown[]> {
    const tools: unknown[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageNumber = 1; pageNumber <= maxMcpListPages; pageNumber += 1) {
      signal.throwIfAborted();
      const page: unknown = await this.sdkClient.request(
        { method: "tools/list", params: cursor === undefined ? {} : { cursor } },
        { signal },
      );
      const pageRecord = readPage(page);
      const pageTools = pageRecord.tools;
      if (!Array.isArray(pageTools)) {
        throw new McpToolDiscoveryError("malformed-message");
      }
      if (tools.length + pageTools.length > maxMcpListEntries) {
        throw new McpToolDiscoveryError("limit-exceeded");
      }
      tools.push(...pageTools);
      const nextCursor = pageRecord.nextCursor;
      if (nextCursor === undefined) {
        return tools;
      }
      if (typeof nextCursor !== "string" || nextCursor === "" || cursors.has(nextCursor)) {
        throw new McpToolDiscoveryError("malformed-message");
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new McpToolDiscoveryError("limit-exceeded");
  }

  private async callTool(
    context: McpToolDiscoveryContext,
    controller: AbortController,
    name: string,
    argumentsValue: Readonly<Record<string, import("@ctrl-zebra/core").JsonValue>>,
    runSignal: AbortSignal,
  ): Promise<unknown> {
    if (
      this.status !== "connected" ||
      this.toolContext !== context ||
      this.toolController !== controller ||
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
        this.toolContext !== context ||
        this.toolController !== controller
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

  private requestResourceRefresh(signal?: AbortSignal): Promise<McpResourceCatalogView> {
    this.resourceRefreshRequested = true;
    if (this.resourceRefreshPromise !== undefined) return this.resourceRefreshPromise;
    const refresh = this.runResourceRefreshes(signal).finally(() => {
      if (this.resourceRefreshPromise === refresh) this.resourceRefreshPromise = undefined;
    });
    this.resourceRefreshPromise = refresh;
    return refresh;
  }

  private async runResourceRefreshes(signal?: AbortSignal): Promise<McpResourceCatalogView> {
    let latest = this.resourceCatalog;
    do {
      this.resourceRefreshRequested = false;
      latest = await this.refreshResourcesOnce(signal);
    } while (this.resourceRefreshRequested);
    if (latest === undefined) throw new McpResourceError("resource-unavailable");
    return latest;
  }

  private async refreshResourcesOnce(signal?: AbortSignal): Promise<McpResourceCatalogView> {
    const context = this.resourceContext;
    const controller = this.resourceController;
    if (context === undefined || controller === undefined || this.status !== "connected") {
      throw new McpResourceError("resource-unavailable");
    }
    const combinedSignal =
      signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    combinedSignal.throwIfAborted();
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
    if (context !== this.resourceContext || this.status !== "connected") {
      throw new McpResourceError("resource-unavailable");
    }
    const replacement = createMcpResourceCatalog(context, resources, templates);
    this.resourceCatalog = replacement;
    return replacement;
  }

  private async collectResourceList(
    method: "resources/list" | "resources/templates/list",
    field: "resources" | "resourceTemplates",
    signal: AbortSignal,
  ): Promise<unknown[]> {
    const values: unknown[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageNumber = 1; pageNumber <= maxMcpListPages; pageNumber += 1) {
      signal.throwIfAborted();
      const page: unknown = await this.sdkClient.request(
        { method, params: cursor === undefined ? {} : { cursor } },
        { signal },
      );
      const record = readPage(page);
      const pageValues = record[field];
      if (!Array.isArray(pageValues)) throw new McpResourceError("malformed-message");
      if (values.length + pageValues.length > maxMcpListEntries) {
        throw new McpResourceError("limit-exceeded");
      }
      values.push(...pageValues);
      const nextCursor = record.nextCursor;
      if (nextCursor === undefined) return values;
      if (typeof nextCursor !== "string" || nextCursor === "" || cursors.has(nextCursor)) {
        throw new McpResourceError("malformed-message");
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new McpResourceError("limit-exceeded");
  }

  private clearToolSnapshot(): void {
    this.toolController?.abort(new Error("MCP Tool snapshot connection generation ended."));
    this.toolController = undefined;
    this.toolContext = undefined;
    this.toolRefreshRequested = false;
    this.toolSnapshot?.revoke();
    this.toolSnapshot = undefined;
  }

  private clearResourceCatalog(): void {
    this.resourceController?.abort(new Error("MCP Resource catalog connection generation ended."));
    this.resourceController = undefined;
    this.resourceContext = undefined;
    this.resourceRefreshRequested = false;
    this.resourceCatalog = undefined;
  }
}

export class McpToolDiscoveryError extends Error {
  constructor(readonly code: McpClientErrorCode) {
    super(createMcpClientError(code).message);
    this.name = "McpToolDiscoveryError";
  }
}

function readPage(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new McpToolDiscoveryError("malformed-message");
  }
  return value as Readonly<Record<string, unknown>>;
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
): McpClientErrorCode {
  if (transportFailure !== undefined) {
    return transportFailure;
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

    if (error.code === SdkErrorCode.ConnectionClosed) {
      return "server-exited";
    }
  }

  return "connect-failed";
}
