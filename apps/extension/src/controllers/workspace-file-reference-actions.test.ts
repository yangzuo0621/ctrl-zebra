import type { ExtensionToWebviewMessage } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";
import type { Uri } from "vscode";
import type { WorkspaceFindFiles } from "../adapters/workspace-file-lister.js";
import type { ReadWorkspaceFilePrefix } from "../adapters/workspace-file-reader.js";
import { WorkspaceScopeError } from "../adapters/workspace-scope.js";
import { createTestUri as uri } from "../test/support/test-uri.js";
import { WorkspaceFileReferenceActions } from "./workspace-file-reference-actions.js";

describe("WorkspaceFileReferenceActions", () => {
  it("searches bounded workspace-relative paths in deterministic order", async () => {
    const root = uri("/workspace/root");
    const posts: ExtensionToWebviewMessage[] = [];
    const actions = createActions({
      root,
      findFiles: async () => [uri("/workspace/root/z.ts"), uri("/workspace/root/src/a.ts")],
    });
    actions.bind((message) => posts.push(message));

    actions.search("search-1", "a");
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      type: "extension/workspace-file-search",
      requestId: "search-1",
      status: "ready",
      results: [{ path: "src/a.ts" }],
    });
  });

  it("reads UTF-8 text, rejects binary content, and reuses duplicate references", async () => {
    const root = uri("/workspace/root");
    const posts: ExtensionToWebviewMessage[] = [];
    const actions = createActions({ root });
    actions.bind((message) => posts.push(message));

    actions.read("read-1", "src/a.ts");
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    const first = posts[0];
    expect(first).toMatchObject({
      type: "extension/workspace-file-reference",
      requestId: "read-1",
      status: "ready",
      reference: { context: { source: { uri: { path: "src/a.ts" } }, text: "hello" } },
    });
    const referenceId = (
      first as Extract<
        ExtensionToWebviewMessage,
        { type: "extension/workspace-file-reference"; status: "ready" }
      >
    ).reference.referenceId;

    actions.read("read-2", "src/a.ts");
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toMatchObject({ status: "ready", reference: { referenceId } });

    actions.read("read-binary", "binary.dat");
    await vi.waitFor(() => expect(posts).toHaveLength(3));
    expect(posts[2]).toMatchObject({ status: "error", code: "binary" });
  });

  it("marks a snapshot stale on mutation races and filters it until Use stale", async () => {
    const root = uri("/workspace/root");
    const posts: ExtensionToWebviewMessage[] = [];
    let fingerprintCall = 0;
    const actions = createActions({
      root,
      getFileFingerprint: async () => {
        fingerprintCall += 1;
        return fingerprintCall === 1 ? "before" : "after";
      },
    });
    actions.bind((message) => posts.push(message));

    actions.read("race", "src/a.ts");
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ status: "stale", reason: "changed-during-read" });
    const stale = posts[0] as Extract<
      ExtensionToWebviewMessage,
      { type: "extension/workspace-file-reference"; status: "stale" }
    >;
    actions.useStale("accept", stale.reference.referenceId);
    expect(actions.takeReferences()).toEqual([stale.reference]);
  });

  it("rejects out-of-scope targets and preserves bounded truncation metadata", async () => {
    const root = uri("/workspace/root");
    const posts: ExtensionToWebviewMessage[] = [];
    const actions = createActions({
      root,
      validate: async (target) => {
        if (target.path.endsWith("secret.txt")) {
          throw new WorkspaceScopeError("outside-workspace");
        }
        return target;
      },
      readPrefix: async () => ({
        bytes: new TextEncoder().encode("x".repeat(270_000)),
        truncated: true,
      }),
    });
    actions.bind((message) => posts.push(message));

    actions.read("outside", "secret.txt");
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ status: "error", code: "outside-workspace" });

    actions.read("large", "large.txt");
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toMatchObject({
      status: "ready",
      reference: {
        context: {
          source: { truncated: true, truncationReasons: ["code-points", "utf8-bytes"] },
        },
      },
    });
  });

  it("rejects a symlink-resolved target outside the canonical workspace root", async () => {
    const root = uri("/workspace/root");
    const posts: ExtensionToWebviewMessage[] = [];
    const actions = createActions({
      root,
      validate: async (target) => {
        if (target.path.endsWith("link/secret.txt")) {
          throw new WorkspaceScopeError("outside-workspace");
        }
        return target;
      },
    });
    actions.bind((message) => posts.push(message));

    actions.read("symlink", "link/secret.txt");
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ status: "error", code: "outside-workspace" });
  });

  it("marks a retained reference stale when the Host reports deletion", async () => {
    const root = uri("/workspace/root");
    const posts: ExtensionToWebviewMessage[] = [];
    const actions = createActions({ root });
    actions.bind((message) => posts.push(message));

    actions.read("read", "src/a.ts");
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    actions.notifyChanged(uri("/workspace/root/src/a.ts"), "deleted");
    expect(posts.at(-1)).toMatchObject({ status: "stale", reason: "deleted" });
  });
});

interface CreateActionsOptions {
  readonly root: Uri;
  readonly validate?: (target: Uri, signal: AbortSignal) => Promise<Uri>;
  readonly findFiles?: WorkspaceFindFiles;
  readonly readPrefix?: ReadWorkspaceFilePrefix;
  readonly getFileFingerprint?: (uri: Uri) => Promise<string>;
}

function createActions({
  root,
  validate = async (target) => target,
  findFiles = async () => [uri("/workspace/root/src/a.ts"), uri("/workspace/root/binary.dat")],
  readPrefix = async (target) => ({
    bytes: target.path.endsWith("binary.dat")
      ? new Uint8Array([0, 1, 2])
      : new TextEncoder().encode("hello"),
    truncated: false,
  }),
  getFileFingerprint = async () => "same",
}: CreateActionsOptions): WorkspaceFileReferenceActions {
  return new WorkspaceFileReferenceActions({
    getSelectedRoot: () => root,
    createScope: () => ({ validate }),
    joinPath: (selectedRoot, path) => selectedRoot.with({ path: `${selectedRoot.path}/${path}` }),
    findFiles,
    readPrefix,
    getFileFingerprint,
    createId: (() => {
      let index = 0;
      return () => `ref-${++index}`;
    })(),
  });
}
