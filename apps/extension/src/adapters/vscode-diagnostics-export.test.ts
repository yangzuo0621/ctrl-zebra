import { describe, expect, it, vi } from "vitest";
import type { FileSystem, SaveDialogOptions, Uri } from "vscode";

import {
  createVscodeDiagnosticsExportPort,
  formatDiagnosticsExportTarget,
} from "./vscode-diagnostics-export.js";

describe("VS Code diagnostics export port", () => {
  it("preserves selected URI display across Windows and POSIX-style targets", async () => {
    const showSaveDialog = vi.fn<(options: SaveDialogOptions) => Thenable<Uri>>();
    const writeFile = vi.fn<FileSystem["writeFile"]>();
    const port = createVscodeDiagnosticsExportPort(showSaveDialog, { writeFile });
    const windowsTarget = createUri("file:///C:/Users/user/diagnostics.json");
    const posixTarget = createUri("file:///home/user/diagnostics.json");

    expect(formatDiagnosticsExportTarget(windowsTarget)).toBe(
      "file:///C:/Users/user/diagnostics.json",
    );
    expect(formatDiagnosticsExportTarget(posixTarget)).toBe("file:///home/user/diagnostics.json");

    const bytes = new Uint8Array([123, 125]);
    await port.writeFile(windowsTarget, bytes);
    expect(writeFile).toHaveBeenCalledWith(windowsTarget, bytes);

    await port.chooseTarget();
    expect(showSaveDialog).toHaveBeenCalledWith({
      saveLabel: "Export diagnostics",
      filters: { JSON: ["json"] },
    });
  });

  it("bounds and sanitizes malformed host URI labels", () => {
    expect(formatDiagnosticsExportTarget(createUri("\u0000private-secret"))).toBe("Selected file");
    expect(
      formatDiagnosticsExportTarget({ toString: () => "x".repeat(2_000) } as Uri),
    ).toHaveLength(1_024);
    expect(
      formatDiagnosticsExportTarget({
        toString() {
          throw new Error("invalid URI");
        },
      } as unknown as Uri),
    ).toBe("Selected file");
  });
});

function createUri(value: string): Uri {
  return { toString: () => value } as Uri;
}
