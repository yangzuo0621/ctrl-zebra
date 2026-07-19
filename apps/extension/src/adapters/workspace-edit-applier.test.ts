import type { TextEditPlan, TextPosition } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import {
  InvalidWorkspaceEditRangeError,
  WorkspaceEditApplier,
  type WorkspaceEditApplierDependencies,
  WorkspaceEditApplyError,
  WorkspaceEditConflictError,
  type WorkspaceEditResource,
} from "./workspace-edit-applier.js";

const uri = resource("file:///workspace/example.ts");
const plan = {
  uri: uri.toString(),
  originalRevision: { kind: "document_version", value: 7 },
  edits: [
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      newText: "ONE",
    },
    {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
      newText: "TWO",
    },
  ],
} satisfies TextEditPlan;
const ownership = { sessionId: "session-1", runId: "run-1" } as const;

interface FakeWorkspaceEdit {
  readonly replacements: Array<{
    readonly uri: WorkspaceEditResource;
    readonly range: TextEditPlan["edits"][number]["range"];
    readonly newText: string;
  }>;
}

describe("WorkspaceEditApplier", () => {
  it("applies every replacement through one WorkspaceEdit", async () => {
    const dependencies = createDependencies();
    const applier = new WorkspaceEditApplier(dependencies.values);
    const signal = new AbortController().signal;

    await applier.apply(plan, ownership, signal);

    expect(dependencies.resolveDocument).toHaveBeenCalledWith(plan.uri, signal);
    expect(dependencies.createWorkspaceEdit).toHaveBeenCalledOnce();
    expect(dependencies.applyWorkspaceEdit).toHaveBeenCalledOnce();
    expect(dependencies.createCheckpoint).toHaveBeenCalledWith(
      {
        id: "checkpoint-1",
        sessionId: ownership.sessionId,
        runId: ownership.runId,
        createdAt: "2026-07-19T00:00:00.000Z",
        files: [
          {
            uri: plan.uri,
            beforeContent: "one\ntwo",
            beforeHash: "hash:one\ntwo",
            afterHash: "hash:ONE\nTWO",
          },
        ],
      },
      signal,
    );
    expect(dependencies.createCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.applyWorkspaceEdit.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(dependencies.applyWorkspaceEdit.mock.calls[0]?.[0].replacements).toEqual([
      { uri, range: plan.edits[0]?.range, newText: "ONE" },
      { uri, range: plan.edits[1]?.range, newText: "TWO" },
    ]);
  });

  it.each([
    { ...plan, originalRevision: { kind: "document_version", value: 8 } as const },
    {
      ...plan,
      originalRevision: {
        kind: "content_hash",
        algorithm: "sha256",
        value: "a".repeat(64),
      } as const,
    },
    { ...plan, uri: "file:///workspace/other.ts" },
  ])("rejects a revision or canonical URI conflict before constructing an edit %#", async (value) => {
    const dependencies = createDependencies();
    const applier = new WorkspaceEditApplier(dependencies.values);

    await expect(
      applier.apply(value, ownership, new AbortController().signal),
    ).rejects.toBeInstanceOf(WorkspaceEditConflictError);
    expect(dependencies.createWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("accepts an exact SHA-256 revision", async () => {
    const dependencies = createDependencies();
    const applier = new WorkspaceEditApplier(dependencies.values);

    await expect(
      applier.apply(
        {
          ...plan,
          originalRevision: {
            kind: "content_hash",
            algorithm: "sha256",
            value: "hash:one\ntwo",
          },
        },
        ownership,
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    expect(dependencies.hashText).toHaveBeenCalledWith("one\ntwo");
  });

  it("rejects an out-of-document range before applying", async () => {
    const dependencies = createDependencies({
      isValidPosition: (position) => position.line < 2,
    });
    const applier = new WorkspaceEditApplier(dependencies.values);

    await expect(
      applier.apply(
        {
          ...plan,
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
              newText: "outside",
            },
          ],
        },
        ownership,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(InvalidWorkspaceEditRangeError);
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("reports applyEdit false as a stable failure", async () => {
    const dependencies = createDependencies({ applied: false });
    const applier = new WorkspaceEditApplier(dependencies.values);

    await expect(
      applier.apply(plan, ownership, new AbortController().signal),
    ).rejects.toBeInstanceOf(WorkspaceEditApplyError);
    expect(dependencies.applyWorkspaceEdit).toHaveBeenCalledOnce();
  });

  it("does not resolve or apply a document when already cancelled", async () => {
    const dependencies = createDependencies();
    const applier = new WorkspaceEditApplier(dependencies.values);
    const controller = new AbortController();
    const cancellation = new Error("cancel edit");
    controller.abort(cancellation);

    await expect(applier.apply(plan, ownership, controller.signal)).rejects.toBe(cancellation);
    expect(dependencies.resolveDocument).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("does not construct or apply an edit when Checkpoint creation fails", async () => {
    const checkpointFailure = new Error("Checkpoint creation failed");
    const dependencies = createDependencies({ checkpointFailure });
    const applier = new WorkspaceEditApplier(dependencies.values);

    await expect(applier.apply(plan, ownership, new AbortController().signal)).rejects.toBe(
      checkpointFailure,
    );
    expect(dependencies.createCheckpoint).toHaveBeenCalledOnce();
    expect(dependencies.createWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });
});

function createDependencies(
  options: {
    readonly applied?: boolean;
    readonly isValidPosition?: (position: TextPosition) => boolean;
    readonly checkpointFailure?: Error;
  } = {},
) {
  const resolveDocument = vi.fn(async () => ({
    uri,
    version: 7,
    text: "one\ntwo",
    isValidPosition: options.isValidPosition ?? (() => true),
    offsetAt: (position: TextPosition) =>
      position.line === 0 ? position.character : 4 + position.character,
  }));
  const createWorkspaceEdit = vi.fn<FakeDependencies["createWorkspaceEdit"]>(() => ({
    replacements: [],
  }));
  const replace = vi.fn<FakeDependencies["replace"]>((edit, target, range, newText) => {
    edit.replacements.push({ uri: target, range, newText });
  });
  const applyWorkspaceEdit = vi.fn<FakeDependencies["applyWorkspaceEdit"]>(
    async () => options.applied ?? true,
  );
  const hashText = vi.fn<FakeDependencies["hashText"]>((text) => `hash:${text}`);
  const createCheckpoint = vi.fn<FakeDependencies["createCheckpoint"]>(async () => {
    if (options.checkpointFailure !== undefined) {
      throw options.checkpointFailure;
    }
  });

  return {
    values: {
      resolveDocument,
      createWorkspaceEdit,
      replace,
      applyWorkspaceEdit,
      hashText,
      createId: () => "checkpoint-1",
      now: () => new Date("2026-07-19T00:00:00.000Z"),
      createCheckpoint,
    } satisfies FakeDependencies,
    resolveDocument,
    createWorkspaceEdit,
    applyWorkspaceEdit,
    hashText,
    createCheckpoint,
  };
}

type FakeDependencies = WorkspaceEditApplierDependencies<WorkspaceEditResource, FakeWorkspaceEdit>;

function resource(value: string): WorkspaceEditResource {
  return { toString: () => value };
}
