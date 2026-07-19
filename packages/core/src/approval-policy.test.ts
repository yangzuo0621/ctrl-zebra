import type { ToolRisk } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import { type ApprovalPolicyDisposition, BasicApprovalPolicy } from "./approval-policy.js";

describe("BasicApprovalPolicy", () => {
  const policy = new BasicApprovalPolicy();

  it.each([
    ["read", "allow"],
    ["write", "require_approval"],
    ["execute", "require_approval"],
    ["network", "deny"],
  ] as const satisfies readonly (readonly [
    ToolRisk,
    ApprovalPolicyDisposition,
  ])[])("maps %s risk to %s", (risk, expectedDisposition) => {
    expect(policy.evaluate(risk)).toBe(expectedDisposition);
  });
});
