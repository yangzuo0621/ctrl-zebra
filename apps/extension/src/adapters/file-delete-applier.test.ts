import type { FileDeletePlan } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import {
  FileDeleteApplier,
  type FileDeleteApplierDependencies,
  FileDeleteApplyError,
  FileDeleteConflictError,
} from "./file-delete-applier.js";

const plan = {
  operation: "delete",
  path: "old.txt",
  uri: "file:///workspace/old.txt",
  beforeContent: "zebra\n",
  beforeHash: "a".repeat(64),
} satisfies FileDeletePlan;
const ownership = { sessionId: "session-1", runId: "run-1" } as const;

describe("FileDeleteApplier", () => {
  it("checkpoints the full source before one atomic delete", async () => {
    const dependencies = createDependencies();
    await new FileDeleteApplier(dependencies.values).apply(
      plan,
      ownership,
      new AbortController().signal,
    );

    expect(dependencies.createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          {
            uri: plan.uri,
            before: { kind: "text", content: plan.beforeContent, beforeHash: plan.beforeHash },
            after: { kind: "absent" },
          },
        ],
      }),
      expect.any(AbortSignal),
    );
    expect(dependencies.deleteFile).toHaveBeenCalledOnce();
    expect(dependencies.applyWorkspaceEdit).toHaveBeenCalledOnce();
  });

  it("does not write when the source is missing or stale", async () => {
    const dependencies = createDependencies({ exists: false });
    await expect(
      new FileDeleteApplier(dependencies.values).apply(
        plan,
        ownership,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(FileDeleteConflictError);
    expect(dependencies.createCheckpoint).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("rechecks source identity after checkpoint creation", async () => {
    const dependencies = createDependencies({ existsSequence: [true, false] });
    await expect(
      new FileDeleteApplier(dependencies.values).apply(
        plan,
        ownership,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(FileDeleteConflictError);
    expect(dependencies.createCheckpoint).toHaveBeenCalledOnce();
    expect(dependencies.deleteFile).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("keeps host application failure distinct", async () => {
    const dependencies = createDependencies({ applied: false });
    await expect(
      new FileDeleteApplier(dependencies.values).apply(
        plan,
        ownership,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(FileDeleteApplyError);
  });
});

function createDependencies(
  options: {
    readonly exists?: boolean;
    readonly existsSequence?: readonly boolean[];
    readonly applied?: boolean;
  } = {},
) {
  const resource = { toString: () => plan.uri };
  const edit = { operations: [] as string[] };
  let resolveCount = 0;
  const resolveTarget = vi.fn(async () => {
    const exists = options.existsSequence?.[resolveCount] ?? options.exists ?? true;
    resolveCount += 1;
    return { resource, exists, text: exists ? plan.beforeContent : undefined };
  });
  const deleteFile = vi.fn((target, uri) => target.operations.push(`delete:${uri.toString()}`));
  const createCheckpoint = vi.fn(async () => {});
  const applyWorkspaceEdit = vi.fn(async () => options.applied ?? true);
  const values = {
    resolveTarget,
    createWorkspaceEdit: vi.fn(() => edit),
    deleteFile,
    assertCanApply: vi.fn(),
    applyWorkspaceEdit,
    hashText: () => plan.beforeHash,
    createCheckpoint,
    createId: () => "checkpoint-1",
    now: () => new Date("2026-08-13T00:00:00.000Z"),
  } satisfies FileDeleteApplierDependencies<typeof resource, typeof edit>;
  return { values, resolveTarget, createCheckpoint, deleteFile, applyWorkspaceEdit };
}
