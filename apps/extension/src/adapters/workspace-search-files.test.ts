import type { ListFilesWorkspace, ReadFileWorkspace } from "@ctrl-zebra/builtin-tools";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceSearchFiles } from "./workspace-search-files.js";

describe("WorkspaceSearchFiles", () => {
  it("delegates listing and bounded reads to the selected workspace adapters", async () => {
    const findFiles = vi.fn<ListFilesWorkspace["findFiles"]>(async () => ["src/file.ts"]);
    const readFile = vi.fn<ReadFileWorkspace["readFile"]>(async () => ({
      bytes: new Uint8Array([0x61]),
      truncated: false,
    }));
    const workspace = new WorkspaceSearchFiles({ findFiles }, { readFile });
    const signal = new AbortController().signal;
    const listRequest = { glob: "**/*.ts", excludeGlob: "**/.git/**", maxResults: 10 };
    const readRequest = { path: "src/file.ts", maxBytes: 1024 };

    await expect(workspace.findFiles(listRequest, signal)).resolves.toEqual(["src/file.ts"]);
    await expect(workspace.readFile(readRequest, signal)).resolves.toEqual({
      bytes: new Uint8Array([0x61]),
      truncated: false,
    });
    expect(findFiles).toHaveBeenCalledWith(listRequest, signal);
    expect(readFile).toHaveBeenCalledWith(readRequest, signal);
  });
});
