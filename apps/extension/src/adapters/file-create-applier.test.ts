import type { FileCreatePlan } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import {
  FileCreateApplier,
  type FileCreateApplierDependencies,
  FileCreateApplyError,
  FileCreateConflictError,
} from "./file-create-applier.js";

const plan = {
  operation: "create",
  path: "new.txt",
  uri: "file:///workspace/new.txt",
  content: "zebra\n",
  afterHash: "a".repeat(64),
} satisfies FileCreatePlan;
const ownership = { sessionId: "session-1", runId: "run-1" } as const;

describe("FileCreateApplier", () => {
  it("durably checkpoints absence before one atomic create-and-insert edit", async () => {
    const dependencies = createDependencies();
    await new FileCreateApplier(dependencies.values).apply(
      plan,
      ownership,
      new AbortController().signal,
    );

    expect(dependencies.createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          {
            uri: plan.uri,
            before: { kind: "absent" },
            after: { kind: "text", afterHash: plan.afterHash },
          },
        ],
      }),
      expect.any(AbortSignal),
    );
    expect(dependencies.createFile).toHaveBeenCalledOnce();
    expect(dependencies.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      plan.content,
    );
    expect(dependencies.applyWorkspaceEdit).toHaveBeenCalledOnce();
  });

  it("does not write when the target appears before apply", async () => {
    const dependencies = createDependencies({ exists: true });
    await expect(
      new FileCreateApplier(dependencies.values).apply(
        plan,
        ownership,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(FileCreateConflictError);
    expect(dependencies.createCheckpoint).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("keeps host application failure distinct", async () => {
    const dependencies = createDependencies({ applied: false });
    await expect(
      new FileCreateApplier(dependencies.values).apply(
        plan,
        ownership,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(FileCreateApplyError);
  });
});

function createDependencies(
  options: { readonly exists?: boolean; readonly applied?: boolean } = {},
) {
  const resource = { toString: () => plan.uri };
  const edit = { operations: [] as string[] };
  const resolveTarget = vi.fn(async () => ({ resource, exists: options.exists ?? false }));
  const createWorkspaceEdit = vi.fn(() => edit);
  const createFile = vi.fn((target, uri) => target.operations.push(`create:${uri.toString()}`));
  const insert = vi.fn((target, _uri, text) => target.operations.push(`insert:${text}`));
  const createCheckpoint = vi.fn(async () => {});
  const applyWorkspaceEdit = vi.fn(async () => options.applied ?? true);
  const values = {
    resolveTarget,
    createWorkspaceEdit,
    createFile,
    insert,
    assertCanApply: vi.fn(),
    applyWorkspaceEdit,
    createCheckpoint,
    createId: () => "checkpoint-1",
    now: () => new Date("2026-08-13T00:00:00.000Z"),
  } satisfies FileCreateApplierDependencies<typeof resource, typeof edit>;
  return { values, createCheckpoint, createFile, insert, applyWorkspaceEdit };
}
