import type { FileRenamePlan } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import {
  FileRenameApplier,
  type FileRenameApplierDependencies,
  FileRenameApplyError,
  FileRenameConflictError,
} from "./file-rename-applier.js";

const plan = {
  operation: "rename",
  sourcePath: "old.txt",
  targetPath: "new.txt",
  sourceUri: "file:///workspace/old.txt",
  targetUri: "file:///workspace/new.txt",
  beforeContent: "zebra\n",
  beforeHash: "a".repeat(64),
} satisfies FileRenamePlan;
const ownership = { sessionId: "session-1", runId: "run-1" } as const;

describe("FileRenameApplier", () => {
  it("binds both identities and checkpoints the exact source/target pair", async () => {
    const dependencies = createDependencies();
    await new FileRenameApplier(dependencies.values).apply(
      plan,
      ownership,
      new AbortController().signal,
    );

    expect(dependencies.createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          {
            uri: plan.sourceUri,
            before: { kind: "text", content: plan.beforeContent, beforeHash: plan.beforeHash },
            after: { kind: "absent" },
          },
          {
            uri: plan.targetUri,
            before: { kind: "absent" },
            after: { kind: "text", afterHash: plan.beforeHash },
          },
        ],
      }),
      expect.any(AbortSignal),
    );
    expect(dependencies.renameFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toString: expect.any(Function) }),
      expect.objectContaining({ toString: expect.any(Function) }),
    );
    expect(dependencies.applyWorkspaceEdit).toHaveBeenCalledOnce();
  });

  it("rejects a missing source or occupied target before checkpointing", async () => {
    const dependencies = createDependencies({ sourceExists: false });
    await expect(
      new FileRenameApplier(dependencies.values).apply(
        plan,
        ownership,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(FileRenameConflictError);
    expect(dependencies.createCheckpoint).not.toHaveBeenCalled();

    const occupied = createDependencies({ targetExists: true });
    await expect(
      new FileRenameApplier(occupied.values).apply(plan, ownership, new AbortController().signal),
    ).rejects.toBeInstanceOf(FileRenameConflictError);
    expect(occupied.createCheckpoint).not.toHaveBeenCalled();
  });

  it("rechecks both sides before submitting the rename", async () => {
    const dependencies = createDependencies({ targetExistsSequence: [false, true] });
    await expect(
      new FileRenameApplier(dependencies.values).apply(
        plan,
        ownership,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(FileRenameConflictError);
    expect(dependencies.createCheckpoint).toHaveBeenCalledOnce();
    expect(dependencies.renameFile).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("keeps host application failure distinct", async () => {
    const dependencies = createDependencies({ applied: false });
    await expect(
      new FileRenameApplier(dependencies.values).apply(
        plan,
        ownership,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(FileRenameApplyError);
  });
});

function createDependencies(
  options: {
    readonly sourceExists?: boolean;
    readonly targetExists?: boolean;
    readonly targetExistsSequence?: readonly boolean[];
    readonly applied?: boolean;
  } = {},
) {
  const source = { toString: () => plan.sourceUri };
  const target = { toString: () => plan.targetUri };
  const edit = { operations: [] as string[] };
  let targetResolveCount = 0;
  const resolveTarget = vi.fn(async (uri: string) => {
    if (uri === plan.sourceUri) {
      const exists = options.sourceExists ?? true;
      return { resource: source, exists, text: exists ? plan.beforeContent : undefined };
    }
    const exists =
      options.targetExistsSequence?.[targetResolveCount] ?? options.targetExists ?? false;
    targetResolveCount += 1;
    return { resource: target, exists };
  });
  const renameFile = vi.fn((value, from, to) =>
    value.operations.push(`rename:${from.toString()}->${to.toString()}`),
  );
  const createCheckpoint = vi.fn(async () => {});
  const applyWorkspaceEdit = vi.fn(async () => options.applied ?? true);
  const values = {
    resolveTarget,
    createWorkspaceEdit: vi.fn(() => edit),
    renameFile,
    assertCanApply: vi.fn(),
    applyWorkspaceEdit,
    hashText: () => plan.beforeHash,
    createCheckpoint,
    createId: () => "checkpoint-1",
    now: () => new Date("2026-08-13T00:00:00.000Z"),
  } satisfies FileRenameApplierDependencies<typeof source, typeof edit>;
  return { values, createCheckpoint, renameFile, applyWorkspaceEdit };
}
