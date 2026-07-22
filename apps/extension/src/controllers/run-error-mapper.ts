import {
  ContextOverflowRecoveryExhaustedError,
  InvalidContextRecoverySummaryError,
  InvalidContextWindowError,
  InvalidHistoryBudgetError,
  InvalidModelHistoryError,
  InvalidModelMessageTokenCountError,
  MaxToolStepsExceededError,
  ModelGatewayError,
  ToolRepetitionDetectedError,
} from "@ctrl-zebra/core";
import type { RunErrorCode, RunErrorMessage } from "@ctrl-zebra/protocol";

import { ApiKeySecretStorageError } from "../adapters/api-key-secret-storage.js";
import { MissingProviderApiKeyError } from "./model-gateway-selector.js";

type RunErrorDto = Pick<RunErrorMessage, "code" | "message">;

const messages = {
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

export function mapRunErrorToUi(error: unknown): RunErrorDto {
  const code = classifyRunError(error);
  return { code, message: messages[code] };
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

  if (error instanceof MaxToolStepsExceededError || error instanceof ToolRepetitionDetectedError) {
    return "tool";
  }

  return "internal";
}
