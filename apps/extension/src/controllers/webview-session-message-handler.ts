import { type ExtensionToWebviewMessage, protocolVersion } from "@ctrl-zebra/protocol";

import { type SessionRecoveryActions, SessionRecoveryError } from "./session-recovery.js";

type PostWebviewMessage = (message: ExtensionToWebviewMessage) => void;

export class WebviewSessionMessageHandler {
  #restoreRequests = new Set<string>();

  constructor(
    private readonly post: PostWebviewMessage,
    private readonly actions?: SessionRecoveryActions,
  ) {}

  isRestoring(): boolean {
    return this.#restoreRequests.size > 0;
  }

  list(requestId: string): void {
    void (this.actions?.list() ?? Promise.reject(new Error("Session storage unavailable."))).then(
      (sessions) =>
        this.post({
          protocolVersion,
          type: "extension/session-list",
          requestId,
          sessions: [...sessions],
        }),
      (error: unknown) =>
        this.post({
          protocolVersion,
          type: "extension/session-error",
          requestId,
          code: error instanceof SessionRecoveryError ? error.code : "unavailable",
          message: "Saved Sessions are unavailable.",
        }),
    );
  }

  restore(requestId: string, sessionId: string): void {
    this.#restoreRequests.add(requestId);
    const restore =
      this.actions?.restore(sessionId) ?? Promise.reject(new Error("Session storage unavailable."));
    void restore
      .then(
        ({ session, reasoning }) => {
          this.post({
            protocolVersion,
            type: "extension/reasoning-restored",
            requestId,
            ...reasoning,
          });
          this.post({
            protocolVersion,
            type: "extension/session-restored",
            requestId,
            session,
          });
        },
        (error: unknown) =>
          this.post({
            protocolVersion,
            type: "extension/session-error",
            requestId,
            code: error instanceof SessionRecoveryError ? error.code : "unavailable",
            message: "The saved Session could not be restored.",
          }),
      )
      .finally(() => {
        this.#restoreRequests.delete(requestId);
      });
  }
}
