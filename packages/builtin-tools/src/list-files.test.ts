import { describe, expect, it, vi } from "vitest";

import {
  createListFilesTool,
  defaultListFilesLimit,
  InvalidWorkspaceFileListError,
  type ListFilesWorkspace,
  listFilesExcludeGlob,
  maxListFilesLimit,
} from "./index.js";

describe("list_files", () => {
  it("uses the default Glob, fixed exclusions, and bounded host request", async () => {
    const workspace = createWorkspace(["src/z.ts", "README.md", "src/a.ts"]);
    const tool = createListFilesTool(workspace);
    const input = tool.parseInput({});

    await expect(tool.execute(input, { signal: new AbortController().signal })).resolves.toEqual({
      output: { files: ["README.md", "src/a.ts", "src/z.ts"] },
      truncated: false,
    });
    expect(workspace.findFiles).toHaveBeenCalledWith(
      {
        glob: "**/*",
        excludeGlob: listFilesExcludeGlob,
        maxResults: defaultListFilesLimit + 1,
      },
      expect.any(AbortSignal),
    );
  });

  it("passes a custom Glob and marks results truncated at the requested maximum", async () => {
    const workspace = createWorkspace(["src/c.ts", "src/a.ts", "src/b.ts"]);
    const tool = createListFilesTool(workspace);
    const input = tool.parseInput({ glob: "src/**/*.ts", maxResults: 2 });

    await expect(tool.execute(input, { signal: new AbortController().signal })).resolves.toEqual({
      output: { files: ["src/a.ts", "src/b.ts"] },
      truncated: true,
    });
    expect(workspace.findFiles).toHaveBeenCalledWith(
      {
        glob: "src/**/*.ts",
        excludeGlob: listFilesExcludeGlob,
        maxResults: 3,
      },
      expect.any(AbortSignal),
    );
  });

  it("uses only the explicitly bound workspace in a multi-root window", async () => {
    const selectedWorkspace = createWorkspace(["selected/file.ts"]);
    const unselectedWorkspace = createWorkspace(["other/secret.ts"]);
    const tool = createListFilesTool(selectedWorkspace);
    const input = tool.parseInput({});

    await expect(tool.execute(input, { signal: new AbortController().signal })).resolves.toEqual({
      output: { files: ["selected/file.ts"] },
      truncated: false,
    });
    expect(selectedWorkspace.findFiles).toHaveBeenCalledOnce();
    expect(unselectedWorkspace.findFiles).not.toHaveBeenCalled();
  });

  it.each([
    { glob: "" },
    { glob: "../**" },
    { glob: "src\\**" },
    { maxResults: 0 },
    { maxResults: maxListFilesLimit + 1 },
    { maxResults: 1.5 },
    { unexpected: true },
  ])("rejects invalid input %#", (value) => {
    const tool = createListFilesTool(createWorkspace([]));

    expect(() => tool.parseInput(value)).toThrow(TypeError);
  });

  it.each([
    null,
    ["/absolute/file.ts"],
    ["../outside.ts"],
    ["src\\file.ts"],
    [42],
  ])("rejects invalid host output %#", async (value) => {
    const workspace = createWorkspace(value);
    const tool = createListFilesTool(workspace);

    await expect(
      tool.execute(tool.parseInput({}), { signal: new AbortController().signal }),
    ).rejects.toEqual(new InvalidWorkspaceFileListError());
  });

  it("does not call the workspace after cancellation", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel listing");
    controller.abort(cancellation);
    const workspace = createWorkspace([]);
    const tool = createListFilesTool(workspace);

    await expect(tool.execute(tool.parseInput({}), { signal: controller.signal })).rejects.toBe(
      cancellation,
    );
    expect(workspace.findFiles).not.toHaveBeenCalled();
  });
});

function createWorkspace(value: unknown) {
  return {
    findFiles: vi.fn<ListFilesWorkspace["findFiles"]>(async () => value),
  } satisfies ListFilesWorkspace;
}
