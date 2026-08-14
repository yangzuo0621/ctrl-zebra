import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Uri } from "vscode";

const vscode = vi.hoisted(() => {
  class WorkspaceEdit {
    readonly deleteFile = vi.fn();
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

import { createVsCodeFileDeleteApplier } from "./create-vscode-file-delete-applier.js";
import { FileDeleteConflictError } from "./file-delete-applier.js";

const target = uri("file:///workspace/remove.txt");
const content = "zebra\ntext";
const plan = {
  operation: "delete",
  path: "remove.txt",
  uri: target.toString(),
  beforeContent: content,
  beforeHash: hashText(content),
} as const;
const ownership = { sessionId: "session-1", runId: "run-1" } as const;

describe("createVsCodeFileDeleteApplier", () => {
  beforeEach(() => {
    vscode.Uri.parse.mockReset().mockReturnValue(target);
    vscode.workspace.fs.stat.mockReset().mockResolvedValue({
      type: vscode.FileType.File,
      size: content.length,
      ctime: 1,
      mtime: 1,
    });
    vscode.workspace.applyEdit.mockReset().mockResolvedValue(true);
    boundedRead.readSupportedWorkspaceText.mockReset().mockResolvedValue(content);
    fileSystemErrors.isVscodeFileNotFound.mockReset().mockReturnValue(false);
  });

  it("uses bounded raw text for both preflights and never opens an unbounded document", async () => {
    const scope = { validate: vi.fn(async () => target) };
    const createCheckpoint = vi.fn(async () => undefined);
    const editApplier = createVsCodeFileDeleteApplier(
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
    expect(edit.deleteFile).toHaveBeenCalledWith(target, {
      recursive: false,
      ignoreIfNotExists: false,
    });
  });

  it("maps bounded-reader rejection to a conflict before Checkpoint or mutation", async () => {
    boundedRead.readSupportedWorkspaceText.mockRejectedValue(
      new boundedRead.UnsupportedWorkspaceTextError(),
    );
    const createCheckpoint = vi.fn(async () => undefined);
    const editApplier = createVsCodeFileDeleteApplier(
      { validate: vi.fn(async () => target) },
      createCheckpoint,
      () => "checkpoint-1",
      () => new Date("2026-08-14T00:00:00.000Z"),
      vi.fn(),
    );

    await expect(
      editApplier.apply(plan, ownership, new AbortController().signal),
    ).rejects.toBeInstanceOf(FileDeleteConflictError);
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
