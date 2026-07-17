import { describe, expect, it, vi } from "vitest";
import type { Uri } from "vscode";
import { WorkspaceFileLister, type WorkspaceFindFiles } from "./workspace-file-lister.js";
import { WorkspaceScopeError } from "./workspace-scope.js";

describe("WorkspaceFileLister", () => {
  it("binds search to the selected root and returns only validated relative paths", async () => {
    const selectedRoot = uri("/workspace/selected");
    const unselectedRoot = uri("/workspace/other");
    const targets = [uri("/workspace/selected/src/a.ts"), uri("/workspace/selected/README.md")];
    const validate = vi.fn(async (target: Uri) => target);
    const findFiles = vi.fn<WorkspaceFindFiles>(async ({ baseUri }) => {
      expect(baseUri).toBe(selectedRoot);
      expect(baseUri).not.toBe(unselectedRoot);
      return targets;
    });
    const lister = new WorkspaceFileLister(selectedRoot, { validate }, findFiles);
    const signal = new AbortController().signal;

    await expect(
      lister.findFiles(
        { glob: "**/*.ts", excludeGlob: "**/node_modules/**", maxResults: 11 },
        signal,
      ),
    ).resolves.toEqual(["src/a.ts", "README.md"]);
    expect(findFiles).toHaveBeenCalledWith(
      {
        baseUri: selectedRoot,
        glob: "**/*.ts",
        excludeGlob: "**/node_modules/**",
        maxResults: 11,
      },
      signal,
    );
    expect(validate.mock.calls.map(([target]) => target)).toEqual(targets);
  });

  it("rejects the listing when Scope rejects any returned URI", async () => {
    const selectedRoot = uri("/workspace/selected");
    const outside = uri("/workspace/other/secret.ts");
    const validate = vi.fn(async () => {
      throw new WorkspaceScopeError("outside-workspace");
    });
    const lister = new WorkspaceFileLister(
      selectedRoot,
      { validate },
      vi.fn<WorkspaceFindFiles>(async () => [outside]),
    );

    await expect(
      lister.findFiles(
        { glob: "**/*", excludeGlob: "**/.git/**", maxResults: 101 },
        new AbortController().signal,
      ),
    ).rejects.toEqual(new WorkspaceScopeError("outside-workspace"));
  });

  it("does not start search when already cancelled", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel file listing");
    controller.abort(cancellation);
    const findFiles = vi.fn<WorkspaceFindFiles>(async () => []);
    const lister = new WorkspaceFileLister(
      uri("/workspace/selected"),
      { validate: vi.fn(async (target: Uri) => target) },
      findFiles,
    );

    await expect(
      lister.findFiles(
        { glob: "**/*", excludeGlob: "**/.git/**", maxResults: 101 },
        controller.signal,
      ),
    ).rejects.toBe(cancellation);
    expect(findFiles).not.toHaveBeenCalled();
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

  with(change: {
    scheme?: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
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
