import { ToolExecutionError } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import {
  createReadEditorContextTool,
  EditorContextUnavailableError,
  type IdeContextPort,
  readEditorContextToolName,
} from "./index.js";

const context = {
  source: {
    uri: { scheme: "file", authority: "", path: "src/index.ts" },
    languageId: "typescript",
    documentVersion: 1,
    stale: false,
    truncated: false,
  },
  text: "const answer = 42;",
} as const;

describe(readEditorContextToolName, () => {
  it("publishes a strict read-only declaration and projects the editor result", async () => {
    const port = createPort(context);
    const tool = createReadEditorContextTool(port);

    expect({ name: tool.name, description: tool.description, risk: tool.risk }).toEqual({
      name: "read_editor_context",
      description:
        "Read the explicitly selected active editor or text selection in the selected workspace.",
      risk: "read",
    });
    expect(tool.parseInput({ scope: "selection" })).toEqual({ scope: "selection" });
    await expect(
      tool.execute({ scope: "selection" }, { signal: new AbortController().signal }),
    ).resolves.toEqual({
      output: { kind: "editor-context", context },
      truncated: false,
    });
    expect(port.readEditorContext).toHaveBeenCalledWith(
      { scope: "selection" },
      expect.any(AbortSignal),
    );
  });

  it("preserves a host truncation marker", async () => {
    const tool = createReadEditorContextTool(
      createPort({
        ...context,
        source: {
          ...context.source,
          truncated: true,
          truncationReasons: ["code-points"],
        },
      }),
    );

    await expect(
      tool.execute(tool.parseInput({ scope: "active-editor" }), {
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ truncated: true });
  });

  it.each([
    null,
    {},
    { scope: "selection", extra: true },
    { scope: "file" },
  ])("rejects malformed input %#", (value) => {
    expect(() => createReadEditorContextTool(createPort(context)).parseInput(value)).toThrow(
      TypeError,
    );
  });

  it("maps a closed host outcome to a stable failed Tool error", async () => {
    const tool = createReadEditorContextTool({
      readEditorContext: vi.fn(async () => {
        throw new EditorContextUnavailableError();
      }),
    });

    await expect(
      tool.execute({ scope: "active-editor" }, { signal: new AbortController().signal }),
    ).rejects.toEqual(new ToolExecutionError("failed", "Editor context is unavailable."));
  });

  it("rejects invalid host DTOs without leaking them to Core", async () => {
    const tool = createReadEditorContextTool(
      createPort({ ...context, source: { ...context.source, stale: undefined } }),
    );

    await expect(
      tool.execute({ scope: "active-editor" }, { signal: new AbortController().signal }),
    ).rejects.toEqual(
      new ToolExecutionError("invalid-output", "Editor context returned invalid output."),
    );
  });

  it("does not call the host after cancellation", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel editor context");
    controller.abort(cancellation);
    const port = createPort(context);
    const tool = createReadEditorContextTool(port);

    await expect(tool.execute({ scope: "selection" }, { signal: controller.signal })).rejects.toBe(
      cancellation,
    );
    expect(port.readEditorContext).not.toHaveBeenCalled();
  });
});

function createPort(
  value: unknown,
): IdeContextPort & { readEditorContext: ReturnType<typeof vi.fn> } {
  return {
    readEditorContext: vi.fn(async () => value),
  };
}
