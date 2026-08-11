import {
  type ExtensionToWebviewMessage,
  type ProviderAction,
  type ProviderActionErrorCode,
  protocolVersion,
} from "@ctrl-zebra/protocol";

export type ProviderOnboardingActionResult =
  | { readonly status: "completed" }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly code: ProviderActionErrorCode };

export interface ProviderOnboardingStatus {
  readonly provider: "openai" | "gemini" | "openai-compatible";
  readonly apiKeyConfigured: boolean;
  readonly modelConfigured: boolean;
}

export interface ProviderOnboardingHostActions {
  /**
   * Returns undefined when the Host cannot establish a trustworthy status projection.
   * Callers retain the last valid Webview projection rather than publishing false.
   */
  readonly readStatus: () => Promise<ProviderOnboardingStatus | undefined>;
  readonly run: (action: ProviderAction) => Promise<ProviderOnboardingActionResult | undefined>;
}

type PostMessage = (message: ExtensionToWebviewMessage) => void;

const actionFailureMessages = {
  configuration: "Check the CtrlZebra provider settings and try again.",
  storage: "The Provider setting could not be saved. Try again.",
  unavailable: "Model discovery is unavailable. Try again or enter a model ID manually.",
  internal: "The Provider action failed unexpectedly. Try again.",
} as const satisfies Readonly<Record<ProviderActionErrorCode, string>>;

export class ProviderOnboardingController {
  readonly #actions: ProviderOnboardingHostActions;
  #pendingActionRequestId: string | undefined;
  #disposed = false;

  constructor(actions: ProviderOnboardingHostActions) {
    this.#actions = actions;
  }

  async status(requestId: string, post: PostMessage): Promise<void> {
    if (this.#disposed || this.#pendingActionRequestId !== undefined) return;

    let status: ProviderOnboardingStatus | undefined;
    try {
      status = await this.#actions.readStatus();
    } catch {
      return;
    }
    if (this.#disposed || this.#pendingActionRequestId !== undefined || status === undefined)
      return;
    post({ protocolVersion, type: "extension/provider-status", requestId, ...status });
  }

  async action(requestId: string, action: ProviderAction, post: PostMessage): Promise<void> {
    if (this.#disposed || this.#pendingActionRequestId !== undefined) return;

    this.#pendingActionRequestId = requestId;
    try {
      let result: ProviderOnboardingActionResult | undefined;
      try {
        result = await this.#actions.run(action);
      } catch {
        result = { status: "failed", code: "internal" };
      }

      // Undefined is an internal suppression result (for example, a stale generation), not a
      // user cancellation. Do not publish an action outcome or refresh a potentially stale status.
      if (this.#disposed || result === undefined) return;
      post(createActionMessage(requestId, action, result));

      const status = await this.#actions.readStatus();
      if (!this.#disposed && status !== undefined) {
        post({ protocolVersion, type: "extension/provider-status", requestId, ...status });
      }
    } catch {
      // The terminal action outcome remains useful even if a status refresh cannot be read.
    } finally {
      this.#pendingActionRequestId = undefined;
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#pendingActionRequestId = undefined;
  }
}

function createActionMessage(
  requestId: string,
  action: ProviderAction,
  result: ProviderOnboardingActionResult,
): Extract<ExtensionToWebviewMessage, { type: "extension/provider-action" }> {
  if (result.status === "failed") {
    return {
      protocolVersion,
      type: "extension/provider-action",
      requestId,
      action,
      status: "failed",
      code: result.code,
      message: actionFailureMessages[result.code],
    };
  }

  return {
    protocolVersion,
    type: "extension/provider-action",
    requestId,
    action,
    status: result.status,
  };
}

export const providerOnboardingActionFailureMessages = actionFailureMessages;
