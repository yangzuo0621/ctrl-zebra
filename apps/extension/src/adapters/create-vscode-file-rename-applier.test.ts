import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Uri } from "vscode";

const vscode = vi.hoisted(() => {
  class WorkspaceEdit {
    readonly renameFile = vi.fn();
  }
  return {
    FileType: { File: 1, Directory: 2 },
    Uri: { parse: vi.fn() },
    WorkspaceEdit,
    workspace: { fs: { stat: vi.fn() }, applyEdit: vi.fn() },
  };
});
const boundedRead = vi.hoisted(() => {
  class UnsupportedWorkspaceTextError extends Error {}
  return { readSupportedWorkspaceText: vi.fn(), UnsupportedWorkspaceTextError };
});
const fileSystemErrors = vi.hoisted(() => ({ isVscodeFileNotFound: vi.fn() }));

vi.mock("vscode", () => vscode);
vi.mock("./vscode-propose-file-edit-workspace.js", () => boundedRead);
vi.mock("./vscode-file-system-error.js", () => fileSystemErrors);

import { createVsCodeFileRenameApplier } from "./create-vscode-file-rename-applier.js";
import { FileRenameConflictError } from "./file-rename-applier.js";

const source = uri("file:///workspace/source.txt");
const target = uri("file:///workspace/target.txt");
const targetMissing = new Error("target missing");
const content = "zebra\ntext";
const plan = {
  operation: "rename",
  sourcePath: "source.txt",
  targetPath: "target.txt",
  sourceUri: source.toString(),
  targetUri: target.toString(),
  beforeContent: content,
  beforeHash: hashText(content),
} as const;
const ownership = { sessionId: "session-1", runId: "run-1" } as const;

describe("createVsCodeFileRenameApplier", () => {
  beforeEach(() => {
    vscode.Uri.parse
      .mockReset()
      .mockImplementation((value: string) => (value === source.toString() ? source : target));
    vscode.workspace.fs.stat
      .mockReset()
      .mockImplementation(async (value: { toString: () => string }) => {
        if (value.toString() === target.toString()) throw targetMissing;
        return {
          type: vscode.FileType.File,
          size: content.length,
          ctime: 1,
          mtime: 1,
        };
      });
    vscode.workspace.applyEdit.mockReset().mockResolvedValue(true);
    boundedRead.readSupportedWorkspaceText.mockReset().mockResolvedValue(content);
    fileSystemErrors.isVscodeFileNotFound
      .mockReset()
      .mockImplementation((error: unknown) => error === targetMissing);
  });

  it("uses bounded raw source text for both preflights and never opens an unbounded document", async () => {
    const scope = {
      validate: vi.fn(async (value: Uri) => value),
      validateNewFile: vi.fn(async (value: Uri) => value),
    };
    const createCheckpoint = vi.fn(async () => undefined);
    const editApplier = createVsCodeFileRenameApplier(
      scope,
      createCheckpoint,
      () => "checkpoint-1",
      () => new Date("2026-08-14T00:00:00.000Z"),
      vi.fn(),
    );

    await expect(
      editApplier.apply(plan, ownership, new AbortController().signal),
    ).resolves.toBeUndefined();

    expect(boundedRead.readSupportedWorkspaceText).toHaveBeenCalledTimes(2);
    expect(createCheckpoint).toHaveBeenCalledOnce();
    expect(vscode.workspace.applyEdit).toHaveBeenCalledOnce();
    const edit = vscode.workspace.applyEdit.mock.calls[0]?.[0] as InstanceType<
      typeof vscode.WorkspaceEdit
    >;
    expect(edit.renameFile).toHaveBeenCalledWith(source, target, {
      overwrite: false,
      ignoreIfExists: false,
    });
  });

  it("maps bounded-reader rejection to a conflict before Checkpoint or mutation", async () => {
    boundedRead.readSupportedWorkspaceText.mockRejectedValue(
      new boundedRead.UnsupportedWorkspaceTextError(),
    );
    const createCheckpoint = vi.fn(async () => undefined);
    const editApplier = createVsCodeFileRenameApplier(
      {
        validate: vi.fn(async (value: Uri) => value),
        validateNewFile: vi.fn(async (value: Uri) => value),
      },
      createCheckpoint,
      () => "checkpoint-1",
      () => new Date("2026-08-14T00:00:00.000Z"),
      vi.fn(),
    );

    await expect(
      editApplier.apply(plan, ownership, new AbortController().signal),
    ).rejects.toBeInstanceOf(FileRenameConflictError);
    expect(createCheckpoint).not.toHaveBeenCalled();
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });
});

function uri(value: string): Uri {
  return { scheme: "file", toString: () => value } as Uri;
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
