import { describe, expect, it } from "vitest";

import {
  createProviderEndpointPolicy,
  ProviderEndpointPolicyError,
} from "./provider-endpoint-policy.js";

describe("Provider endpoint policy", () => {
  const policy = createProviderEndpointPolicy();

  it.each([
    ["https://models.example.test/v1", true],
    ["http://localhost:11434/v1", false],
    ["http://127.24.0.1:11434/v1", false],
    ["http://[::1]:11434/v1", false],
  ] as const)("normalizes %s with requiresApiKey=%s", (endpoint, requiresApiKey) => {
    expect(policy.evaluate(endpoint)).toEqual({ value: endpoint, requiresApiKey });
  });

  it("returns the URL-normalized endpoint without weakening its policy", () => {
    expect(policy.evaluate("HTTPS://MODELS.EXAMPLE.TEST:443/v1")).toEqual({
      value: "https://models.example.test/v1",
      requiresApiKey: true,
    });
  });

  it.each([undefined, ""] as const)("treats %s as an absent optional endpoint", (endpoint) => {
    expect(policy.evaluate(endpoint)).toBeUndefined();
  });

  it.each([
    "http://models.example.test/v1",
    "http://localhost.example.test/v1",
    "https://user:secret@models.example.test/v1",
    "https://models.example.test/v1?key=x",
    "https://models.example.test/v1#fragment",
    "not-an-endpoint",
  ])("rejects endpoint %s before callers can use it", (endpoint) => {
    expect(() => policy.evaluate(endpoint)).toThrow(ProviderEndpointPolicyError);
  });

  it("does not echo rejected endpoint input in the policy error", () => {
    const endpoint = "http://user:secret@remote.example.test/v1";

    expect(() => policy.evaluate(endpoint)).toThrowError(
      expect.not.objectContaining({ message: expect.stringContaining(endpoint) }),
    );
  });
});
