import { describe, expect, it } from "vitest";

import {
  createWorkspaceTrustPolicy,
  WorkspaceTrustRequiredError,
} from "./workspace-trust-policy.js";

describe("WorkspaceTrustPolicy", () => {
  it("allows trusted workspace operations", () => {
    const policy = createWorkspaceTrustPolicy(() => true);

    expect(policy.isTrusted()).toBe(true);
    expect(() => policy.requireTrusted()).not.toThrow();
  });

  it("rejects untrusted workspace operations", () => {
    const policy = createWorkspaceTrustPolicy(() => false);

    expect(policy.isTrusted()).toBe(false);
    expect(() => policy.requireTrusted()).toThrow(WorkspaceTrustRequiredError);
  });

  it("reads the current host-owned state on every check", () => {
    let trusted = false;
    const policy = createWorkspaceTrustPolicy(() => trusted);

    expect(() => policy.requireTrusted()).toThrow(WorkspaceTrustRequiredError);
    trusted = true;
    expect(() => policy.requireTrusted()).not.toThrow();
  });
});
