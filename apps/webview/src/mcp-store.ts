import type {
  ExtensionToWebviewMessage,
  McpConnectionDto,
  McpPromptArgumentsDto,
  McpPromptCatalogDto,
  McpPromptConfirmation,
  McpPromptPreviewDto,
  McpResourceAttachment,
  McpResourceCatalogDto,
  McpResourceSelectionDto,
  McpResourceSnapshotDto,
  McpToolCatalogDto,
  McpToolRejectionCatalogDto,
} from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import { strings } from "./strings.js";
import type { WebviewHost } from "./vscode-api.js";

export interface McpState {
  readonly connection: McpConnectionDto;
  readonly tools?: McpToolCatalogDto;
  readonly toolRejections?: McpToolRejectionCatalogDto;
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
  readonly busy?: "connecting" | "disconnecting" | "resource" | "prompt";
  readonly announcement: string;
  connect(): void;
  disconnect(): void;
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
  let latestToolRequestId: string | undefined;
  let pendingToolPair:
    | {
        readonly requestId: string;
        readonly serverId: string;
        readonly generation: number;
        tools?: McpToolCatalogDto;
        rejections?: McpToolRejectionCatalogDto;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;

  const clearPendingToolPair = (): void => {
    if (pendingToolPair !== undefined) clearTimeout(pendingToolPair.timer);
    pendingToolPair = undefined;
  };

  const stageToolPart = (
    setState: StoreApi<McpState>["setState"],
    requestId: string,
    value: McpToolCatalogDto | McpToolRejectionCatalogDto,
  ): void => {
    const serverId = value.server.serverId;
    const generation = value.generation;
    if (pendingToolPair !== undefined && pendingToolPair.requestId !== requestId) {
      return;
    }
    if (
      pendingToolPair !== undefined &&
      (pendingToolPair.serverId !== serverId || pendingToolPair.generation !== generation)
    ) {
      clearPendingToolPair();
      return;
    }
    if (pendingToolPair === undefined && latestToolRequestId !== requestId) {
      latestToolRequestId = requestId;
    }
    if (latestToolRequestId === undefined) latestToolRequestId = requestId;
    if (pendingToolPair === undefined) {
      const timer = setTimeout(() => {
        pendingToolPair = undefined;
      }, 1_000);
      pendingToolPair = { requestId, serverId, generation, timer };
    }
    if ("tools" in value) pendingToolPair.tools = value;
    else pendingToolPair.rejections = value;
    if (pendingToolPair.tools !== undefined && pendingToolPair.rejections !== undefined) {
      const pair = pendingToolPair;
      clearPendingToolPair();
      setState({ tools: pair.tools, toolRejections: pair.rejections });
    }
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
      set({ busy: "connecting", announcement: strings.mcpAnnouncements.connecting });
      host.connectMcp?.(connectionRequest);
    },
    disconnect() {
      connectionRequest = createRequestId();
      resourceRequest = undefined;
      promptRequest = undefined;
      clearPendingToolPair();
      latestToolRequestId = undefined;
      set({ busy: "disconnecting", announcement: strings.mcpAnnouncements.disconnecting });
      host.disconnectMcp?.(connectionRequest);
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
      clearPendingToolPair();
      latestToolRequestId = undefined;
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
        clearPendingToolPair();
        const active = message.connection.status === "connected";
        latestToolRequestId = active ? message.requestId : undefined;
        set({
          connection: message.connection,
          busy: undefined,
          announcement: connectionAnnouncement(message.connection),
          ...(active ? {} : clearLiveState()),
        });
        return;
      }
      if (message.type === "extension/mcp-tools") {
        if (sameGeneration(get().connection, message.catalog)) {
          stageToolPart(set, message.requestId, message.catalog);
        }
        return;
      }
      if (message.type === "extension/mcp-tool-rejections") {
        if (sameGeneration(get().connection, message.catalog)) {
          stageToolPart(set, message.requestId, message.catalog);
        }
        return;
      }
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
    toolRejections: undefined,
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
