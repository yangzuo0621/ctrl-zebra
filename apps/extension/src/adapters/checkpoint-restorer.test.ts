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

type FakeDependencies = CheckpointRestorerDependencies<CheckpointRestoreResource, FakeEdit>;

function resource(uri: string): CheckpointRestoreResource {
  return { toString: () => uri };
}
