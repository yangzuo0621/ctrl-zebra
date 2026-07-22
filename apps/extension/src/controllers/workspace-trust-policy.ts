export interface WorkspaceTrustPolicy {
  isTrusted(): boolean;
  requireTrusted(): void;
}

export class WorkspaceTrustRequiredError extends Error {
  constructor() {
    super("Trust this workspace before using file writes or command execution.");
    this.name = "WorkspaceTrustRequiredError";
  }
}

export function createWorkspaceTrustPolicy(getIsTrusted: () => boolean): WorkspaceTrustPolicy {
  return {
    isTrusted: getIsTrusted,
    requireTrusted() {
      if (!getIsTrusted()) {
        throw new WorkspaceTrustRequiredError();
      }
    },
  };
}
