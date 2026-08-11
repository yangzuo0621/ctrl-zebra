import type {
  ExtensionToWebviewMessage,
  McpConnectionDto,
  McpDiagnosticsMessage,
  McpDiagnosticsProjectionDto,
  McpPromptArgumentsDto,
  McpPromptCatalogDto,
  McpPromptConfirmation,
  McpPromptPreviewDto,
  McpResourceAttachment,
  McpResourceCatalogDto,
  McpResourceSelectionDto,
  McpResourceSnapshotDto,
  McpToolCatalogMessage,
  McpToolCatalogProjectionDto,
} from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import { strings } from "./strings.js";
import type { WebviewHost } from "./vscode-api.js";

export interface McpState {
  readonly connection: McpConnectionDto;
  readonly tools?: McpToolCatalogProjectionDto;
  readonly diagnostics?: Exclude<McpDiagnosticsProjectionDto, { kind: "clear" }>;
  readonly resources?: McpResourceCatalogDto;
  readonly prompts?: McpPromptCatalogDto;
  readonly selectedResourceKey?: string;
  readonly resourceArguments: Readonly<Record<string, string>>;
  readonly resourcePreview?: {
    readonly snapshotId: string;
    readonly snapshot: McpResourceSnapshotDto;
  };
  readonly attachments: readonly McpResourceAttachment[];
  readonly selectedPromptName?: string;
  readonly promptArguments: McpPromptArgumentsDto;
  readonly promptPreview?: McpPromptPreviewDto;
  readonly confirmations: readonly {
    readonly previewId: string;
    readonly value: McpPromptConfirmation;
  }[];
  readonly busy?: "connecting" | "disconnecting" | "refresh-tools" | "resource" | "prompt";
  readonly announcement: string;
  readonly diagnosticAnnouncement?: string;
  connect(): void;
  disconnect(): void;
  refreshTools(): boolean;
  openSettings(): void;
  selectResource(key: string): void;
  setResourceArgument(name: string, value: string): void;
  readResource(): boolean;
  attachResource(): boolean;
  detachResource(snapshotId: string): void;
  selectPrompt(name: string): void;
  setPromptArgument(name: string, value: string): void;
  previewPrompt(): boolean;
  confirmPrompt(): boolean;
  cancelPrompt(): boolean;
  detachPrompt(previewId: string): void;
  clearDraft(): void;
  receive(message: ExtensionToWebviewMessage): void;
}

const disconnected: McpConnectionDto = {
  status: "disconnected",
  generation: 0,
  configurationStale: false,
};

export function createMcpStore(
  host: WebviewHost,
  createRequestId: () => string = () => crypto.randomUUID(),
): StoreApi<McpState> {
  let connectionRequest: string | undefined;
  let resourceRequest: string | undefined;
  let promptRequest: string | undefined;
  let committedToolCatalog: ToolCatalogRecord | undefined;
  let pendingToolCatalog: ToolCatalogRecord | undefined;
  let toolCatalogDeliveryClosed = false;
  let diagnosticScope: string | undefined;
  let diagnosticSequence = 0;
  let diagnosticPublication: DiagnosticRecord | undefined;
  let diagnosticRequest: string | undefined;

  const clearToolCatalogWatermarks = (): void => {
    committedToolCatalog = undefined;
    pendingToolCatalog = undefined;
  };

  const clearDiagnosticWatermarks = (): void => {
    diagnosticScope = undefined;
    diagnosticSequence = 0;
    diagnosticPublication = undefined;
    diagnosticRequest = undefined;
  };

  const stageToolCatalog = (
    setState: StoreApi<McpState>["setState"],
    message: McpToolCatalogMessage,
  ): void => {
    const record: ToolCatalogRecord = {
      requestId: message.requestId,
      serverId: message.catalog.server.serverId,
      generation: message.catalog.generation,
      catalogSequence: message.catalogSequence,
      catalog: message.catalog,
    };
    if (pendingToolCatalog !== undefined) {
      if (record.catalogSequence < pendingToolCatalog.catalogSequence) return;
      if (record.catalogSequence === pendingToolCatalog.catalogSequence) {
        if (sameToolCatalogPublication(pendingToolCatalog, record)) return;
        return;
      }
      pendingToolCatalog = record;
      setState({ tools: record.catalog });
      if (pendingToolCatalog !== record) return;
      committedToolCatalog = record;
      pendingToolCatalog = undefined;
      return;
    }
    if (committedToolCatalog !== undefined) {
      if (record.catalogSequence < committedToolCatalog.catalogSequence) return;
      if (record.catalogSequence === committedToolCatalog.catalogSequence) {
        if (sameToolCatalogPublication(committedToolCatalog, record)) return;
        return;
      }
    }
    pendingToolCatalog = record;
    setState({ tools: record.catalog });
    if (pendingToolCatalog !== record) return;
    committedToolCatalog = record;
    pendingToolCatalog = undefined;
  };

  const receiveDiagnostic = (
    setState: StoreApi<McpState>["setState"],
    getState: StoreApi<McpState>["getState"],
    message: McpDiagnosticsMessage,
  ): void => {
    const state = getState();
    if (!sameDiagnosticGeneration(state.connection, message.diagnostic)) return;
    const scope = `${message.diagnostic.server.serverId}\u0000${message.diagnostic.generation}`;
    if (diagnosticScope !== scope) {
      diagnosticScope = scope;
      diagnosticSequence = 0;
      diagnosticPublication = undefined;
    }
    if (message.diagnosticSequence < diagnosticSequence) return;
    const record: DiagnosticRecord = {
      requestId: message.requestId,
      serverId: message.diagnostic.server.serverId,
      generation: message.diagnostic.generation,
      diagnosticSequence: message.diagnosticSequence,
      diagnostic: message.diagnostic,
    };
    if (message.diagnosticSequence === diagnosticSequence && diagnosticPublication !== undefined) {
      if (sameDiagnosticPublication(diagnosticPublication, record)) return;
      return;
    }
    diagnosticSequence = message.diagnosticSequence;
    diagnosticPublication = record;
    const wasPendingRefresh = message.requestId === diagnosticRequest;
    if (wasPendingRefresh) diagnosticRequest = undefined;
    const clearsRefreshBusy = wasPendingRefresh && state.busy === "refresh-tools";
    const display = message.diagnostic.kind === "clear" ? undefined : message.diagnostic;
    const shouldAnnounce =
      message.diagnostic.kind !== "clear" || state.diagnostics !== undefined || wasPendingRefresh;
    setState({
      diagnostics: display,
      ...(clearsRefreshBusy ? { busy: undefined } : {}),
      diagnosticAnnouncement: shouldAnnounce
        ? message.diagnostic.kind === "clear"
          ? strings.mcpAnnouncements.diagnosticsCleared
          : strings.mcpAnnouncements.diagnosticsUpdated
        : undefined,
      announcement: shouldAnnounce
        ? message.diagnostic.kind === "clear"
          ? strings.mcpAnnouncements.diagnosticsCleared
          : strings.mcpAnnouncements.diagnosticsUpdated
        : state.announcement,
    });
  };

  return createStore<McpState>()((set, get) => ({
    connection: disconnected,
    resourceArguments: {},
    attachments: [],
    promptArguments: {},
    confirmations: [],
    announcement: strings.mcpAnnouncements.disconnected,
    connect() {
      connectionRequest = createRequestId();
      const shouldClearLiveState = get().connection.status !== "connected";
      if (shouldClearLiveState) {
        resourceRequest = undefined;
        promptRequest = undefined;
        clearToolCatalogWatermarks();
        clearDiagnosticWatermarks();
        toolCatalogDeliveryClosed = true;
      }
      set({
        ...(shouldClearLiveState ? clearLiveState() : {}),
        busy: "connecting",
        announcement: strings.mcpAnnouncements.connecting,
      });
      host.connectMcp?.(connectionRequest);
    },
    disconnect() {
      connectionRequest = createRequestId();
      resourceRequest = undefined;
      promptRequest = undefined;
      clearToolCatalogWatermarks();
      clearDiagnosticWatermarks();
      toolCatalogDeliveryClosed = true;
      set({ busy: "disconnecting", announcement: strings.mcpAnnouncements.disconnecting });
      host.disconnectMcp?.(connectionRequest);
    },
    refreshTools() {
      const state = get();
      if (
        state.connection.status !== "connected" ||
        state.busy !== undefined ||
        host.refreshMcpTools === undefined
      )
        return false;
      diagnosticRequest = createRequestId();
      set({
        busy: "refresh-tools",
        announcement: strings.mcpAnnouncements.refreshingTools,
      });
      host.refreshMcpTools(
        diagnosticRequest,
        state.connection.server.serverId,
        state.connection.generation,
      );
      return true;
    },
    openSettings() {
      host.openMcpSettings?.(createRequestId());
    },
    selectResource(key) {
      if (findResource(get().resources, key) === undefined) return;
      resourceRequest = undefined;
      set({ selectedResourceKey: key, resourceArguments: {}, resourcePreview: undefined });
    },
    setResourceArgument(name, value) {
      const selected = findResource(get().resources, get().selectedResourceKey);
      if (
        selected?.kind !== "template" ||
        !selected.value.arguments.some((arg) => arg.name === name)
      )
        return;
      set({
        resourceArguments: { ...get().resourceArguments, [name]: value },
        resourcePreview: undefined,
      });
    },
    readResource() {
      const state = get();
      const selected = findResource(state.resources, state.selectedResourceKey);
      if (state.connection.status !== "connected" || selected === undefined) return false;
      let selection: McpResourceSelectionDto;
      if (selected.kind === "resource") selection = { kind: "resource", uri: selected.value.uri };
      else {
        if (selected.value.arguments.some(({ name }) => !(name in state.resourceArguments)))
          return false;
        selection = {
          kind: "template",
          uriTemplate: selected.value.uriTemplate,
          arguments: state.resourceArguments,
        };
      }
      resourceRequest = createRequestId();
      set({
        busy: "resource",
        resourcePreview: undefined,
        announcement: strings.mcpAnnouncements.readingResource,
      });
      host.readMcpResource?.(
        resourceRequest,
        state.connection.server.serverId,
        state.connection.generation,
        selection,
      );
      return true;
    },
    attachResource() {
      const state = get();
      if (state.connection.status !== "connected" || state.resourcePreview === undefined)
        return false;
      resourceRequest = createRequestId();
      host.attachMcpResource?.(
        resourceRequest,
        state.connection.server.serverId,
        state.connection.generation,
        state.resourcePreview.snapshotId,
      );
      return true;
    },
    detachResource(snapshotId) {
      resourceRequest = createRequestId();
      host.detachMcpResource?.(resourceRequest, snapshotId);
    },
    selectPrompt(name) {
      if (!get().prompts?.prompts.some((prompt) => prompt.name === name)) return;
      promptRequest = undefined;
      set({ selectedPromptName: name, promptArguments: {}, promptPreview: undefined });
    },
    setPromptArgument(name, value) {
      const descriptor = get().prompts?.prompts.find(
        ({ name: current }) => current === get().selectedPromptName,
      );
      if (!descriptor?.arguments.some((argument) => argument.name === name)) return;
      set({
        promptArguments: { ...get().promptArguments, [name]: value },
        promptPreview: undefined,
      });
    },
    previewPrompt() {
      const state = get();
      const descriptor = state.prompts?.prompts.find(
        ({ name }) => name === state.selectedPromptName,
      );
      if (
        state.connection.status !== "connected" ||
        descriptor === undefined ||
        descriptor.arguments.some(
          ({ name, required }) => required && !(name in state.promptArguments),
        )
      )
        return false;
      promptRequest = createRequestId();
      set({
        busy: "prompt",
        promptPreview: undefined,
        announcement: strings.mcpAnnouncements.loadingPrompt,
      });
      host.previewMcpPrompt?.(
        promptRequest,
        state.connection.server.serverId,
        state.connection.generation,
        descriptor.name,
        state.promptArguments,
      );
      return true;
    },
    confirmPrompt() {
      const state = get();
      if (state.connection.status !== "connected" || state.promptPreview === undefined)
        return false;
      promptRequest = createRequestId();
      host.confirmMcpPrompt?.(
        promptRequest,
        state.connection.server.serverId,
        state.connection.generation,
        state.promptPreview.previewId,
      );
      return true;
    },
    cancelPrompt() {
      const state = get();
      if (state.connection.status !== "connected" || state.promptPreview === undefined)
        return false;
      promptRequest = createRequestId();
      host.cancelMcpPrompt?.(
        promptRequest,
        state.connection.server.serverId,
        state.connection.generation,
        state.promptPreview.previewId,
      );
      return true;
    },
    detachPrompt(previewId) {
      promptRequest = createRequestId();
      host.detachMcpPrompt?.(promptRequest, previewId);
    },
    clearDraft() {
      resourceRequest = undefined;
      promptRequest = undefined;
      set({
        attachments: [],
        confirmations: [],
        resourcePreview: undefined,
        promptPreview: undefined,
        busy: undefined,
        announcement: strings.mcpAnnouncements.draftCleared,
      });
    },
    receive(message) {
      if (message.type === "extension/mcp-connection") {
        if (connectionRequest !== undefined && message.requestId !== connectionRequest) return;
        if (message.requestId === connectionRequest) connectionRequest = undefined;
        const previousConnection = get().connection;
        const active = message.connection.status === "connected";
        const previousScope =
          previousConnection.status === "connected"
            ? {
                serverId: previousConnection.server.serverId,
                generation: previousConnection.generation,
              }
            : undefined;
        const nextScope =
          message.connection.status === "connected"
            ? {
                serverId: message.connection.server.serverId,
                generation: message.connection.generation,
              }
            : undefined;
        const scopeChanged =
          previousScope?.serverId !== nextScope?.serverId ||
          previousScope?.generation !== nextScope?.generation;
        if (scopeChanged) {
          clearToolCatalogWatermarks();
          clearDiagnosticWatermarks();
        }
        if (!active) clearDiagnosticWatermarks();
        toolCatalogDeliveryClosed = !active;
        set({
          connection: message.connection,
          busy: active && !scopeChanged ? get().busy : undefined,
          announcement: connectionAnnouncement(message.connection),
          ...(active && scopeChanged ? { tools: undefined } : {}),
          ...(active ? {} : clearLiveState()),
          ...(!active || scopeChanged
            ? { diagnostics: undefined, diagnosticAnnouncement: undefined }
            : {}),
        });
        return;
      }
      if (message.type === "extension/mcp-diagnostics") {
        receiveDiagnostic(set, get, message);
        return;
      }
      if (message.type === "extension/mcp-tool-catalog") {
        if (!toolCatalogDeliveryClosed && sameGeneration(get().connection, message.catalog)) {
          stageToolCatalog(set, message);
        }
        return;
      }
      if (message.type === "extension/mcp-tools") return;
      if (message.type === "extension/mcp-resources") {
        if (!sameGeneration(get().connection, message.catalog)) return;
        const selected = get().selectedResourceKey;
        set({
          resources: message.catalog,
          selectedResourceKey:
            findResource(message.catalog, selected) === undefined
              ? resourceKeys(message.catalog)[0]
              : selected,
          resourceArguments: {},
          resourcePreview: undefined,
        });
        return;
      }
      if (message.type === "extension/mcp-prompts") {
        if (!sameGeneration(get().connection, message.catalog)) return;
        const selected = get().selectedPromptName;
        set({
          prompts: message.catalog,
          selectedPromptName: message.catalog.prompts.some(({ name }) => name === selected)
            ? selected
            : message.catalog.prompts[0]?.name,
          promptArguments: {},
          promptPreview: undefined,
        });
        return;
      }
      if (
        message.type === "extension/mcp-resource-preview" &&
        message.requestId === resourceRequest
      ) {
        resourceRequest = undefined;
        if (message.status === "ready" && sameGeneration(get().connection, message.snapshot))
          set({
            busy: undefined,
            resourcePreview: { snapshotId: message.snapshotId, snapshot: message.snapshot },
            announcement: strings.mcpAnnouncements.resourceReady,
          });
        else if (message.status === "attached")
          set({
            busy: undefined,
            attachments: replaceBy(
              get().attachments,
              message.attachment,
              (item) => item.snapshotId,
            ),
            resourcePreview: undefined,
            announcement: strings.mcpAnnouncements.resourceAttached,
          });
        else if (message.status === "detached")
          set({
            attachments: get().attachments.filter(
              ({ snapshotId }) => snapshotId !== message.snapshotId,
            ),
            announcement: strings.mcpAnnouncements.resourceRemoved,
          });
        else if (message.status === "error")
          set({ busy: undefined, announcement: message.message });
        return;
      }
      if (message.type === "extension/mcp-prompt-preview" && message.requestId === promptRequest) {
        promptRequest = undefined;
        if (message.status === "ready" && sameGeneration(get().connection, message.preview))
          set({
            busy: undefined,
            promptPreview: message.preview,
            announcement: strings.mcpAnnouncements.promptReady,
          });
        else if (message.status === "confirmed")
          set({
            busy: undefined,
            confirmations: replaceBy(
              get().confirmations,
              { previewId: message.previewId, value: message.confirmation },
              (item) => item.previewId,
            ),
            promptPreview: undefined,
            announcement: strings.mcpAnnouncements.promptConfirmed,
          });
        else if (message.status === "cancelled")
          set({
            busy: undefined,
            promptPreview: undefined,
            announcement: strings.mcpAnnouncements.promptCancelled,
          });
        else if (message.status === "detached")
          set({
            confirmations: get().confirmations.filter(
              ({ previewId }) => previewId !== message.previewId,
            ),
            announcement: strings.mcpAnnouncements.promptRemoved,
          });
        else if (message.status === "error")
          set({ busy: undefined, promptPreview: undefined, announcement: message.message });
      }
    },
  }));
}

function clearLiveState() {
  return {
    tools: undefined,
    diagnostics: undefined,
    diagnosticAnnouncement: undefined,
    resources: undefined,
    prompts: undefined,
    selectedResourceKey: undefined,
    resourceArguments: {},
    resourcePreview: undefined,
    selectedPromptName: undefined,
    promptArguments: {},
    promptPreview: undefined,
  } as const;
}

interface ToolCatalogRecord {
  readonly requestId: string;
  readonly serverId: string;
  readonly generation: number;
  readonly catalogSequence: number;
  readonly catalog: McpToolCatalogProjectionDto;
}

interface DiagnosticRecord {
  readonly requestId: string;
  readonly serverId: string;
  readonly generation: number;
  readonly diagnosticSequence: number;
  readonly diagnostic: McpDiagnosticsProjectionDto;
}

function sameDiagnosticPublication(left: DiagnosticRecord, right: DiagnosticRecord): boolean {
  return (
    left.requestId === right.requestId &&
    left.serverId === right.serverId &&
    left.generation === right.generation &&
    left.diagnosticSequence === right.diagnosticSequence &&
    canonicalJson(left.diagnostic) === canonicalJson(right.diagnostic)
  );
}

function sameToolCatalogPublication(left: ToolCatalogRecord, right: ToolCatalogRecord): boolean {
  return (
    left.serverId === right.serverId &&
    left.generation === right.generation &&
    left.catalogSequence === right.catalogSequence &&
    left.requestId === right.requestId &&
    canonicalJson(left.catalog) === canonicalJson(right.catalog)
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function connectionAnnouncement(connection: McpConnectionDto): string {
  if (connection.status === "connected")
    return strings.mcpAnnouncements.connected(connection.server.displayName);
  if (connection.status === "failed") return connection.error.message;
  return strings.mcpAnnouncements.status(strings.mcp.connectionStatus[connection.status]);
}

function sameGeneration(
  connection: McpConnectionDto,
  value: { readonly server: { readonly serverId: string }; readonly generation: number },
): boolean {
  return (
    connection.status === "connected" &&
    connection.server.serverId === value.server.serverId &&
    connection.generation === value.generation
  );
}

function sameDiagnosticGeneration(
  connection: McpConnectionDto,
  value: {
    readonly server: { readonly serverId: string };
    readonly generation: number;
    readonly connectionStatus?: "connected" | "failed";
  },
): boolean {
  return (
    (connection.status === "connected" || connection.status === "failed") &&
    connection.server?.serverId === value.server.serverId &&
    connection.generation === value.generation &&
    (value.connectionStatus === undefined || connection.status === value.connectionStatus)
  );
}

function resourceKeys(catalog: McpResourceCatalogDto): string[] {
  return [
    ...catalog.resources.map(({ uri }) => `resource:${uri}`),
    ...catalog.templates.map(({ uriTemplate }) => `template:${uriTemplate}`),
  ];
}

function findResource(catalog: McpResourceCatalogDto | undefined, key: string | undefined) {
  if (catalog === undefined || key === undefined) return undefined;
  if (key.startsWith("resource:")) {
    const value = catalog.resources.find(({ uri }) => `resource:${uri}` === key);
    return value === undefined ? undefined : ({ kind: "resource", value } as const);
  }
  const value = catalog.templates.find(({ uriTemplate }) => `template:${uriTemplate}` === key);
  return value === undefined ? undefined : ({ kind: "template", value } as const);
}

function replaceBy<T>(values: readonly T[], value: T, key: (item: T) => string): T[] {
  return [...values.filter((item) => key(item) !== key(value)), value];
}
