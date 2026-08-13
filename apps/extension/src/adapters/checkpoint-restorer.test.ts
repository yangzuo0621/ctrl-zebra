import type { Checkpoint, CheckpointFile } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  CheckpointRestoreApplyError,
  CheckpointRestoreConflictError,
  type CheckpointRestoreResource,
  CheckpointRestorer,
  type CheckpointRestorerDependencies,
  CheckpointRestoreVerificationError,
} from "./checkpoint-restorer.js";

const afterOne = "after one\n";
const afterTwo = "after two\n";
const beforeOne = "before one\n";
const beforeTwo = "before two\n";

const lifecycleDeleteCheckpoint = {
  id: "checkpoint-delete-created",
  sessionId: "session-1",
  runId: "run-1",
  createdAt: "2026-07-19T16:00:00+08:00",
  files: [
    {
      uri: "file:///workspace/new.txt",
      before: { kind: "absent" },
      after: { kind: "text", afterHash: lifecycleHashText("created\n") },
    },
  ],
} satisfies Checkpoint;

const lifecycleRecreateCheckpoint = {
  id: "checkpoint-recreate-deleted",
  sessionId: "session-1",
  runId: "run-1",
  createdAt: "2026-07-19T16:00:00+08:00",
  files: [
    {
      uri: "file:///workspace/deleted.txt",
      before: {
        kind: "text",
        content: "before deletion\n",
        beforeHash: lifecycleHashText("before deletion\n"),
      },
      after: { kind: "absent" },
    },
  ],
} satisfies Checkpoint;

const checkpoint = {
  id: "checkpoint-1",
  sessionId: "session-1",
  runId: "run-1",
  createdAt: "2026-07-19T16:00:00+08:00",
  files: [
    checkpointFile("file:///workspace/one.ts", beforeOne, afterOne),
    checkpointFile("file:///workspace/two.ts", beforeTwo, afterTwo),
  ],
} satisfies Checkpoint;

interface FakeEdit {
  readonly replacements: Array<{ readonly uri: string; readonly text: string }>;
}

describe("CheckpointRestorer", () => {
  it("atomically restores every target after two successful preflight checks", async () => {
    const dependencies = createDependencies();
    const restorer = new CheckpointRestorer(dependencies.values);

    await restorer.restore(checkpoint.id, new AbortController().signal);

    expect(dependencies.createWorkspaceEdit).toHaveBeenCalledOnce();
    expect(dependencies.applyWorkspaceEdit).toHaveBeenCalledOnce();
    expect(dependencies.current).toEqual(
      new Map([
        [checkpoint.files[0].uri, beforeOne],
        [checkpoint.files[1].uri, beforeTwo],
      ]),
    );
    expect(dependencies.resolveDocument).toHaveBeenCalledTimes(6);
  });

  it("leaves every file unchanged when one current afterHash conflicts", async () => {
    const dependencies = createDependencies();
    dependencies.current.set(checkpoint.files[1].uri, "user changed\n");
    const restorer = new CheckpointRestorer(dependencies.values);

    await expect(
      restorer.restore(checkpoint.id, new AbortController().signal),
    ).rejects.toBeInstanceOf(CheckpointRestoreConflictError);
    expect(dependencies.createWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.current.get(checkpoint.files[0].uri)).toBe(afterOne);
  });

  it("detects a race during the second preflight and performs no write", async () => {
    const dependencies = createDependencies({ conflictOnResolveCall: 3 });
    const restorer = new CheckpointRestorer(dependencies.values);

    await expect(
      restorer.restore(checkpoint.id, new AbortController().signal),
    ).rejects.toBeInstanceOf(CheckpointRestoreConflictError);
    expect(dependencies.createWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("reports host apply failure separately", async () => {
    const dependencies = createDependencies({ applied: false });
    const restorer = new CheckpointRestorer(dependencies.values);

    await expect(
      restorer.restore(checkpoint.id, new AbortController().signal),
    ).rejects.toBeInstanceOf(CheckpointRestoreApplyError);
  });

  it("verifies every beforeHash after the host reports success", async () => {
    const dependencies = createDependencies({ mutateOnApply: false });
    const restorer = new CheckpointRestorer(dependencies.values);

    await expect(
      restorer.restore(checkpoint.id, new AbortController().signal),
    ).rejects.toBeInstanceOf(CheckpointRestoreVerificationError);
  });

  it("performs no work when already cancelled", async () => {
    const dependencies = createDependencies();
    const restorer = new CheckpointRestorer(dependencies.values);
    const controller = new AbortController();
    const cancellation = new Error("cancel restore");
    controller.abort(cancellation);

    await expect(restorer.restore(checkpoint.id, controller.signal)).rejects.toBe(cancellation);
    expect(dependencies.loadCheckpoint).not.toHaveBeenCalled();
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("restores a file that was created from an originally absent state", async () => {
    const dependencies = createLifecycleDependencies(lifecycleDeleteCheckpoint, "created\n");
    const restorer = new CheckpointRestorer(dependencies.values);

    await restorer.restore(lifecycleDeleteCheckpoint.id, new AbortController().signal);

    expect(dependencies.deleteFile).toHaveBeenCalledOnce();
    expect(dependencies.deleteFile.mock.calls[0]?.[1]?.toString()).toBe(
      lifecycleDeleteCheckpoint.files[0].uri,
    );
    expect(dependencies.current.has(lifecycleDeleteCheckpoint.files[0].uri)).toBe(false);
  });

  it("recreates a file that was deleted to an originally present state", async () => {
    const dependencies = createLifecycleDependencies(lifecycleRecreateCheckpoint);
    const restorer = new CheckpointRestorer(dependencies.values);

    await restorer.restore(lifecycleRecreateCheckpoint.id, new AbortController().signal);

    expect(dependencies.createFile).toHaveBeenCalledOnce();
    expect(dependencies.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "before deletion\n",
    );
    expect(dependencies.current.get(lifecycleRecreateCheckpoint.files[0].uri)).toBe(
      "before deletion\n",
    );
  });

  it("does not apply a lifecycle restore when cancellation races edit construction", async () => {
    const dependencies = createLifecycleDependencies(lifecycleDeleteCheckpoint, "created\n");
    const controller = new AbortController();
    const cancellation = new Error("cancel restore before apply");
    dependencies.deleteFile.mockImplementation(() => controller.abort(cancellation));
    const restorer = new CheckpointRestorer(dependencies.values);

    await expect(restorer.restore(lifecycleDeleteCheckpoint.id, controller.signal)).rejects.toBe(
      cancellation,
    );
    expect(dependencies.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.current.has(lifecycleDeleteCheckpoint.files[0].uri)).toBe(true);
  });
});

function checkpointFile(uri: string, beforeContent: string, afterContent: string): CheckpointFile {
  return {
    uri,
    beforeContent,
    beforeHash: hashText(beforeContent),
    afterHash: hashText(afterContent),
  };
}

function hashText(text: string): string {
  const marker = text.startsWith("before") ? "a" : text.startsWith("after") ? "b" : "c";
  return `${marker}${text.length.toString(16).padStart(63, "0")}`;
}

function lifecycleHashText(text: string): string {
  return `lifecycle:${text}`;
}

function createDependencies(
  options: {
    readonly applied?: boolean;
    readonly conflictOnResolveCall?: number;
    readonly mutateOnApply?: boolean;
  } = {},
) {
  const current = new Map([
    [checkpoint.files[0].uri, afterOne],
    [checkpoint.files[1].uri, afterTwo],
  ]);
  const loadCheckpoint = vi.fn(async () => checkpoint);
  let resolveCalls = 0;
  const resolveDocument = vi.fn<FakeDependencies["resolveDocument"]>(async (uri) => {
    resolveCalls += 1;
    if (resolveCalls === options.conflictOnResolveCall) {
      current.set(uri, "raced change\n");
    }
    const text = current.get(uri);
    if (text === undefined) {
      throw new Error("missing test document");
    }
    return {
      uri: resource(uri),
      text,
      end: { line: 0, character: text.length },
    };
  });
  const createWorkspaceEdit = vi.fn<FakeDependencies["createWorkspaceEdit"]>(() => ({
    replacements: [],
  }));
  const replace = vi.fn<FakeDependencies["replace"]>((edit, uri, _range, text) => {
    edit.replacements.push({ uri: uri.toString(), text });
  });
  const applyWorkspaceEdit = vi.fn<FakeDependencies["applyWorkspaceEdit"]>(async (edit) => {
    if (!(options.applied ?? true)) {
      return false;
    }
    if (options.mutateOnApply ?? true) {
      for (const replacement of edit.replacements) {
        current.set(replacement.uri, replacement.text);
      }
    }
    return true;
  });

  return {
    values: {
      loadCheckpoint,
      resolveDocument,
      createWorkspaceEdit,
      replace,
      applyWorkspaceEdit,
      hashText,
    } satisfies FakeDependencies,
    current,
    loadCheckpoint,
    resolveDocument,
    createWorkspaceEdit,
    applyWorkspaceEdit,
  };
}

function createLifecycleDependencies(checkpoint: Checkpoint, initialText?: string) {
  const uri = checkpoint.files[0]?.uri;
  if (uri === undefined) throw new Error("lifecycle test checkpoint is empty");
  const current = new Map<string, string>();
  if (initialText !== undefined) current.set(uri, initialText);

  const resolveDocument = vi.fn<FakeDependencies["resolveDocument"]>(async (requested) => {
    const text = current.get(requested);
    if (text === undefined) return undefined;
    return {
      uri: resource(requested),
      text,
      end: { line: 0, character: text.length },
    };
  });
  const edit: LifecycleEdit = { operations: [] };
  const createWorkspaceEdit = vi.fn<LifecycleDependencies["createWorkspaceEdit"]>(() => edit);
  const replace = vi.fn<LifecycleDependencies["replace"]>((target, resourceValue, _range, text) => {
    target.operations.push({ kind: "replace", uri: resourceValue.toString(), text });
  });
  const createFile = vi.fn<NonNullable<LifecycleDependencies["createFile"]>>(
    (target, resourceValue) => {
      target.operations.push({ kind: "create", uri: resourceValue.toString(), text: "" });
    },
  );
  const insert = vi.fn<NonNullable<LifecycleDependencies["insert"]>>(
    (target, resourceValue, text) => {
      target.operations.push({ kind: "insert", uri: resourceValue.toString(), text });
    },
  );
  const deleteFile = vi.fn<NonNullable<LifecycleDependencies["deleteFile"]>>(
    (target, resourceValue) => {
      target.operations.push({ kind: "delete", uri: resourceValue.toString(), text: "" });
    },
  );
  const applyWorkspaceEdit = vi.fn<LifecycleDependencies["applyWorkspaceEdit"]>(async (target) => {
    for (const operation of target.operations) {
      if (operation.kind === "delete") current.delete(operation.uri);
      else current.set(operation.uri, operation.text);
    }
    return true;
  });
  const values = {
    loadCheckpoint: vi.fn(async (checkpointId) =>
      checkpointId === checkpoint.id ? checkpoint : undefined,
    ),
    resolveDocument,
    createWorkspaceEdit,
    createResource: resource,
    replace,
    createFile,
    insert,
    deleteFile,
    applyWorkspaceEdit,
    hashText: lifecycleHashText,
  } satisfies LifecycleDependencies;

  return { values, current, createFile, insert, deleteFile, applyWorkspaceEdit };
}

interface Operation {
  readonly kind: "replace" | "create" | "insert" | "delete";
  readonly uri: string;
  readonly text: string;
}

interface LifecycleEdit {
  operations: Operation[];
}

type LifecycleDependencies = CheckpointRestorerDependencies<
  CheckpointRestoreResource,
  LifecycleEdit
>;

type FakeDependencies = CheckpointRestorerDependencies<CheckpointRestoreResource, FakeEdit>;

function resource(uri: string): CheckpointRestoreResource {
  return { toString: () => uri };
}
