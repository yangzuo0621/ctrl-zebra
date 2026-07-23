import {
  ContextOverflowRecoveryExhaustedError,
  EmptyAgentResponseError,
  MaxToolStepsExceededError,
  ModelGatewayError,
  ToolRepetitionDetectedError,
  UnexpectedToolCallError,
} from "@ctrl-zebra/core";
import { describe, expect, it } from "vitest";

import { ApiKeySecretStorageError } from "../adapters/api-key-secret-storage.js";
import { MissingProviderApiKeyError } from "./model-gateway-selector.js";
import { getRunFailureLogEntry, mapRunErrorToUi } from "./run-error-mapper.js";

describe("mapRunErrorToUi", () => {
  it.each([
    [new ModelGatewayError("authentication"), "authentication"],
    [new MissingProviderApiKeyError("openai"), "authentication"],
    [new ApiKeySecretStorageError("read"), "authentication"],
    [new ModelGatewayError("unavailable"), "network"],
    [new ModelGatewayError("rate-limit"), "rate-limit"],
    [new ModelGatewayError("permission-denied"), "authentication"],
    [new ModelGatewayError("model-not-found"), "internal"],
    [new ModelGatewayError("invalid-request"), "internal"],
    [new ContextOverflowRecoveryExhaustedError(1, "retry-limit"), "context"],
    [new MaxToolStepsExceededError(8), "tool"],
    [new ToolRepetitionDetectedError("read_file", 3, 3), "tool"],
    [new ModelGatewayError("malformed-response"), "internal"],
    [new Error("third-party secret-token"), "internal"],
  ] as const)("maps %# to %s without exposing raw details", (error, expectedCode) => {
    const mapped = mapRunErrorToUi(error);

    expect(mapped.code).toBe(expectedCode);
    expect(mapped.message).not.toContain(error.message);
    expect(mapped.message).not.toContain("secret-token");
  });

  it("provides a distinct fixed prompt for every category", () => {
    const prompts = [
      new ModelGatewayError("authentication"),
      new ModelGatewayError("unavailable"),
      new ModelGatewayError("rate-limit"),
      new ModelGatewayError("permission-denied"),
      new ModelGatewayError("model-not-found"),
      new ModelGatewayError("invalid-request"),
      new ModelGatewayError("malformed-response"),
      new ModelGatewayError("unknown"),
      new ContextOverflowRecoveryExhaustedError(1, "retry-limit"),
      new MaxToolStepsExceededError(8),
      new Error("internal"),
    ].map((error) => mapRunErrorToUi(error).message);

    expect(new Set(prompts).size).toBe(11);
  });

  it.each([
    [
      "permission-denied",
      "The model provider denied access. Check the API key permissions and restrictions, then try again.",
    ],
    [
      "model-not-found",
      "The selected model was not found or is unavailable to this API key. Check the model ID and provider access.",
    ],
    [
      "invalid-request",
      "The model provider rejected the request. Check the saved API key, model ID, and endpoint configuration.",
    ],
    [
      "malformed-response",
      "The model provider returned an unexpected response. Check the provider endpoint or try again later.",
    ],
    ["unknown", "The model provider failed unexpectedly. Check its configuration and try again."],
  ] as const)("provides an actionable safe prompt for %s", (code, message) => {
    expect(mapRunErrorToUi(new ModelGatewayError(code))).toEqual({
      code: code === "permission-denied" ? "authentication" : "internal",
      message,
    });
  });

  it("creates a bounded Provider failure log entry without raw error details", () => {
    const error = new ModelGatewayError("model-not-found");
    Object.defineProperty(error, "message", { value: "secret-token", enumerable: true });

    expect(getRunFailureLogEntry(error)).toEqual({
      event: "run_failed",
      component: "agent_run",
      outcome: "failure",
      errorCode: "model-not-found",
    });
    expect(JSON.stringify(getRunFailureLogEntry(error))).not.toContain("secret-token");
    expect(getRunFailureLogEntry(new Error("secret-token"))).toEqual({
      event: "run_failed",
      component: "agent_run",
      outcome: "failure",
      errorCode: "internal",
    });
  });

  it("provides bounded safe prompts for tool limits and unusable completions", () => {
    expect(mapRunErrorToUi(new MaxToolStepsExceededError(8))).toEqual({
      code: "tool",
      message:
        "The agent stopped after reaching the 8-step tool limit. No additional tool was run.",
    });
    expect(mapRunErrorToUi(new UnexpectedToolCallError("read_file"))).toEqual({
      code: "tool",
      message:
        "The model requested a workspace tool that was not available for this request. No tool was run.",
    });
    expect(mapRunErrorToUi(new EmptyAgentResponseError(false))).toEqual({
      code: "internal",
      message: "The model completed without a usable response. Try again or rephrase the request.",
    });
    expect(mapRunErrorToUi(new EmptyAgentResponseError(true))).toEqual({
      code: "internal",
      message:
        "The model used tools but did not provide a final response. Review the tool results and try again.",
    });
  });
});
