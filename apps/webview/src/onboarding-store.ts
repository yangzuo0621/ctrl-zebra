import type {
  ExtensionToWebviewMessage,
  ProviderAction,
  ProviderActionMessage,
  ProviderStatusMessage,
} from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import { strings } from "./strings.js";
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
  clearLocal(): void;
  refresh(): boolean;
  runAction(action: ProviderAction): boolean;
  receive(message: ExtensionToWebviewMessage): void;
  dispose(): void;
}

export function createOnboardingStore(
  host: WebviewHost,
  createRequestId: () => string = () => crypto.randomUUID(),
): StoreApi<ProviderOnboardingState> {
  let statusRequestId: string | undefined;
  let postActionStatusRequestId: string | undefined;
  let disposed = false;

  return createStore<ProviderOnboardingState>()((set, get) => ({
    announcement: strings.provider.checking,
    clearLocal() {
      statusRequestId = undefined;
      postActionStatusRequestId = undefined;
      set({
        status: undefined,
        pendingAction: undefined,
        actionOutcome: undefined,
        announcement: strings.provider.cleared,
      });
    },
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
      set({ announcement: strings.provider.checking });
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
      statusRequestId = undefined;
      set({
        pendingAction: { requestId, action },
        actionOutcome: undefined,
        announcement: strings.onboarding.actionInProgress(strings.onboarding.actionLabels[action]),
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
    return strings.onboarding.actionCompleted(strings.onboarding.actionLabels[message.action]);
  }
  if (message.status === "cancelled") {
    return strings.onboarding.actionCancelled(strings.onboarding.actionLabels[message.action]);
  }
  return strings.onboarding.actionFailed(strings.onboarding.actionLabels[message.action]);
}
