import { describe, expect, it, vi } from "vitest";
import type { Uri } from "vscode";

import {
  type CanonicalizeWorkspaceUri,
  WorkspaceScope,
  WorkspaceScopeError,
} from "./workspace-scope.js";

const signal = new AbortController().signal;

describe("WorkspaceScope", () => {
  it("accepts the selected root and descendants using canonical URIs", async () => {
    const root = uri({ path: "/workspace/root" });
    const descendant = uri({ path: "/workspace/root/src/index.ts" });
    const canonicalize = identityCanonicalizer();
    const scope = new WorkspaceScope(root, canonicalize, { caseSensitivePaths: true });

    await expect(scope.validate(root, signal)).resolves.toBe(root);
    await expect(scope.validate(descendant, signal)).resolves.toBe(descendant);
    expect(canonicalize).toHaveBeenCalledTimes(4);
  });

  it.each([
    "/workspace/root/../outside.txt",
    "/workspace/root/src/./index.ts",
    "/workspace/root/src\\index.ts",
    "/workspace/root/%2e%2e/outside.txt",
    "/workspace/root//index.ts",
  ])("rejects ambiguous or escaping path %s before canonicalization", async (path) => {
    const canonicalize = identityCanonicalizer();
    const scope = new WorkspaceScope(uri({ path: "/workspace/root" }), canonicalize);

    await expect(scope.validate(uri({ path }), signal)).rejects.toEqual(
      new WorkspaceScopeError("invalid-uri"),
    );
    expect(canonicalize).not.toHaveBeenCalled();
  });

  it.each([
    uri({ path: "/workspace/root-other/file.txt" }),
    uri({ path: "/workspace/another-root/file.txt" }),
    uri({
      scheme: "vscode-remote",
      authority: "ssh-remote+host",
      path: "/workspace/root/file.txt",
    }),
    uri({ authority: "other-server", path: "/workspace/root/file.txt" }),
  ])("rejects an outside or unselected workspace URI", async (target) => {
    const canonicalize = identityCanonicalizer();
    const scope = new WorkspaceScope(uri({ path: "/workspace/root" }), canonicalize);

    await expect(scope.validate(target, signal)).rejects.toEqual(
      new WorkspaceScopeError("outside-workspace"),
    );
    expect(canonicalize).not.toHaveBeenCalled();
  });

  it("compares Windows drive paths case-insensitively without crossing drives", async () => {
    const scope = new WorkspaceScope(
      uri({ path: "/C:/Users/Owner/Repo" }),
      identityCanonicalizer(),
      { caseSensitivePaths: false },
    );

    await expect(
      scope.validate(uri({ path: "/c:/users/owner/repo/SRC/index.ts" }), signal),
    ).resolves.toEqual(uri({ path: "/c:/users/owner/repo/SRC/index.ts" }));
    await expect(
      scope.validate(uri({ path: "/D:/Users/Owner/Repo/index.ts" }), signal),
    ).rejects.toEqual(new WorkspaceScopeError("outside-workspace"));
  });

  it("requires the selected UNC server and share", async () => {
    const root = uri({ authority: "server", path: "/share/repo" });
    const scope = new WorkspaceScope(root, identityCanonicalizer(), { caseSensitivePaths: false });

    await expect(
      scope.validate(uri({ authority: "SERVER", path: "/SHARE/REPO/file.txt" }), signal),
    ).resolves.toEqual(uri({ authority: "SERVER", path: "/SHARE/REPO/file.txt" }));
    await expect(
      scope.validate(uri({ authority: "server", path: "/other/repo/file.txt" }), signal),
    ).rejects.toEqual(new WorkspaceScopeError("outside-workspace"));
    await expect(
      scope.validate(uri({ authority: "other", path: "/share/repo/file.txt" }), signal),
    ).rejects.toEqual(new WorkspaceScopeError("outside-workspace"));
  });

  it("rejects a lexical descendant whose canonical target escapes through a symbolic link", async () => {
    const root = uri({ path: "/workspace/root" });
    const target = uri({ path: "/workspace/root/link/secret.txt" });
    const canonicalize = vi.fn<CanonicalizeWorkspaceUri>(async (value) =>
      value === target ? uri({ path: "/outside/secret.txt" }) : value,
    );
    const scope = new WorkspaceScope(root, canonicalize);

    await expect(scope.validate(target, signal)).rejects.toEqual(
      new WorkspaceScopeError("outside-workspace"),
    );
  });

  it("maps canonicalization failures to a safe stable error", async () => {
    const scope = new WorkspaceScope(uri({ path: "/workspace/root" }), async () => {
      throw new Error("private host path");
    });

    await expect(scope.validate(uri({ path: "/workspace/root/file.txt" }), signal)).rejects.toEqual(
      new WorkspaceScopeError("canonicalization-failed"),
    );
  });

  it("does not canonicalize when already cancelled", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel scope validation");
    controller.abort(cancellation);
    const canonicalize = identityCanonicalizer();
    const scope = new WorkspaceScope(uri({ path: "/workspace/root" }), canonicalize);

    await expect(
      scope.validate(uri({ path: "/workspace/root/file.txt" }), controller.signal),
    ).rejects.toBe(cancellation);
    expect(canonicalize).not.toHaveBeenCalled();
  });
});

function identityCanonicalizer() {
  return vi.fn<CanonicalizeWorkspaceUri>(async (value) => value);
}

interface UriParts {
  readonly scheme?: string;
  readonly authority?: string;
  readonly path?: string;
  readonly query?: string;
  readonly fragment?: string;
}

class TestUri implements Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  constructor(parts: UriParts) {
    this.scheme = parts.scheme ?? "file";
    this.authority = parts.authority ?? "";
    this.path = parts.path ?? "/";
    this.query = parts.query ?? "";
    this.fragment = parts.fragment ?? "";
  }

  get fsPath(): string {
    return this.path;
  }

  with(change: UriParts): Uri {
    return new TestUri({
      scheme: change.scheme ?? this.scheme,
      authority: change.authority ?? this.authority,
      path: change.path ?? this.path,
      query: change.query ?? this.query,
      fragment: change.fragment ?? this.fragment,
    });
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }

  toJSON(): UriParts {
    return {
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    };
  }
}

function uri(parts: UriParts): Uri {
  return new TestUri(parts);
}
