import {
  ContextOverflowRecoveryExhaustedError,
  MaxToolStepsExceededError,
  ModelGatewayError,
  ToolRepetitionDetectedError,
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
});
