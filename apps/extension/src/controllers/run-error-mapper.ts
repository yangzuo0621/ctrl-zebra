import {
  ContextOverflowRecoveryExhaustedError,
  EmptyAgentResponseError,
  InvalidContextRecoverySummaryError,
  InvalidContextWindowError,
  InvalidHistoryBudgetError,
  InvalidModelHistoryError,
  InvalidModelMessageTokenCountError,
  MaxToolStepsExceededError,
  ModelGatewayError,
  ToolRepetitionDetectedError,
  UnexpectedToolCallError,
} from "@ctrl-zebra/core";
import type { RunErrorCode, RunErrorMessage } from "@ctrl-zebra/protocol";

import { ApiKeySecretStorageError } from "../adapters/api-key-secret-storage.js";
import {
  ProviderConfigurationError,
  type ProviderConfigurationErrorCode,
} from "../adapters/provider-configuration.js";
import {
  MissingProviderApiKeyError,
  ProviderAdapterUnavailableError,
  ProviderCapabilityMismatchError,
} from "./model-gateway-selector.js";

type RunErrorDto = Pick<RunErrorMessage, "code" | "message">;

const messages = {
  configuration:
    "The model provider configuration is invalid. Review the CtrlZebra provider settings and try again.",
  authentication:
    "Authentication failed. Check the selected provider and saved API key, then try again.",
  network: "The model provider is unavailable. Check your connection and try again.",
  "rate-limit": "The model provider rate limit was reached. Wait a moment, then try again.",
  context:
    "The conversation exceeds the model context limit. Start a new chat or shorten the request.",
  tool: "The agent stopped because tool execution could not continue. Review the tool results and try again.",
  internal:
    "CtrlZebra encountered an internal error. Try again or reload the window if it continues.",
} as const satisfies Readonly<Record<RunErrorCode, string>>;

const providerConfigurationMessages = {
  "unknown-provider": "Select a supported model provider: OpenAI, Gemini, or OpenAI-Compatible.",
  "missing-model": "Configure a model ID before starting a chat.",
  "invalid-model":
    "The configured model ID must be a non-empty string without surrounding whitespace.",
  "missing-endpoint": "OpenAI-Compatible requires an endpoint URL.",
  "invalid-endpoint":
    "Use an HTTPS endpoint, or HTTP only with an explicit local loopback address.",
  "invalid-capabilities":
    "Capabilities must be a unique list containing only text-streaming or tool-calling.",
} as const satisfies Readonly<Record<ProviderConfigurationErrorCode, string>>;

const providerMessages = {
  "permission-denied":
    "The model provider denied access. Check the API key permissions and restrictions, then try again.",
  "model-not-found":
    "The selected model was not found or is unavailable to this API key. Check the model ID and provider access.",
  "invalid-request":
    "The model provider rejected the request. Check the saved API key, model ID, and endpoint configuration.",
  "malformed-response":
    "The model provider returned an unexpected response. Check the provider endpoint or try again later.",
  unknown: "The model provider failed unexpectedly. Check its configuration and try again.",
} as const satisfies Readonly<
  Record<
    Extract<
      ModelGatewayError["code"],
      "permission-denied" | "model-not-found" | "invalid-request" | "malformed-response" | "unknown"
    >,
    string
  >
>;

export interface RunFailureLogEntry {
  readonly event: "run_failed";
  readonly component: "agent_run";
  readonly outcome: "failure";
  readonly errorCode: string;
}

export function mapRunErrorToUi(error: unknown): RunErrorDto {
  if (error instanceof ProviderConfigurationError) {
    return {
      code: "configuration",
      message: providerConfigurationMessages[error.code],
    };
  }

  if (error instanceof ModelGatewayError && error.code in providerMessages) {
    const code = error.code as keyof typeof providerMessages;
    return {
      code: code === "permission-denied" ? "authentication" : "internal",
      message: providerMessages[code],
    };
  }

  if (error instanceof MaxToolStepsExceededError) {
    return {
      code: "tool",
      message: `The agent stopped after reaching the ${error.maxToolSteps}-step tool limit. No additional tool was run.`,
    };
  }

  if (error instanceof UnexpectedToolCallError) {
    return {
      code: "tool",
      message:
        "The model requested a workspace tool that was not available for this request. No tool was run.",
    };
  }

  if (error instanceof EmptyAgentResponseError) {
    return {
      code: "internal",
      message: error.followedToolUse
        ? "The model used tools but did not provide a final response. Review the tool results and try again."
        : "The model completed without a usable response. Try again or rephrase the request.",
    };
  }

  const code = classifyRunError(error);
  return { code, message: messages[code] };
}

export function getRunFailureLogEntry(error: unknown): RunFailureLogEntry {
  return {
    event: "run_failed",
    component: "agent_run",
    outcome: "failure",
    errorCode: classifyRunFailureForLog(error),
  };
}

function classifyRunFailureForLog(error: unknown): string {
  if (error instanceof ModelGatewayError) {
    return error.code;
  }

  if (error instanceof ProviderConfigurationError) {
    return `provider-${error.code}`;
  }

  if (error instanceof ApiKeySecretStorageError) {
    return `secret-storage-${error.operation}`;
  }

  if (error instanceof MissingProviderApiKeyError) {
    return "missing-api-key";
  }

  if (error instanceof ProviderCapabilityMismatchError) {
    return "provider-capability-mismatch";
  }

  if (error instanceof ProviderAdapterUnavailableError) {
    return "provider-adapter-unavailable";
  }

  return "internal";
}

function classifyRunError(error: unknown): RunErrorCode {
  if (
    error instanceof MissingProviderApiKeyError ||
    error instanceof ApiKeySecretStorageError ||
    (error instanceof ModelGatewayError && error.code === "authentication")
  ) {
    return "authentication";
  }

  if (error instanceof ModelGatewayError && error.code === "rate-limit") {
    return "rate-limit";
  }

  if (error instanceof ModelGatewayError && error.code === "unavailable") {
    return "network";
  }

  if (
    error instanceof ContextOverflowRecoveryExhaustedError ||
    error instanceof InvalidContextRecoverySummaryError ||
    error instanceof InvalidContextWindowError ||
    error instanceof InvalidHistoryBudgetError ||
    error instanceof InvalidModelHistoryError ||
    error instanceof InvalidModelMessageTokenCountError
  ) {
    return "context";
  }

  if (error instanceof ToolRepetitionDetectedError) {
    return "tool";
  }

  return "internal";
}
