import { type ExtensionToWebviewMessage, protocolVersion } from "@ctrl-zebra/protocol";

import { type SessionRecoveryActions, SessionRecoveryError } from "./session-recovery.js";

type PostWebviewMessage = (message: ExtensionToWebviewMessage) => void;

export class WebviewSessionMessageHandler {
  constructor(
    private readonly post: PostWebviewMessage,
    private readonly actions?: SessionRecoveryActions,
  ) {}

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
    void (
      this.actions?.restore(sessionId) ?? Promise.reject(new Error("Session storage unavailable."))
    ).then(
      (session) =>
        this.post({
          protocolVersion,
          type: "extension/session-restored",
          requestId,
          session,
        }),
      (error: unknown) =>
        this.post({
          protocolVersion,
          type: "extension/session-error",
          requestId,
          code: error instanceof SessionRecoveryError ? error.code : "unavailable",
          message: "The saved Session could not be restored.",
        }),
    );
  }
}
