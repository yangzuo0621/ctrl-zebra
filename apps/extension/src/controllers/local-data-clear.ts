import { type ExtensionToWebviewMessage, protocolVersion } from "@ctrl-zebra/protocol";

export const clearLocalDataCommandId = "ctrlZebra.clearLocalData";

export const localDataClearCategories = [
  "running-operations",
  "sessions",
  "checkpoints",
  "temporary-files",
  "caches",
  "provider-secret",
  "provider-configuration",
  "mcp-configuration",
  "other-local-state",
] as const;

export const maxLocalDataClearCount = 10_000;

export type LocalDataClearCategory = (typeof localDataClearCategories)[number];

export interface LocalDataClearCounts {
  readonly deleted: number;
  readonly failed: number;
}

export interface LocalDataClearCategoryReport extends LocalDataClearCounts {
  readonly category: LocalDataClearCategory;
  readonly outcome: "cleared" | "failed";
}

export interface LocalDataClearReport {
  readonly outcome: "completed" | "partial";
  readonly categories: readonly LocalDataClearCategoryReport[];
}

export function combineLocalDataClearCounts(
  total: LocalDataClearCounts,
  report: LocalDataClearCounts,
): LocalDataClearCounts {
  return {
    deleted: Math.min(
      maxLocalDataClearCount,
      normalizeCount(total.deleted) + normalizeCount(report.deleted),
    ),
    failed: Math.min(
      maxLocalDataClearCount,
      normalizeCount(total.failed) + normalizeCount(report.failed),
    ),
  };
}

export type LocalDataOperationLock = () => Promise<() => void>;
export type LocalDataOperationLockPhase = "running" | "resource";

export interface LocalDataClearOperations {
  readonly clearSessions: () => Promise<LocalDataClearCounts>;
  readonly clearCheckpoints: () => Promise<LocalDataClearCounts>;
  readonly clearTemporaryFiles: () => Promise<LocalDataClearCounts>;
  readonly clearCaches: () => Promise<LocalDataClearCounts>;
  readonly clearProviderSecret: () => Promise<LocalDataClearCounts>;
  readonly clearProviderConfiguration: () => Promise<LocalDataClearCounts>;
  readonly clearMcpConfiguration: () => Promise<LocalDataClearCounts>;
  readonly clearOtherLocalState: () => Promise<LocalDataClearCounts>;
}

export interface LocalDataClearInteraction {
  readonly confirm: (message: string, confirmLabel: string) => Promise<boolean>;
  readonly notifyInformation: (message: string) => void;
  readonly notifyWarning: (message: string) => void;
}

/**
 * Coordinates the one destructive local-data operation. Callers register locks for live views or
 * other operation owners; the locks remain held until every cleanup category has settled.
 */
export class LocalDataClearController {
  readonly #operations: LocalDataClearOperations;
  readonly #interaction: LocalDataClearInteraction | undefined;
  readonly #runningOperationLocks = new Set<LocalDataOperationLock>();
  readonly #resourceOperationLocks = new Set<LocalDataOperationLock>();
  #inFlight: Promise<LocalDataClearReport> | undefined;

  constructor(operations: LocalDataClearOperations, interaction?: LocalDataClearInteraction) {
    this.#operations = operations;
    this.#interaction = interaction;
  }

  get isRunning(): boolean {
    return this.#inFlight !== undefined;
  }

  registerOperationLock(
    lock: LocalDataOperationLock,
    phase: LocalDataOperationLockPhase = "resource",
  ): () => void {
    const locks = phase === "running" ? this.#runningOperationLocks : this.#resourceOperationLocks;
    locks.add(lock);
    return () => {
      locks.delete(lock);
    };
  }

  run(): Promise<LocalDataClearReport> {
    if (this.#inFlight !== undefined) {
      return this.#inFlight;
    }

    const operation = this.#run().finally(() => {
      if (this.#inFlight === operation) {
        this.#inFlight = undefined;
      }
    });
    this.#inFlight = operation;
    return operation;
  }

  async request(
    requestId?: string,
    post?: (message: ExtensionToWebviewMessage) => void,
  ): Promise<LocalDataClearReport | undefined> {
    const interaction = this.#interaction;
    if (interaction === undefined) {
      throw new Error("Local-data clear interaction is unavailable.");
    }
    const confirmed = await interaction.confirm(clearConfirmationMessage, clearConfirmationLabel);
    if (!confirmed) {
      if (requestId !== undefined && post !== undefined) {
        post({
          protocolVersion,
          type: "extension/local-data-clear-result",
          requestId,
          outcome: "cancelled",
          categories: [],
          message: "CtrlZebra local-data clearing was cancelled.",
        });
      }
      return undefined;
    }

    const report = await this.run();
    if (requestId !== undefined && post !== undefined) {
      post({
        protocolVersion,
        type: "extension/local-data-clear-result",
        requestId,
        outcome: report.outcome,
        categories: report.categories.map((category) => ({ ...category })),
        message:
          report.outcome === "completed"
            ? "CtrlZebra local data was cleared."
            : "Some CtrlZebra local data could not be cleared. Retry to continue.",
      });
    }
    if (report.outcome === "completed") {
      interaction.notifyInformation("CtrlZebra local data was cleared.");
    } else {
      interaction.notifyWarning(
        "Some CtrlZebra local data could not be cleared. Retry the command to continue.",
      );
    }
    return report;
  }

  async #run(): Promise<LocalDataClearReport> {
    const releases: (() => void)[] = [];
    try {
      for (const lock of [...this.#runningOperationLocks, ...this.#resourceOperationLocks]) {
        releases.push(await lock());
      }
    } catch {
      releaseAll(releases);
      return failedBeforeCleanupReport();
    }

    try {
      const categories: LocalDataClearCategoryReport[] = [
        await runCategory("running-operations", async () => ({ deleted: 0, failed: 0 })),
        await runCategory("sessions", this.#operations.clearSessions),
        await runCategory("checkpoints", this.#operations.clearCheckpoints),
        await runCategory("temporary-files", this.#operations.clearTemporaryFiles),
        await runCategory("caches", this.#operations.clearCaches),
        await runCategory("provider-secret", this.#operations.clearProviderSecret),
        await runCategory("provider-configuration", this.#operations.clearProviderConfiguration),
        await runCategory("mcp-configuration", this.#operations.clearMcpConfiguration),
        await runCategory("other-local-state", this.#operations.clearOtherLocalState),
      ];
      return {
        outcome: categories.some(({ outcome }) => outcome === "failed") ? "partial" : "completed",
        categories,
      };
    } finally {
      releaseAll(releases);
    }
  }
}

const clearConfirmationLabel = "Clear CtrlZebra data";
const clearConfirmationMessage =
  "This permanently deletes CtrlZebra Sessions, Checkpoints, temporary files, caches, Provider API keys, MCP/Provider settings, and other CtrlZebra local state. It does not delete workspace files, user code, VS Code data outside CtrlZebra, or other extensions. Continue?";

async function runCategory(
  category: LocalDataClearCategory,
  operation: () => Promise<LocalDataClearCounts>,
): Promise<LocalDataClearCategoryReport> {
  try {
    const counts = normalizeCounts(await operation());
    return {
      category,
      ...counts,
      outcome: counts.failed === 0 ? "cleared" : "failed",
    };
  } catch {
    return {
      category,
      deleted: 0,
      failed: 1,
      outcome: "failed",
    };
  }
}

function normalizeCounts(value: LocalDataClearCounts): LocalDataClearCounts {
  const deleted = normalizeCount(value.deleted);
  const failed = normalizeCount(value.failed);
  return { deleted, failed };
}

function normalizeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, maxLocalDataClearCount) : 1;
}

function failedBeforeCleanupReport(): LocalDataClearReport {
  return {
    outcome: "partial",
    categories: localDataClearCategories.map((category) => ({
      category,
      deleted: 0,
      failed: 1,
      outcome: "failed" as const,
    })),
  };
}

function releaseAll(releases: readonly (() => void)[]): void {
  for (const release of [...releases].reverse()) {
    try {
      release();
    } catch {
      // A lock release is idempotent and must not hide the cleanup result.
    }
  }
}
