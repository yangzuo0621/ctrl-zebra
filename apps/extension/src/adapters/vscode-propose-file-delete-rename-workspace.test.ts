import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Uri } from "vscode";

const vscode = vi.hoisted(() => ({
  FileType: { File: 1, Directory: 2 },
  Uri: { parse: vi.fn() },
  workspace: { fs: { stat: vi.fn() } },
}));
const boundedRead = vi.hoisted(() => {
  class UnsupportedWorkspaceTextError extends Error {}
  return { readSupportedWorkspaceText: vi.fn(), UnsupportedWorkspaceTextError };
});
const fileSystemErrors = vi.hoisted(() => ({ isVscodeFileNotFound: vi.fn() }));

vi.mock("vscode", () => vscode);
vi.mock("./vscode-propose-file-edit-workspace.js", () => boundedRead);
vi.mock("./vscode-file-system-error.js", () => fileSystemErrors);

import {
  FileDeleteTargetNotFoundError,
  FileRenameSourceNotFoundError,
} from "@ctrl-zebra/builtin-tools";
import { VsCodeProposeFileDeleteRenameWorkspace } from "./vscode-propose-file-delete-rename-workspace.js";
import type { WorkspaceScope } from "./workspace-scope.js";

const root = uri("file:///workspace", "/workspace");
const source = uri("file:///workspace/source.txt", "/workspace/source.txt");
const target = uri("file:///workspace/target.txt", "/workspace/target.txt");
const signal = new AbortController().signal;

describe("VsCodeProposeFileDeleteRenameWorkspace", () => {
  beforeEach(() => {
    vscode.Uri.parse.mockReset();
    vscode.workspace.fs.stat.mockReset();
    boundedRead.readSupportedWorkspaceText.mockReset();
    fileSystemErrors.isVscodeFileNotFound.mockReset();
    boundedRead.readSupportedWorkspaceText.mockResolvedValue("zebra\ntext");
    fileSystemErrors.isVscodeFileNotFound.mockReturnValue(false);
  });

  it("captures and rechecks delete content through the bounded raw reader", async () => {
    const workspace = createWorkspace({ validate: source });
    const adapter = new VsCodeProposeFileDeleteRenameWorkspace(
      root,
      workspace.scope,
      (_root, path) => (path === "source.txt" ? source : target),
    );

    const snapshot = await adapter.captureFileDeleteTarget({ path: "source.txt" }, signal);
    expect(snapshot).toEqual({
      path: "source.txt",
      uri: source.toString(),
      beforeContent: "zebra\ntext",
      beforeHash: expect.any(String),
    });
    expect(boundedRead.readSupportedWorkspaceText).toHaveBeenCalledWith(source, signal);

    vscode.Uri.parse.mockReturnValue(source);
    await expect(adapter.isFileDeleteTargetCurrent(snapshot, signal)).resolves.toBe(true);
    expect(boundedRead.readSupportedWorkspaceText).toHaveBeenCalledTimes(2);
  });

  it("maps unsupported or missing delete text to the stable missing error", async () => {
    boundedRead.readSupportedWorkspaceText.mockRejectedValue(
      new boundedRead.UnsupportedWorkspaceTextError(),
    );
    const workspace = createWorkspace({ validate: source });
    const adapter = new VsCodeProposeFileDeleteRenameWorkspace(root, workspace.scope, () => source);

    await expect(
      adapter.captureFileDeleteTarget({ path: "source.txt" }, signal),
    ).rejects.toBeInstanceOf(FileDeleteTargetNotFoundError);
  });

  it("captures and rechecks rename source content through the bounded raw reader", async () => {
    const targetMissing = new Error("target missing");
    vscode.workspace.fs.stat.mockImplementation(async (value: { readonly path: string }) => {
      if (value.path === target.path) throw targetMissing;
      return { type: vscode.FileType.Directory };
    });
    fileSystemErrors.isVscodeFileNotFound.mockImplementation(
      (error: unknown) => error === targetMissing,
    );
    const workspace = createWorkspace({ validate: source, validateNewFile: target });
    const adapter = new VsCodeProposeFileDeleteRenameWorkspace(
      root,
      workspace.scope,
      (_root, path) => (path === "source.txt" ? source : target),
    );

    const snapshot = await adapter.captureFileRenameTarget(
      { sourcePath: "source.txt", targetPath: "target.txt" },
      signal,
    );
    expect(snapshot).toEqual({
      sourcePath: "source.txt",
      targetPath: "target.txt",
      sourceUri: source.toString(),
      targetUri: target.toString(),
      beforeContent: "zebra\ntext",
      beforeHash: expect.any(String),
    });

    vscode.Uri.parse.mockImplementation((value: string) =>
      value === source.toString() ? source : target,
    );
    await expect(adapter.isFileRenameTargetCurrent(snapshot, signal)).resolves.toBe(true);
    expect(boundedRead.readSupportedWorkspaceText).toHaveBeenCalledTimes(2);
  });

  it("maps unsupported or missing rename source text to the stable source-missing error", async () => {
    boundedRead.readSupportedWorkspaceText.mockRejectedValue(
      new boundedRead.UnsupportedWorkspaceTextError(),
    );
    vscode.workspace.fs.stat.mockResolvedValue({ type: vscode.FileType.Directory });
    const workspace = createWorkspace({ validate: source, validateNewFile: target });
    const adapter = new VsCodeProposeFileDeleteRenameWorkspace(
      root,
      workspace.scope,
      (_root, path) => (path === "source.txt" ? source : target),
    );

    await expect(
      adapter.captureFileRenameTarget(
        { sourcePath: "source.txt", targetPath: "target.txt" },
        signal,
      ),
    ).rejects.toBeInstanceOf(FileRenameSourceNotFoundError);
  });
});

function createWorkspace(options: { readonly validate: Uri; readonly validateNewFile?: Uri }): {
  readonly scope: Pick<WorkspaceScope, "validate" | "validateNewFile">;
} {
  return {
    scope: {
      validate: async () => options.validate,
      validateNewFile: async () => options.validateNewFile ?? options.validate,
    },
  };
}

function uri(value: string, path: string): Uri {
  return {
    scheme: "file",
    path,
    toString: () => value,
    with: (change) => {
      const nextPath = change.path ?? path;
      return uri(value.replace(path, nextPath), nextPath);
    },
  } as Uri;
}
