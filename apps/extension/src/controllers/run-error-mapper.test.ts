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
import { mapRunErrorToUi } from "./run-error-mapper.js";

describe("mapRunErrorToUi", () => {
  it.each([
    [new ModelGatewayError("authentication"), "authentication"],
    [new MissingProviderApiKeyError("openai"), "authentication"],
    [new ApiKeySecretStorageError("read"), "authentication"],
    [new ModelGatewayError("unavailable"), "network"],
    [new ModelGatewayError("rate-limit"), "rate-limit"],
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
      new ContextOverflowRecoveryExhaustedError(1, "retry-limit"),
      new MaxToolStepsExceededError(8),
      new Error("internal"),
    ].map((error) => mapRunErrorToUi(error).message);

    expect(new Set(prompts).size).toBe(6);
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
