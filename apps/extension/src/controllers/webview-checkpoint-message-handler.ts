import { type ExtensionToWebviewMessage, protocolVersion } from "@ctrl-zebra/protocol";

import { CheckpointActionError, type CheckpointActions } from "./checkpoint-actions.js";

type PostWebviewMessage = (message: ExtensionToWebviewMessage) => void;

export class WebviewCheckpointMessageHandler {
  readonly #requests = new Set<AbortController>();

  constructor(
    private readonly post: PostWebviewMessage,
    private readonly actions?: CheckpointActions,
  ) {}

  list(requestId: string): void {
    const controller = this.#trackRequest();
    void (
      this.actions?.list(controller.signal) ??
      Promise.reject(new Error("Checkpoint storage unavailable."))
    )
      .then(
        (checkpoints) =>
          this.post({
            protocolVersion,
            type: "extension/checkpoint-list",
            requestId,
            checkpoints: [...checkpoints],
          }),
        () =>
          this.post({
            protocolVersion,
            type: "extension/checkpoint-error",
            requestId,
            code: "unavailable",
            message: "Checkpoints are unavailable.",
          }),
      )
      .finally(() => this.#requests.delete(controller));
  }

  restore(requestId: string, checkpointId: string): void {
    const controller = this.#trackRequest();
    void (
      this.actions?.restore(checkpointId, controller.signal) ??
      Promise.reject(new Error("Checkpoint restore unavailable."))
    )
      .then(
        () =>
          this.post({
            protocolVersion,
            type: "extension/checkpoint-restored",
            requestId,
            checkpointId,
          }),
        (error: unknown) =>
          this.post({
            protocolVersion,
            type: "extension/checkpoint-error",
            requestId,
            code: error instanceof CheckpointActionError ? error.code : "unavailable",
            message:
              error instanceof CheckpointActionError && error.code === "conflict"
                ? "Files changed after the Agent edit. Nothing was restored."
                : "The Checkpoint could not be restored.",
          }),
      )
      .finally(() => this.#requests.delete(controller));
  }

  dispose(): void {
    for (const controller of this.#requests) {
      controller.abort(new Error("Webview disposed during Checkpoint operation."));
    }
    this.#requests.clear();
  }

  #trackRequest(): AbortController {
    const controller = new AbortController();
    this.#requests.add(controller);
    return controller;
  }
}
