import type { DiagnosticsExportDocument, ExtensionToWebviewMessage } from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import { strings } from "./strings.js";
import type { WebviewHost } from "./vscode-api.js";

export type DiagnosticsExportStatus =
  | "idle"
  | "preparing"
  | "ready"
  | "exporting"
  | "completed"
  | "cancelled"
  | "error";

export interface DiagnosticsExportState {
  readonly status: DiagnosticsExportStatus;
  readonly requestId?: string;
  readonly exportId?: string;
  readonly target?: string;
  readonly document?: DiagnosticsExportDocument;
  readonly content?: string;
  readonly message?: string;
  readonly announcement: string;
  start(): boolean;
  confirm(): boolean;
  cancel(): boolean;
  clear(): void;
  receive(message: ExtensionToWebviewMessage): void;
  dispose(): void;
}

export function createDiagnosticsExportStore(
  host: WebviewHost,
  createRequestId: () => string = () => crypto.randomUUID(),
): StoreApi<DiagnosticsExportState> {
  let disposed = false;

  return createStore<DiagnosticsExportState>()((set, get) => ({
    status: "idle",
    announcement: "",
    start() {
      if (
        disposed ||
        get().status === "preparing" ||
        get().status === "ready" ||
        get().status === "exporting" ||
        host.requestDiagnosticsExport === undefined
      ) {
        return false;
      }
      const requestId = createRequestId();
      set({
        status: "preparing",
        requestId,
        exportId: undefined,
        target: undefined,
        document: undefined,
        content: undefined,
        message: undefined,
        announcement: strings.diagnosticsExport.preparing,
      });
      host.requestDiagnosticsExport(requestId);
      return true;
    },
    confirm() {
      const state = get();
      if (
        disposed ||
        state.status !== "ready" ||
        state.requestId === undefined ||
        state.exportId === undefined ||
        host.confirmDiagnosticsExport === undefined
      ) {
        return false;
      }
      set({
        status: "exporting",
        message: undefined,
        announcement: strings.diagnosticsExport.exporting,
      });
      host.confirmDiagnosticsExport(state.requestId, state.exportId);
      return true;
    },
    cancel() {
      const state = get();
      if (
        disposed ||
        state.status !== "ready" ||
        state.requestId === undefined ||
        state.exportId === undefined ||
        host.cancelDiagnosticsExport === undefined
      ) {
        return false;
      }
      set({
        status: "cancelled",
        message: strings.diagnosticsExport.cancelled,
        announcement: strings.diagnosticsExport.cancelled,
      });
      host.cancelDiagnosticsExport(state.requestId, state.exportId);
      return true;
    },
    clear() {
      set({
        status: "idle",
        requestId: undefined,
        exportId: undefined,
        target: undefined,
        document: undefined,
        content: undefined,
        message: undefined,
        announcement: "",
      });
    },
    receive(message) {
      if (disposed || message.type !== "extension/diagnostics-export-preview") return;
      const state = get();
      if (state.requestId !== message.requestId) return;
      if (message.status === "ready") {
        set({
          status: "ready",
          exportId: message.exportId,
          target: message.target,
          document: message.document,
          content: message.content,
          message: undefined,
          announcement: strings.diagnosticsExport.ready,
        });
        return;
      }
      set({
        status:
          message.status === "completed"
            ? "completed"
            : message.status === "cancelled"
              ? "cancelled"
              : "error",
        exportId: undefined,
        target: undefined,
        document: undefined,
        content: undefined,
        message: message.message,
        announcement:
          message.status === "completed"
            ? strings.diagnosticsExport.completed
            : message.status === "cancelled"
              ? strings.diagnosticsExport.cancelled
              : strings.diagnosticsExport.failed,
      });
    },
    dispose() {
      disposed = true;
      set({
        status: "idle",
        requestId: undefined,
        exportId: undefined,
        target: undefined,
        document: undefined,
        content: undefined,
        message: undefined,
      });
    },
  }));
}
