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
  ] as const satisfies readonly ModelGatewayErrorCode[])(
    "exposes the stable %s category without provider details",
    (code) => {
      const error = new ModelGatewayError(code);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("ModelGatewayError");
      expect(error.code).toBe(code);
      expect(error.message).toBe(`Model provider failed with category: ${code}.`);
    },
  );

  it("retains an internal cause without serializing it", () => {
    const cause = new Error("provider secret");
    const error = new ModelGatewayError("unavailable", { cause });

    expect(error.cause).toBe(cause);
    expect(JSON.stringify(error)).not.toContain("provider secret");
  });

  it("is undefined by default", () => {
    expect(new ModelGatewayError("rate-limit").retryAfterMilliseconds).toBeUndefined();
  });

  it("exposes a valid Provider-requested retryAfterMilliseconds", () => {
    const error = new ModelGatewayError("rate-limit", { retryAfterMilliseconds: 30_000 });

    expect(error.retryAfterMilliseconds).toBe(30_000);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "treats an invalid retryAfterMilliseconds (%s) as absent rather than propagating it",
    (invalid) => {
      const error = new ModelGatewayError("rate-limit", { retryAfterMilliseconds: invalid });

      expect(error.retryAfterMilliseconds).toBeUndefined();
    },
  );

  it("accepts a zero retryAfterMilliseconds (retry immediately)", () => {
    const error = new ModelGatewayError("rate-limit", { retryAfterMilliseconds: 0 });

    expect(error.retryAfterMilliseconds).toBe(0);
  });
});
