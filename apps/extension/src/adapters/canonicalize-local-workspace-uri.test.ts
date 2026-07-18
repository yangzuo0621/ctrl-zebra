import { describe, expect, it, vi } from "vitest";
import type { Uri } from "vscode";

import { createLocalWorkspaceUriCanonicalizer } from "./canonicalize-local-workspace-uri.js";

describe("createLocalWorkspaceUriCanonicalizer", () => {
  it("resolves a local URI through the host-owned realpath operation", async () => {
    const canonical = uri("C:/workspace/real/file.txt");
    const resolveRealPath = vi.fn(async () => "C:\\workspace\\real\\file.txt");
    const createFileUri = vi.fn(() => canonical);
    const canonicalize = createLocalWorkspaceUriCanonicalizer(resolveRealPath, createFileUri);

    await expect(
      canonicalize(uri("C:/workspace/link/file.txt"), new AbortController().signal),
    ).resolves.toBe(canonical);
    expect(resolveRealPath).toHaveBeenCalledWith("C:/workspace/link/file.txt");
    expect(createFileUri).toHaveBeenCalledWith("C:\\workspace\\real\\file.txt");
  });

  it("rejects non-local URIs before resolving a path", async () => {
    const resolveRealPath = vi.fn(async (path: string) => path);
    const canonicalize = createLocalWorkspaceUriCanonicalizer(resolveRealPath, () =>
      uri("/unused"),
    );

    await expect(
      canonicalize(uri("/workspace/file.txt", "vscode-remote"), new AbortController().signal),
    ).rejects.toThrow("Canonical workspace access requires a local file URI.");
    expect(resolveRealPath).not.toHaveBeenCalled();
  });

  it("discards a resolved path after cancellation", async () => {
    let resolvePending: ((value: string) => void) | undefined;
    const pending = new Promise<string>((resolve) => {
      resolvePending = resolve;
    });
    const createFileUri = vi.fn(() => uri("/canonical"));
    const canonicalize = createLocalWorkspaceUriCanonicalizer(() => pending, createFileUri);
    const controller = new AbortController();
    const cancellation = new Error("cancel canonicalization");
    const result = canonicalize(uri("/workspace/file.txt"), controller.signal);

    controller.abort(cancellation);
    resolvePending?.("/canonical");

    await expect(result).rejects.toBe(cancellation);
    expect(createFileUri).not.toHaveBeenCalled();
  });
});

function uri(path: string, scheme = "file"): Uri {
  return {
    scheme,
    authority: "",
    path,
    query: "",
    fragment: "",
    fsPath: path,
    with: () => uri(path, scheme),
    toString: () => `${scheme}://${path}`,
    toJSON: () => ({ scheme, path }),
  };
}
