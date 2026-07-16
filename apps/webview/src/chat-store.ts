import type { ExtensionToWebviewMessage, RunStatus } from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { WebviewHost } from "./vscode-api.js";

export interface DisplayMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}

interface ChatState {
  readonly messages: readonly DisplayMessage[];
  readonly status: "idle" | RunStatus;
  readonly activeRequestId?: string;
  submit(content: string): boolean;
  cancel(): void;
  receive(message: ExtensionToWebviewMessage): void;
  dispose(): void;
}

type ScheduleFlush = (callback: () => void) => () => void;

export interface ChatStoreOptions {
  readonly host: WebviewHost;
  readonly createRequestId?: () => string;
  readonly scheduleFlush?: ScheduleFlush;
}

const defaultScheduleFlush: ScheduleFlush = (callback) => {
  const frameId = requestAnimationFrame(callback);
  return () => cancelAnimationFrame(frameId);
};

export function createChatStore({
  host,
  createRequestId = () => crypto.randomUUID(),
  scheduleFlush = defaultScheduleFlush,
}: ChatStoreOptions): StoreApi<ChatState> {
  let pendingDelta = "";
  let cancelScheduledFlush: (() => void) | undefined;

  const store = createStore<ChatState>()((set, get) => {
    const applyPendingDelta = (terminalStatus?: RunStatus) => {
      cancelScheduledFlush?.();
      cancelScheduledFlush = undefined;
      const delta = pendingDelta;
      pendingDelta = "";

      set((state) => ({
        messages:
          delta.length === 0
            ? state.messages
            : state.messages.map((message) =>
                message.id === `${state.activeRequestId}:assistant`
                  ? { ...message, content: message.content + delta }
                  : message,
              ),
        status: terminalStatus ?? state.status,
        activeRequestId: terminalStatus === undefined ? state.activeRequestId : undefined,
      }));
    };

    const queueDelta = (text: string) => {
      pendingDelta += text;
      cancelScheduledFlush ??= scheduleFlush(() => applyPendingDelta());
    };

    return {
      messages: [],
      status: "idle",
      submit(content) {
        if (get().activeRequestId !== undefined || content.trim().length === 0) {
          return false;
        }

        const requestId = createRequestId();
        set((state) => ({
          messages: [
            ...state.messages,
            { id: `${requestId}:user`, role: "user", content },
            { id: `${requestId}:assistant`, role: "assistant", content: "" },
          ],
          status: "preparing",
          activeRequestId: requestId,
        }));
        host.submit(requestId, content);
        return true;
      },
      cancel() {
        const { activeRequestId } = get();
        if (activeRequestId !== undefined) {
          host.cancel(activeRequestId);
        }
      },
      receive(message) {
        const state = get();
        if (message.requestId !== state.activeRequestId) {
          return;
        }

        if (message.type === "extension/text-delta") {
          if (state.status === "preparing" || state.status === "streaming") {
            queueDelta(message.text);
          }
          return;
        }

        if (message.type === "extension/run-status") {
          if (
            message.status === "completed" ||
            message.status === "cancelled" ||
            message.status === "failed"
          ) {
            applyPendingDelta(message.status);
          } else {
            set({ status: message.status });
          }
        }
      },
      dispose() {
        cancelScheduledFlush?.();
        cancelScheduledFlush = undefined;
        pendingDelta = "";
      },
    };
  });

  return store;
}
