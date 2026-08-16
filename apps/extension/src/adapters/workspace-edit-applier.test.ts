import type { TextEditPlan, TextPosition, WorkspaceEditPlan } from "@ctrl-zebra/core";
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
  ])(
    "rejects a revision or canonical URI conflict before constructing an edit %#",
    async (value) => {
      const dependencies = createDependencies();
      const applier = new WorkspaceEditApplier(dependencies.values);

      await expect(
        applier.apply(value, ownership, new AbortController().signal),
      ).rejects.toBeInstanceOf(WorkspaceEditConflictError);
      expect(dependencies.createWorkspaceEdit).not.toHaveBeenCalled();
      expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
    },
  );

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

  it("rechecks host policy immediately before applying the workspace edit", async () => {
    const policyFailure = new Error("Workspace trust changed");
    const dependencies = createDependencies({ policyFailure });
    const applier = new WorkspaceEditApplier(dependencies.values);

    await expect(applier.apply(plan, ownership, new AbortController().signal)).rejects.toBe(
      policyFailure,
    );
    expect(dependencies.createCheckpoint).toHaveBeenCalledOnce();
    expect(dependencies.assertCanApply).toHaveBeenCalledOnce();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("preflights every target, persists one state-union Checkpoint, and applies one atomic edit", async () => {
    const a = resource("file:///workspace/a.ts");
    const b = resource("file:///workspace/b.ts");
    const multiPlan = {
      operation: "edit",
      files: [
        {
          path: "a.ts",
          uri: a.toString(),
          originalRevision: { kind: "document_version", value: 1 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
              newText: "AAA",
            },
          ],
        },
        {
          path: "b.ts",
          uri: b.toString(),
          originalRevision: { kind: "document_version", value: 2 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
              newText: "BBB",
            },
          ],
        },
      ],
    } satisfies WorkspaceEditPlan;
    const dependencies = createMultiDependencies({
      [a.toString()]: { resource: a, version: 1, text: "aaa" },
      [b.toString()]: { resource: b, version: 2, text: "bbb" },
    });
    const applier = new WorkspaceEditApplier(dependencies.values);

    await applier.apply(multiPlan, ownership, new AbortController().signal);

    expect(dependencies.createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          {
            uri: a.toString(),
            before: { kind: "text", content: "aaa", beforeHash: "hash:aaa" },
            after: { kind: "text", afterHash: "hash:AAA" },
          },
          {
            uri: b.toString(),
            before: { kind: "text", content: "bbb", beforeHash: "hash:bbb" },
            after: { kind: "text", afterHash: "hash:BBB" },
          },
        ],
      }),
      expect.any(AbortSignal),
    );
    expect(dependencies.createWorkspaceEdit).toHaveBeenCalledOnce();
    expect(dependencies.applyWorkspaceEdit).toHaveBeenCalledOnce();
    expect(dependencies.applyWorkspaceEdit.mock.calls[0]?.[0].replacements).toEqual([
      { uri: a, range: multiPlan.files[0]?.edits[0]?.range, newText: "AAA" },
      { uri: b, range: multiPlan.files[1]?.edits[0]?.range, newText: "BBB" },
    ]);
  });

  it("rejects one stale target before Checkpoint creation and leaves all files untouched", async () => {
    const a = resource("file:///workspace/a.ts");
    const b = resource("file:///workspace/b.ts");
    const multiPlan = {
      operation: "edit",
      files: [
        {
          path: "a.ts",
          uri: a.toString(),
          originalRevision: { kind: "document_version", value: 1 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "a",
            },
          ],
        },
        {
          path: "b.ts",
          uri: b.toString(),
          originalRevision: { kind: "document_version", value: 2 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "b",
            },
          ],
        },
      ],
    } satisfies WorkspaceEditPlan;
    const dependencies = createMultiDependencies({
      [a.toString()]: { resource: a, version: 1, text: "aaa" },
      [b.toString()]: { resource: b, version: 3, text: "bbb" },
    });
    const applier = new WorkspaceEditApplier(dependencies.values);

    await expect(
      applier.apply(multiPlan, ownership, new AbortController().signal),
    ).rejects.toBeInstanceOf(WorkspaceEditConflictError);
    expect(dependencies.createCheckpoint).not.toHaveBeenCalled();
    expect(dependencies.createWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("maps a missing approved target to a conflict before creating a Checkpoint", async () => {
    const a = resource("file:///workspace/a.ts");
    const b = resource("file:///workspace/b.ts");
    const multiPlan = {
      operation: "edit",
      files: [
        {
          path: "a.ts",
          uri: a.toString(),
          originalRevision: { kind: "document_version", value: 1 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "a",
            },
          ],
        },
        {
          path: "b.ts",
          uri: b.toString(),
          originalRevision: { kind: "document_version", value: 2 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "b",
            },
          ],
        },
      ],
    } satisfies WorkspaceEditPlan;
    const dependencies = createMultiDependencies({
      [a.toString()]: { resource: a, version: 1, text: "aaa" },
    });
    const applier = new WorkspaceEditApplier(dependencies.values);

    await expect(
      applier.apply(multiPlan, ownership, new AbortController().signal),
    ).rejects.toBeInstanceOf(WorkspaceEditConflictError);
    expect(dependencies.createCheckpoint).not.toHaveBeenCalled();
    expect(dependencies.createWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("maps a target resolution failure during the final recheck to a conflict", async () => {
    const a = resource("file:///workspace/a.ts");
    const b = resource("file:///workspace/b.ts");
    const multiPlan = {
      operation: "edit",
      files: [
        {
          path: "a.ts",
          uri: a.toString(),
          originalRevision: { kind: "document_version", value: 1 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "a",
            },
          ],
        },
        {
          path: "b.ts",
          uri: b.toString(),
          originalRevision: { kind: "document_version", value: 2 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "b",
            },
          ],
        },
      ],
    } satisfies WorkspaceEditPlan;
    const dependencies = createMultiDependencies(
      {
        [a.toString()]: { resource: a, version: 1, text: "aaa" },
        [b.toString()]: { resource: b, version: 2, text: "bbb" },
      },
      { failAtResolve: 3 },
    );
    const applier = new WorkspaceEditApplier(dependencies.values);

    await expect(
      applier.apply(multiPlan, ownership, new AbortController().signal),
    ).rejects.toBeInstanceOf(WorkspaceEditConflictError);
    expect(dependencies.createCheckpoint).toHaveBeenCalledOnce();
    expect(dependencies.createWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("rejects unsupported before text before creating a Checkpoint", async () => {
    const a = resource("file:///workspace/a.ts");
    const b = resource("file:///workspace/b.ts");
    const multiPlan = {
      operation: "edit",
      files: [
        {
          path: "a.ts",
          uri: a.toString(),
          originalRevision: { kind: "document_version", value: 1 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "a",
            },
          ],
        },
        {
          path: "b.ts",
          uri: b.toString(),
          originalRevision: { kind: "document_version", value: 2 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "b",
            },
          ],
        },
      ],
    } satisfies WorkspaceEditPlan;
    const dependencies = createMultiDependencies({
      [a.toString()]: { resource: a, version: 1, text: "a\0a" },
      [b.toString()]: { resource: b, version: 2, text: "bbb" },
    });
    const applier = new WorkspaceEditApplier(dependencies.values);

    await expect(
      applier.apply(multiPlan, ownership, new AbortController().signal),
    ).rejects.toBeInstanceOf(WorkspaceEditConflictError);
    expect(dependencies.createCheckpoint).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("rejects a computed after text that exceeds the lifecycle text bound", async () => {
    const a = resource("file:///workspace/a.ts");
    const b = resource("file:///workspace/b.ts");
    const multiPlan = {
      operation: "edit",
      files: [
        {
          path: "a.ts",
          uri: a.toString(),
          originalRevision: { kind: "document_version", value: 1 },
          edits: [
            {
              range: {
                start: { line: 0, character: 65_536 },
                end: { line: 0, character: 65_536 },
              },
              newText: "x",
            },
          ],
        },
        {
          path: "b.ts",
          uri: b.toString(),
          originalRevision: { kind: "document_version", value: 2 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "b",
            },
          ],
        },
      ],
    } satisfies WorkspaceEditPlan;
    const dependencies = createMultiDependencies({
      [a.toString()]: { resource: a, version: 1, text: "x".repeat(65_536) },
      [b.toString()]: { resource: b, version: 2, text: "bbb" },
    });
    const applier = new WorkspaceEditApplier(dependencies.values);

    await expect(
      applier.apply(multiPlan, ownership, new AbortController().signal),
    ).rejects.toBeInstanceOf(WorkspaceEditConflictError);
    expect(dependencies.createCheckpoint).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });
});

function createDependencies(
  options: {
    readonly applied?: boolean;
    readonly isValidPosition?: (position: TextPosition) => boolean;
    readonly checkpointFailure?: Error;
    readonly policyFailure?: Error;
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
  const assertCanApply = vi.fn<FakeDependencies["assertCanApply"]>(() => {
    if (options.policyFailure !== undefined) {
      throw options.policyFailure;
    }
  });
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
      assertCanApply,
      applyWorkspaceEdit,
      hashText,
      createId: () => "checkpoint-1",
      now: () => new Date("2026-07-19T00:00:00.000Z"),
      createCheckpoint,
    } satisfies FakeDependencies,
    resolveDocument,
    createWorkspaceEdit,
    applyWorkspaceEdit,
    assertCanApply,
    hashText,
    createCheckpoint,
  };
}

type FakeDependencies = WorkspaceEditApplierDependencies<WorkspaceEditResource, FakeWorkspaceEdit>;

function createMultiDependencies(
  documents: Record<
    string,
    { readonly resource: WorkspaceEditResource; readonly version: number; readonly text: string }
  >,
  options: { readonly failAtResolve?: number } = {},
) {
  let resolveCount = 0;
  const resolveDocument = vi.fn(async (serializedUri: string) => {
    resolveCount += 1;
    if (options.failAtResolve === resolveCount) throw new Error("missing document");
    const value = documents[serializedUri];
    if (value === undefined) throw new Error("missing document");
    return {
      uri: value.resource,
      version: value.version,
      text: value.text,
      isValidPosition: () => true,
      offsetAt: (position: TextPosition) => position.character,
    };
  });
  const createWorkspaceEdit = vi.fn<FakeDependencies["createWorkspaceEdit"]>(() => ({
    replacements: [],
  }));
  const replace = vi.fn<FakeDependencies["replace"]>((edit, target, range, newText) => {
    edit.replacements.push({ uri: target, range, newText });
  });
  const applyWorkspaceEdit = vi.fn<FakeDependencies["applyWorkspaceEdit"]>(async () => true);
  const assertCanApply = vi.fn();
  const hashText = vi.fn<FakeDependencies["hashText"]>((text) => `hash:${text}`);
  const createCheckpoint = vi.fn<FakeDependencies["createCheckpoint"]>(async () => {});
  return {
    values: {
      resolveDocument,
      createWorkspaceEdit,
      replace,
      assertCanApply,
      applyWorkspaceEdit,
      hashText,
      createId: () => "checkpoint-1",
      now: () => new Date("2026-07-19T00:00:00.000Z"),
      createCheckpoint,
    } satisfies FakeDependencies,
    createWorkspaceEdit,
    applyWorkspaceEdit,
    createCheckpoint,
    resolveDocument,
  };
}

function resource(value: string): WorkspaceEditResource {
  return { toString: () => value };
}
