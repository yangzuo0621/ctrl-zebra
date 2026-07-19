import type {
  ApprovalDecisionIntent,
  ApprovalRequest,
  ApprovalStateMessage,
  ApprovalStatus,
  ExtensionToWebviewMessage,
} from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { WebviewHost } from "./vscode-api.js";

export interface DisplayApproval {
  readonly requestId: string;
  readonly approval: ApprovalRequest;
  readonly status: ApprovalStatus;
}

interface ApprovalState {
  readonly current?: DisplayApproval;
  readonly pendingDecision?: ApprovalDecisionIntent;
  receive(message: ExtensionToWebviewMessage): void;
  showDiff(): void;
  decide(decision: ApprovalDecisionIntent): boolean;
}

export function createApprovalStore(host: WebviewHost): StoreApi<ApprovalState> {
  return createStore<ApprovalState>()((set, get) => ({
    receive(message) {
      if (message.type !== "extension/approval-state") {
        return;
      }

      set({ current: toDisplayApproval(message), pendingDecision: undefined });
    },
    showDiff() {
      const current = get().current;
      if (current?.status === "pending") {
        host.showApprovalDiff(current.requestId, current.approval.id);
      }
    },
    decide(decision) {
      const { current, pendingDecision } = get();
      if (current?.status !== "pending" || pendingDecision !== undefined) {
        return false;
      }

      set({ pendingDecision: decision });
      host.decideApproval(current.requestId, current.approval.id, decision);
      return true;
    },
  }));
}

function toDisplayApproval(message: ApprovalStateMessage): DisplayApproval {
  return {
    requestId: message.requestId,
    approval: message.approval,
    status: message.status,
  };
}
