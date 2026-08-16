import { describe, expect, it, vi } from "vitest";

import {
  LocalDataClearController,
  type LocalDataClearCounts,
  localDataClearCategories,
} from "./local-data-clear.js";

const emptyCounts: LocalDataClearCounts = { deleted: 0, failed: 0 };

function createOperations(
  overrides: Partial<
    Record<
      Exclude<(typeof localDataClearCategories)[number], "running-operations">,
      () => Promise<LocalDataClearCounts>
    >
  > = {},
) {
  const operation = (
    category: Exclude<(typeof localDataClearCategories)[number], "running-operations">,
  ) => overrides[category] ?? vi.fn(async () => emptyCounts);
  return {
    clearSessions: operation("sessions"),
    clearCheckpoints: operation("checkpoints"),
    clearTemporaryFiles: operation("temporary-files"),
    clearCaches: operation("caches"),
    clearProviderSecret: operation("provider-secret"),
    clearProviderConfiguration: operation("provider-configuration"),
    clearMcpConfiguration: operation("mcp-configuration"),
    clearOtherLocalState: operation("other-local-state"),
  };
}

describe("LocalDataClearController", () => {
  it("completes an empty state and reports every category", async () => {
    const controller = new LocalDataClearController(createOperations());

    await expect(controller.run()).resolves.toEqual({
      outcome: "completed",
      categories: localDataClearCategories.map((category) => ({
        category,
        deleted: 0,
        failed: 0,
        outcome: "cleared",
      })),
    });
  });

  it("cleans every category in deterministic order and continues after a failure", async () => {
    const order: string[] = [];
    const operations = createOperations({
      sessions: async () => {
        order.push("sessions");
        return { deleted: 2, failed: 0 };
      },
      checkpoints: async () => {
        order.push("checkpoints");
        return { deleted: 3, failed: 1 };
      },
      "temporary-files": async () => {
        order.push("temporary-files");
        throw new Error("storage unavailable");
      },
      caches: async () => {
        order.push("caches");
        return { deleted: 4, failed: 0 };
      },
      "provider-secret": async () => {
        order.push("provider-secret");
        return { deleted: 1, failed: 0 };
      },
      "provider-configuration": async () => {
        order.push("provider-configuration");
        return { deleted: 2, failed: 0 };
      },
      "mcp-configuration": async () => {
        order.push("mcp-configuration");
        return { deleted: 1, failed: 0 };
      },
      "other-local-state": async () => {
        order.push("other-local-state");
        return { deleted: 1, failed: 0 };
      },
    });
    const controller = new LocalDataClearController(operations);

    const result = await controller.run();

    expect(order).toEqual([
      "sessions",
      "checkpoints",
      "temporary-files",
      "caches",
      "provider-secret",
      "provider-configuration",
      "mcp-configuration",
      "other-local-state",
    ]);
    expect(result.outcome).toBe("partial");
    expect(result.categories).toContainEqual({
      category: "checkpoints",
      deleted: 3,
      failed: 1,
      outcome: "failed",
    });
    expect(result.categories).toContainEqual({
      category: "temporary-files",
      deleted: 0,
      failed: 1,
      outcome: "failed",
    });
    expect(result.categories).toContainEqual({
      category: "other-local-state",
      deleted: 1,
      failed: 0,
      outcome: "cleared",
    });
  });

  it("cancels and settles operations before cleanup and keeps the lock through the run", async () => {
    const order: string[] = [];
    let releaseLock!: () => void;
    const lock = vi.fn(async () => {
      order.push("cancel-and-settle");
      return () => {
        order.push("release");
        releaseLock?.();
      };
    });
    const operations = createOperations({
      sessions: async () => {
        order.push("sessions");
        return { deleted: 1, failed: 0 };
      },
    });
    const controller = new LocalDataClearController(operations);
    const unregister = controller.registerOperationLock(lock);

    await controller.run();

    expect(lock).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe("cancel-and-settle");
    expect(order.indexOf("sessions")).toBeGreaterThan(order.indexOf("cancel-and-settle"));
    expect(order.at(-1)).toBe("release");
    unregister();
    expect(controller.isRunning).toBe(false);
  });

  it("settles running-operation locks before resource locks", async () => {
    const order: string[] = [];
    const controller = new LocalDataClearController(createOperations());
    controller.registerOperationLock(async () => {
      order.push("resource");
      return () => {};
    });
    controller.registerOperationLock(async () => {
      order.push("running");
      return () => {};
    }, "running");

    await controller.run();

    expect(order).toEqual(["running", "resource"]);
  });

  it("shares concurrent calls and retries failed categories idempotently", async () => {
    let attempt = 0;
    const clearSessions = vi.fn(async () => {
      attempt += 1;
      return attempt === 1 ? { deleted: 0, failed: 1 } : { deleted: 0, failed: 0 };
    });
    const operations = createOperations({ sessions: clearSessions });
    const controller = new LocalDataClearController(operations);

    const first = controller.run();
    const second = controller.run();
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ outcome: "partial" });

    await expect(controller.run()).resolves.toMatchObject({ outcome: "completed" });
    expect(clearSessions).toHaveBeenCalledTimes(2);
  });

  it("does not run destructive categories when operation cancellation cannot be established", async () => {
    const clearSessions = vi.fn(async () => ({ deleted: 1, failed: 0 }));
    const controller = new LocalDataClearController(createOperations({ sessions: clearSessions }));
    controller.registerOperationLock(async () => {
      throw new Error("running operation could not be cancelled");
    });

    const result = await controller.run();

    expect(result.outcome).toBe("partial");
    expect(result.categories.find(({ category }) => category === "running-operations")).toEqual({
      category: "running-operations",
      deleted: 0,
      failed: 1,
      outcome: "failed",
    });
    expect(clearSessions).not.toHaveBeenCalled();
  });
});
