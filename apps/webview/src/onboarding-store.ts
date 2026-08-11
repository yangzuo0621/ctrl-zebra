import type {
  ExtensionToWebviewMessage,
  ProviderAction,
  ProviderActionMessage,
  ProviderStatusMessage,
} from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { WebviewHost } from "./vscode-api.js";

export interface PendingProviderAction {
  readonly requestId: string;
  readonly action: ProviderAction;
}

export interface ProviderOnboardingState {
  readonly status?: ProviderStatusMessage;
  readonly pendingAction?: PendingProviderAction;
  readonly actionOutcome?: ProviderActionMessage;
  readonly announcement: string;
  refresh(): boolean;
  runAction(action: ProviderAction): boolean;
  receive(message: ExtensionToWebviewMessage): void;
  dispose(): void;
}

const actionLabels = {
  "save-key": "Save API key",
  "select-model": "Select model",
  "open-settings": "Open Provider settings",
} as const satisfies Record<ProviderAction, string>;

export function createOnboardingStore(
  host: WebviewHost,
  createRequestId: () => string = () => crypto.randomUUID(),
): StoreApi<ProviderOnboardingState> {
  let statusRequestId: string | undefined;
  let postActionStatusRequestId: string | undefined;
  let disposed = false;

  return createStore<ProviderOnboardingState>()((set, get) => ({
    announcement: "Checking Provider configuration.",
    refresh() {
      if (
        disposed ||
        get().pendingAction !== undefined ||
        host.requestProviderStatus === undefined
      ) {
        return false;
      }
      const requestId = createRequestId();
      statusRequestId = requestId;
      set({ announcement: "Checking Provider configuration." });
      host.requestProviderStatus(requestId);
      return true;
    },
    runAction(action) {
      if (disposed || get().pendingAction !== undefined) return false;
      const requestId = createRequestId();
      const dispatch = {
        "save-key": host.saveProviderKey,
        "select-model": host.selectProviderModel,
        "open-settings": host.openProviderSettings,
      }[action];
      if (dispatch === undefined) return false;
      set({
        pendingAction: { requestId, action },
        actionOutcome: undefined,
        announcement: `${actionLabels[action]} in progress.`,
      });
      dispatch(requestId);
      return true;
    },
    receive(message) {
      if (disposed) return;

      if (message.type === "extension/provider-action") {
        const pending = get().pendingAction;
        if (
          pending === undefined ||
          pending.requestId !== message.requestId ||
          pending.action !== message.action
        ) {
          return;
        }
        postActionStatusRequestId = message.requestId;
        set({
          pendingAction: undefined,
          actionOutcome: message,
          announcement: actionAnnouncement(message),
        });
        return;
      }

      if (message.type !== "extension/provider-status") return;
      if (message.requestId === statusRequestId) {
        statusRequestId = undefined;
        set({ status: message });
        return;
      }
      if (message.requestId === postActionStatusRequestId) {
        postActionStatusRequestId = undefined;
        set({ status: message });
      }
    },
    dispose() {
      disposed = true;
      statusRequestId = undefined;
      postActionStatusRequestId = undefined;
      set({ pendingAction: undefined });
    },
  }));
}

function actionAnnouncement(message: ProviderActionMessage): string {
  if (message.status === "completed") {
    return `${actionLabels[message.action]} completed.`;
  }
  if (message.status === "cancelled") {
    return `${actionLabels[message.action]} cancelled.`;
  }
  return `${actionLabels[message.action]} failed. Try again.`;
}
