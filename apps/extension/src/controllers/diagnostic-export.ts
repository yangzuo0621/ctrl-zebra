import {
  type DiagnosticsExportErrorCategory,
  type DiagnosticsExportPreviewMessage,
  diagnosticsExportTargetSchema,
  type ExtensionToWebviewMessage,
  maxDiagnosticsExportErrorCount,
  protocolVersion,
} from "@ctrl-zebra/protocol";

import {
  createDiagnosticsExport,
  type DiagnosticsExportBuilderInput,
} from "../adapters/diagnostics-export.js";

type PostWebviewMessage = (message: ExtensionToWebviewMessage) => void;

export interface DiagnosticsExportTargetPort {
  chooseTarget(): PromiseLike<unknown>;
  formatTarget(target: unknown): string;
  writeFile(target: unknown, bytes: Uint8Array): PromiseLike<void>;
}

export interface DiagnosticsExportControllerDependencies {
  readonly createId: () => string;
  readonly readInput: () => DiagnosticsExportBuilderInput;
  readonly target: DiagnosticsExportTargetPort;
}

export function classifyDiagnosticsErrorCategory(code: string): DiagnosticsExportErrorCategory {
  if (code.startsWith("provider-")) return "configuration";
  if (code === "missing-api-key" || code.startsWith("secret-storage-")) return "authentication";
  if (code === "authentication" || code === "permission-denied") return "authentication";
  if (code === "run-budget-configuration") return "configuration";
  if (code.includes("budget")) return "budget";
  if (code.includes("configuration")) return "configuration";
  if (code === "context-overflow" || code === "invalid-context") return "context";
  if (code === "rate-limit") return "rate-limit";
  if (code === "unavailable" || code === "network") return "network";
  if (code === "invalid-request" || code === "model-not-found") return "configuration";
  if (code.startsWith("mcp-") || code.includes("server-exit")) return "mcp";
  if (code.includes("tool")) return "tool";
  return "internal";
}

interface PendingExport {
  readonly requestId: string;
  readonly exportId: string;
  readonly target: unknown;
  readonly serialized: ReturnType<typeof createDiagnosticsExport>;
}

export class DiagnosticsExportController {
  readonly #dependencies: DiagnosticsExportControllerDependencies;
  readonly #errorCounts = new Map<DiagnosticsExportErrorCategory, number>();
  #pending: PendingExport | undefined;
  #preparing = false;
  #writing = false;
  #disposed = false;

  constructor(dependencies: DiagnosticsExportControllerDependencies) {
    this.#dependencies = dependencies;
  }

  recordErrorCategory(category: DiagnosticsExportErrorCategory): void {
    const current = this.#errorCounts.get(category) ?? 0;
    this.#errorCounts.set(category, Math.min(maxDiagnosticsExportErrorCount, current + 1));
  }

  getErrorCounts(): readonly {
    readonly category: DiagnosticsExportErrorCategory;
    readonly count: number;
  }[] {
    return [...this.#errorCounts.entries()].map(([category, count]) => ({ category, count }));
  }

  request(requestId: string, post: PostWebviewMessage): void {
    if (this.#disposed || this.#preparing || this.#pending !== undefined || this.#writing) {
      postPreviewError(
        post,
        requestId,
        "invalid-state",
        "A diagnostics export is already in progress.",
      );
      return;
    }

    this.#preparing = true;
    void Promise.resolve(this.#prepare(requestId, post)).finally(() => {
      this.#preparing = false;
    });
  }

  confirm(requestId: string, exportId: string, post: PostWebviewMessage): void {
    const pending = this.#pending;
    if (
      this.#disposed ||
      this.#writing ||
      pending === undefined ||
      pending.requestId !== requestId ||
      pending.exportId !== exportId
    ) {
      postPreviewError(
        post,
        requestId,
        "invalid-state",
        "The diagnostics preview is no longer available.",
      );
      return;
    }

    this.#writing = true;
    let writeOperation: PromiseLike<void>;
    try {
      writeOperation = this.#dependencies.target.writeFile(
        pending.target,
        pending.serialized.bytes,
      );
    } catch {
      this.#writing = false;
      this.#pending = undefined;
      postPreviewError(
        post,
        requestId,
        "write-failed",
        "The diagnostics file could not be written.",
      );
      return;
    }
    void Promise.resolve(writeOperation)
      .then(
        () => {
          if (this.#disposed) return;
          this.#pending = undefined;
          post({
            protocolVersion,
            type: "extension/diagnostics-export-preview",
            requestId,
            status: "completed",
            message: "Diagnostics were exported to the selected file.",
          });
        },
        () => {
          if (this.#disposed) return;
          this.#pending = undefined;
          postPreviewError(
            post,
            requestId,
            "write-failed",
            "The diagnostics file could not be written.",
          );
        },
      )
      .finally(() => {
        this.#writing = false;
      });
  }

  cancel(requestId: string, exportId: string, post: PostWebviewMessage): void {
    const pending = this.#pending;
    if (
      this.#disposed ||
      this.#writing ||
      pending === undefined ||
      pending.requestId !== requestId ||
      pending.exportId !== exportId
    ) {
      return;
    }
    this.#pending = undefined;
    post({
      protocolVersion,
      type: "extension/diagnostics-export-preview",
      requestId,
      status: "cancelled",
      code: "user-cancelled",
      message: "Diagnostics export was cancelled.",
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#preparing = false;
    this.#pending = undefined;
  }

  async #prepare(requestId: string, post: PostWebviewMessage): Promise<void> {
    let serialized: ReturnType<typeof createDiagnosticsExport>;
    try {
      serialized = createDiagnosticsExport({
        ...this.#dependencies.readInput(),
        errors: this.getErrorCounts(),
      });
    } catch (error) {
      if (this.#disposed) return;
      this.#preparing = false;
      postPreviewError(
        post,
        requestId,
        error instanceof RangeError ? "too-large" : "invalid-state",
        error instanceof RangeError
          ? "The diagnostics export is too large to save safely."
          : "Diagnostics are unavailable because the current state is invalid.",
      );
      return;
    }

    let target: unknown;
    try {
      target = await this.#dependencies.target.chooseTarget();
    } catch {
      if (!this.#disposed) {
        this.#preparing = false;
        postPreviewError(post, requestId, "unavailable", "The file save dialog is unavailable.");
      }
      return;
    }
    if (this.#disposed) return;
    if (target === undefined || target === null) {
      this.#preparing = false;
      post({
        protocolVersion,
        type: "extension/diagnostics-export-preview",
        requestId,
        status: "cancelled",
        code: "no-target",
        message: "Diagnostics export was cancelled before a target was selected.",
      });
      return;
    }

    let exportId: string;
    try {
      exportId = this.#dependencies.createId();
    } catch {
      this.#preparing = false;
      postPreviewError(post, requestId, "unavailable", "The diagnostics preview is unavailable.");
      return;
    }
    this.#pending = { requestId, exportId, target, serialized };
    this.#preparing = false;
    try {
      const displayTarget = this.#dependencies.target.formatTarget(target);
      if (!diagnosticsExportTargetSchema.safeParse(displayTarget).success) {
        throw new Error("invalid target label");
      }
      post({
        protocolVersion,
        type: "extension/diagnostics-export-preview",
        requestId,
        status: "ready",
        exportId: this.#pending.exportId,
        target: displayTarget,
        document: serialized.document,
      });
    } catch {
      this.#pending = undefined;
      if (!this.#disposed) {
        postPreviewError(post, requestId, "unavailable", "The diagnostics preview is unavailable.");
      }
    }
  }
}

function postPreviewError(
  post: PostWebviewMessage,
  requestId: string,
  code: "invalid-state" | "too-large" | "write-failed" | "unavailable",
  message: string,
): void {
  post({
    protocolVersion,
    type: "extension/diagnostics-export-preview",
    requestId,
    status: "error",
    code,
    message,
  } satisfies DiagnosticsExportPreviewMessage);
}
