import { describe, expect, it, vi } from "vitest";
import type { Uri } from "vscode";

import {
  type JoinWorkspacePath,
  type ReadWorkspaceFilePrefix,
  WorkspaceFileReader,
} from "./workspace-file-reader.js";

describe("WorkspaceFileReader", () => {
  it("joins under the selected root, validates Scope, and reads only the canonical target", async () => {
    const root = uri("/workspace/root");
    const requested = uri("/workspace/root/src/file.txt");
    const canonical = uri("/canonical/root/src/file.txt");
    const joinPath = vi.fn<JoinWorkspacePath>(() => requested);
    const validate = vi.fn(async () => canonical);
    const readPrefix = vi.fn<ReadWorkspaceFilePrefix>(async () => ({
      bytes: new Uint8Array([0x61]),
      truncated: false,
    }));
    const reader = new WorkspaceFileReader(root, { validate }, joinPath, readPrefix);
    const signal = new AbortController().signal;

    await expect(reader.readFile({ path: "src/file.txt", maxBytes: 64 }, signal)).resolves.toEqual({
      bytes: new Uint8Array([0x61]),
      truncated: false,
    });
    expect(joinPath).toHaveBeenCalledWith(root, "src/file.txt");
    expect(validate).toHaveBeenCalledWith(requested, signal);
    expect(readPrefix).toHaveBeenCalledWith(canonical, 64, signal);
  });

  it("does not join or read after cancellation", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel workspace read");
    controller.abort(cancellation);
    const joinPath = vi.fn<JoinWorkspacePath>((root) => root);
    const readPrefix = vi.fn<ReadWorkspaceFilePrefix>(async () => ({
      bytes: new Uint8Array(),
      truncated: false,
    }));
    const reader = new WorkspaceFileReader(
      uri("/workspace/root"),
      { validate: vi.fn(async (target: Uri) => target) },
      joinPath,
      readPrefix,
    );

    await expect(
      reader.readFile({ path: "file.txt", maxBytes: 64 }, controller.signal),
    ).rejects.toBe(cancellation);
    expect(joinPath).not.toHaveBeenCalled();
    expect(readPrefix).not.toHaveBeenCalled();
  });
});

class TestUri implements Uri {
  readonly scheme = "file";
  readonly authority = "";
  readonly query = "";
  readonly fragment = "";

  constructor(readonly path: string) {}

  get fsPath(): string {
    return this.path;
  }

  with(change: { path?: string }): Uri {
    return new TestUri(change.path ?? this.path);
  }

  toString(): string {
    return `file://${this.path}`;
  }

  toJSON() {
    return {
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    };
  }
}

function uri(path: string): Uri {
  return new TestUri(path);
}
