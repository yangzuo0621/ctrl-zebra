import { type ExtensionToWebviewMessage, protocolVersion } from "@ctrl-zebra/protocol";

import {
  SessionDeletionError,
  type SessionRecoveryActions,
  SessionRecoveryError,
} from "./session-recovery.js";

type PostWebviewMessage = (message: ExtensionToWebviewMessage) => void;

export class WebviewSessionMessageHandler {
  #restoreRequests = new Set<string>();
  #deleteRequests = new Set<string>();
  #clearRequests = new Set<string>();
  #knownSessionIds = new Set<string>();
  #selectedSessionId: string | undefined;
  #latestListRequestId: string | undefined;

  constructor(
    private readonly post: PostWebviewMessage,
    private readonly actions?: SessionRecoveryActions,
    private readonly onRestored?: (sessionId: string) => void,
    private readonly cancelSession?: (sessionId: string) => Promise<void>,
    private readonly cancelAllSessions?: () => Promise<void>,
    private readonly onDeleted?: (sessionId: string) => void,
    private readonly onCleared?: () => void,
    private readonly isOwnedSession?: (sessionId: string) => boolean,
  ) {}

  isRestoring(): boolean {
    return (
      this.#restoreRequests.size > 0 ||
      this.#deleteRequests.size > 0 ||
      this.#clearRequests.size > 0
    );
  }

  list(requestId: string): Promise<void> {
    this.#latestListRequestId = requestId;
    return (this.actions?.list() ?? Promise.reject(new Error("Session storage unavailable."))).then(
      (sessions) =>
        (() => {
          const listedSessions = [...sessions];
          if (this.#latestListRequestId === requestId) {
            this.#knownSessionIds = new Set(listedSessions.map(({ sessionId }) => sessionId));
            if (
              this.#selectedSessionId !== undefined &&
              !this.#knownSessionIds.has(this.#selectedSessionId) &&
              !this.isOwnedSession?.(this.#selectedSessionId)
            ) {
              this.#selectedSessionId = undefined;
            }
          }
          this.post({
            protocolVersion,
            type: "extension/session-list",
            requestId,
            sessions: listedSessions,
          });
        })(),
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

  select(_requestId: string, sessionId?: string): void {
    if (this.isRestoring()) {
      return;
    }
    if (sessionId === undefined) {
      this.#selectedSessionId = undefined;
      return;
    }
    if (this.#knownSessionIds.has(sessionId) || this.isOwnedSession?.(sessionId) === true) {
      this.#selectedSessionId = sessionId;
    }
  }

  restore(requestId: string, sessionId: string): void {
    if (
      this.#knownSessionIds.has(sessionId) !== true &&
      this.isOwnedSession?.(sessionId) !== true
    ) {
      this.post({
        protocolVersion,
        type: "extension/session-error",
        requestId,
        code: "unavailable",
        message: "The saved Session could not be restored.",
      });
      return;
    }
    this.#restoreRequests.add(requestId);
    const restore =
      this.actions?.restore(sessionId) ?? Promise.reject(new Error("Session storage unavailable."));
    void restore
      .then(
        ({ session, reasoning }) => {
          this.#selectedSessionId = session.sessionId;
          this.#knownSessionIds.add(session.sessionId);
          this.onRestored?.(session.sessionId);
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

  delete(requestId: string, sessionId: string): void {
    if (this.#deleteRequests.size > 0 || this.#clearRequests.size > 0) {
      return;
    }
    if (this.#selectedSessionId !== sessionId && this.isOwnedSession?.(sessionId) !== true) {
      this.postDeletionError(requestId, new SessionDeletionError("unavailable"));
      return;
    }
    this.#latestListRequestId = undefined;
    this.#deleteRequests.add(requestId);
    void (async () => {
      await this.cancelSession?.(sessionId);
      if (this.actions?.delete === undefined) {
        throw new SessionDeletionError("unavailable");
      }
      await this.actions.delete(sessionId);
      this.#deleteRequests.delete(requestId);
      if (this.#selectedSessionId === sessionId) {
        this.#selectedSessionId = undefined;
      }
      this.#knownSessionIds.delete(sessionId);
      this.onDeleted?.(sessionId);
      this.post({
        protocolVersion,
        type: "extension/session-deleted",
        requestId,
        sessionId,
      });
    })()
      .catch((error: unknown) => this.postDeletionError(requestId, error))
      .finally(() => this.#deleteRequests.delete(requestId));
  }

  clear(requestId: string): void {
    if (this.#clearRequests.size > 0 || this.#deleteRequests.size > 0) {
      return;
    }
    this.#latestListRequestId = undefined;
    this.#clearRequests.add(requestId);
    void (async () => {
      await this.cancelAllSessions?.();
      if (this.actions?.clear === undefined) {
        throw new SessionDeletionError("unavailable");
      }
      const deletedCount = await this.actions.clear();
      this.#clearRequests.delete(requestId);
      this.#knownSessionIds.clear();
      this.#selectedSessionId = undefined;
      this.onCleared?.();
      this.post({
        protocolVersion,
        type: "extension/sessions-cleared",
        requestId,
        deletedCount: Math.min(deletedCount, 10_000),
      });
    })()
      .catch((error: unknown) => this.postDeletionError(requestId, error))
      .finally(() => this.#clearRequests.delete(requestId));
  }

  private postDeletionError(requestId: string, error: unknown): void {
    const code = error instanceof SessionDeletionError ? error.code : "unavailable";
    this.post({
      protocolVersion,
      type: "extension/session-deletion-error",
      requestId,
      code,
      message:
        code === "partial"
          ? "Some Session data could not be deleted. Retry to finish cleanup."
          : code === "not-found"
            ? "The saved Session was already deleted."
            : "Saved Session data is unavailable. Retry the deletion.",
    });
  }
}
