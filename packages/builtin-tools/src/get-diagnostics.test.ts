import { ToolExecutionError } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import {
  createGetDiagnosticsTool,
  DiagnosticsUnavailableError,
  getDiagnosticsToolName,
  type IdeDiagnosticsPort,
  parseGetDiagnosticsInput,
} from "./index.js";

const source = {
  uri: { scheme: "file", authority: "", path: "src/index.ts" },
  stale: false,
  truncated: false,
} as const;
const result = {
  kind: "diagnostics",
  source,
  diagnostics: [
    {
      source: {
        ...source,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
      severity: "warning",
      message: "Unused value",
    },
  ],
  stale: false,
  truncated: false,
} as const;

describe(getDiagnosticsToolName, () => {
  it("parses the three legal scope/path combinations", () => {
    expect(parseGetDiagnosticsInput({ scope: "active-file" })).toEqual({ scope: "active-file" });
    expect(parseGetDiagnosticsInput({ scope: "workspace" })).toEqual({ scope: "workspace" });
    expect(parseGetDiagnosticsInput({ scope: "workspace", path: "src/index.ts" })).toEqual({
      scope: "workspace",
      path: "src/index.ts",
    });
  });

  it.each([
    null,
    {},
    { scope: "active-file", path: "src/index.ts" },
    { scope: "workspace", path: "" },
    { scope: "workspace", path: "../secret.ts" },
    { scope: "workspace", path: "src\\index.ts" },
    { scope: "unknown" },
    { scope: "workspace", extra: true },
  ])("rejects malformed scope/path input %#", (value) => {
    expect(() => parseGetDiagnosticsInput(value)).toThrow(TypeError);
  });

  it("projects a strict read-only diagnostic result and preserves truncation", async () => {
    const port = createPort(result);
    const tool = createGetDiagnosticsTool(port);

    expect({ name: tool.name, risk: tool.risk }).toEqual({
      name: "get_diagnostics",
      risk: "read",
    });
    await expect(
      tool.execute({ scope: "active-file" }, { signal: new AbortController().signal }),
    ).resolves.toEqual({ output: result, truncated: false });
    expect(port.getDiagnostics).toHaveBeenCalledWith(
      { scope: "active-file" },
      expect.any(AbortSignal),
    );

    const truncated = {
      ...result,
      truncated: true,
      truncationReasons: ["entries"],
    } as const;
    await expect(
      createGetDiagnosticsTool(createPort(truncated)).execute(
        { scope: "workspace" },
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({ truncated: true });
  });

  it("maps unavailable and malformed host results to stable Tool errors", async () => {
    await expect(
      createGetDiagnosticsTool({
        getDiagnostics: vi.fn(async () => {
          throw new DiagnosticsUnavailableError();
        }),
      }).execute({ scope: "workspace" }, { signal: new AbortController().signal }),
    ).rejects.toEqual(new ToolExecutionError("failed", "Diagnostics are unavailable."));

    await expect(
      createGetDiagnosticsTool(createPort({ ...result, diagnostics: [{ bad: true }] })).execute(
        { scope: "workspace" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toEqual(
      new ToolExecutionError("invalid-output", "Diagnostics returned invalid output."),
    );
  });

  it("does not invoke the host after cancellation", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel diagnostics");
    controller.abort(cancellation);
    const port = createPort(result);

    await expect(
      createGetDiagnosticsTool(port).execute(
        { scope: "active-file" },
        { signal: controller.signal },
      ),
    ).rejects.toBe(cancellation);
    expect(port.getDiagnostics).not.toHaveBeenCalled();
  });
});

function createPort(
  value: unknown,
): IdeDiagnosticsPort & { getDiagnostics: ReturnType<typeof vi.fn> } {
  return { getDiagnostics: vi.fn(async () => value) };
}
