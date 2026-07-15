import { describe, expect, it } from "vitest";

import { ModelGatewayError, type ModelGatewayErrorCode } from "./index.js";

describe("ModelGatewayError", () => {
  it.each([
    "authentication",
    "rate-limit",
    "invalid-request",
    "unavailable",
    "malformed-response",
    "unknown",
  ] as const satisfies readonly ModelGatewayErrorCode[])("exposes the stable %s category without provider details", (code) => {
    const error = new ModelGatewayError(code);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ModelGatewayError");
    expect(error.code).toBe(code);
    expect(error.message).toBe(`Model provider failed with category: ${code}.`);
  });
});
