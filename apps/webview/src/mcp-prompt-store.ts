import type {
  ExtensionToWebviewMessage,
  McpPromptArgumentsDto,
  McpPromptCatalogDto,
  McpPromptConfirmation,
  McpPromptPreviewDto,
} from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

export interface McpPromptStoreHost {
  previewPrompt(
    requestId: string,
    serverId: string,
    generation: number,
    promptName: string,
    argumentsValue: McpPromptArgumentsDto,
  ): void;
  confirmPrompt(requestId: string, serverId: string, generation: number, previewId: string): void;
  cancelPrompt(requestId: string, serverId: string, generation: number, previewId: string): void;
}

export interface McpPromptState {
  readonly catalog?: McpPromptCatalogDto;
  readonly selectedPromptName?: string;
  readonly arguments: McpPromptArgumentsDto;
  readonly preview?: McpPromptPreviewDto;
  readonly confirmation?: McpPromptConfirmation;
  readonly status: "idle" | "previewing" | "ready" | "confirming" | "confirmed" | "error";
  readonly message?: string;
  selectPrompt(name: string): void;
  setArgument(name: string, value: string): void;
  requestPreview(): boolean;
  confirm(): boolean;
  cancel(): boolean;
  receive(message: ExtensionToWebviewMessage): void;
  invalidate(): void;
}

export function createMcpPromptStore(
  host: McpPromptStoreHost,
  createRequestId: () => string = () => crypto.randomUUID(),
): StoreApi<McpPromptState> {
  let previewRequestId: string | undefined;
  let actionRequestId: string | undefined;
  return createStore<McpPromptState>()((set, get) => {
    const invalidate = () => {
      previewRequestId = undefined;
      actionRequestId = undefined;
      set({ preview: undefined, confirmation: undefined, status: "idle", message: undefined });
    };
    return {
      arguments: {},
      status: "idle",
      selectPrompt(name) {
        const descriptor = get().catalog?.prompts.find((prompt) => prompt.name === name);
        if (descriptor === undefined) return;
        previewRequestId = undefined;
        actionRequestId = undefined;
        set({
          selectedPromptName: name,
          arguments: {},
          preview: undefined,
          confirmation: undefined,
          status: "idle",
          message: undefined,
        });
      },
      setArgument(name, value) {
        const { catalog, selectedPromptName, arguments: currentArguments } = get();
        const descriptor = catalog?.prompts.find((prompt) => prompt.name === selectedPromptName);
        if (descriptor?.arguments.some((argument) => argument.name === name) !== true) return;
        previewRequestId = undefined;
        actionRequestId = undefined;
        set({
          arguments: { ...currentArguments, [name]: value },
          preview: undefined,
          confirmation: undefined,
          status: "idle",
          message: undefined,
        });
      },
      requestPreview() {
        const { catalog, selectedPromptName, arguments: values, status } = get();
        const descriptor = catalog?.prompts.find((prompt) => prompt.name === selectedPromptName);
        if (
          catalog === undefined ||
          descriptor === undefined ||
          status === "previewing" ||
          status === "confirming" ||
          descriptor.arguments.some(({ name, required }) => required && !(name in values)) ||
          Object.keys(values).some(
            (name) => !descriptor.arguments.some((argument) => argument.name === name),
          )
        ) {
          return false;
        }
        previewRequestId = createRequestId();
        actionRequestId = undefined;
        set({
          status: "previewing",
          preview: undefined,
          confirmation: undefined,
          message: undefined,
        });
        host.previewPrompt(
          previewRequestId,
          catalog.server.serverId,
          catalog.generation,
          descriptor.name,
          values,
        );
        return true;
      },
      confirm() {
        const { preview, status } = get();
        if (preview === undefined || status !== "ready") return false;
        actionRequestId = createRequestId();
        set({ status: "confirming", message: undefined });
        host.confirmPrompt(
          actionRequestId,
          preview.server.serverId,
          preview.generation,
          preview.previewId,
        );
        return true;
      },
      cancel() {
        const { preview } = get();
        if (preview === undefined) return false;
        actionRequestId = createRequestId();
        host.cancelPrompt(
          actionRequestId,
          preview.server.serverId,
          preview.generation,
          preview.previewId,
        );
        return true;
      },
      receive(message) {
        if (message.type === "extension/mcp-prompts") {
          const selected = get().selectedPromptName;
          previewRequestId = undefined;
          actionRequestId = undefined;
          set({
            catalog: message.catalog,
            selectedPromptName: message.catalog.prompts.some(({ name }) => name === selected)
              ? selected
              : message.catalog.prompts[0]?.name,
            arguments: {},
            preview: undefined,
            confirmation: undefined,
            status: "idle",
            message: undefined,
          });
          return;
        }
        if (message.type !== "extension/mcp-prompt-preview") return;
        if (message.status === "ready" && message.requestId === previewRequestId) {
          previewRequestId = undefined;
          set({ preview: message.preview, status: "ready", message: undefined });
          return;
        }
        if (message.requestId !== actionRequestId && message.requestId !== previewRequestId) return;
        previewRequestId = undefined;
        actionRequestId = undefined;
        if (message.status === "confirmed") {
          set({ confirmation: message.confirmation, preview: undefined, status: "confirmed" });
        } else if (message.status === "cancelled") {
          set({ preview: undefined, confirmation: undefined, status: "idle" });
        } else if (message.status === "error") {
          set({
            preview: undefined,
            confirmation: undefined,
            status: "error",
            message: message.message,
          });
        }
      },
      invalidate,
    };
  });
}
