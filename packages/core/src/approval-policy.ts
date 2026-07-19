import type { ToolRisk } from "@ctrl-zebra/protocol";

export type ApprovalPolicyDisposition = "allow" | "require_approval" | "deny";

const dispositionByRisk = {
  read: "allow",
  write: "require_approval",
  execute: "require_approval",
  network: "deny",
} as const satisfies Record<ToolRisk, ApprovalPolicyDisposition>;

export class BasicApprovalPolicy {
  evaluate(risk: ToolRisk): ApprovalPolicyDisposition {
    return dispositionByRisk[risk];
  }
}
