import type { CheckpointSummary, ExtensionToWebviewMessage } from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { WebviewHost } from "./vscode-api.js";

export interface CheckpointState {
  readonly checkpoints: readonly CheckpointSummary[];
  readonly selectedCheckpointId?: string;
  readonly status: "idle" | "loading" | "restoring" | "restored" | "error";
  readonly message?: string;
  load(): void;
  select(checkpointId: string): void;
  restoreSelected(): boolean;
  receive(message: ExtensionToWebviewMessage): void;
}

export function createCheckpointStore(
  host: WebviewHost,
  createRequestId: () => string = () => crypto.randomUUID(),
): StoreApi<CheckpointState> {
  let listRequestId: string | undefined;
  let restoreRequestId: string | undefined;
  return createStore<CheckpointState>()((set, get) => ({
    checkpoints: [],
    status: "idle",
    load() {
      listRequestId = createRequestId();
      set({ status: "loading", message: undefined });
      host.listCheckpoints(listRequestId);
    },
    select(checkpointId) {
      set({ selectedCheckpointId: checkpointId.length === 0 ? undefined : checkpointId });
    },
    restoreSelected() {
      const { selectedCheckpointId, status } = get();
      if (selectedCheckpointId === undefined || status === "restoring") {
        return false;
      }
      restoreRequestId = createRequestId();
      set({ status: "restoring", message: "Restoring Checkpoint…" });
      host.restoreCheckpoint(restoreRequestId, selectedCheckpointId);
      return true;
    },
    receive(message) {
      if (message.type === "extension/checkpoint-list" && message.requestId === listRequestId) {
        listRequestId = undefined;
        set({
          checkpoints: message.checkpoints,
          selectedCheckpointId: message.checkpoints[0]?.id,
          status: "idle",
          message: undefined,
        });
        return;
      }
      if (
        message.type === "extension/checkpoint-restored" &&
        message.requestId === restoreRequestId
      ) {
        restoreRequestId = undefined;
        set({ status: "restored", message: "Checkpoint restored." });
        return;
      }
      if (
        message.type === "extension/checkpoint-error" &&
        (message.requestId === listRequestId || message.requestId === restoreRequestId)
      ) {
        listRequestId = undefined;
        restoreRequestId = undefined;
        set({ status: "error", message: message.message });
      }
    },
  }));
}
