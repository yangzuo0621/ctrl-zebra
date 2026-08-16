import type { FileSystem, SaveDialogOptions, Uri } from "vscode";

export interface VscodeDiagnosticsExportPort {
  chooseTarget(): Thenable<Uri | undefined>;
  formatTarget(uri: Uri): string;
  writeFile(uri: Uri, bytes: Uint8Array): Thenable<void>;
}

const diagnosticsSaveDialogOptions: SaveDialogOptions = {
  saveLabel: "Export diagnostics",
  filters: { JSON: ["json"] },
};

export function createVscodeDiagnosticsExportPort(
  showSaveDialog: (options: SaveDialogOptions) => Thenable<Uri | undefined>,
  fileSystem: Pick<FileSystem, "writeFile">,
): VscodeDiagnosticsExportPort {
  return {
    chooseTarget: () => showSaveDialog(diagnosticsSaveDialogOptions),
    formatTarget: formatDiagnosticsExportTarget,
    writeFile: (uri, bytes) => fileSystem.writeFile(uri, bytes),
  };
}

/** A selected target is shown only in the pre-export UI; it is never copied to the document. */
export function formatDiagnosticsExportTarget(uri: Uri): string {
  try {
    const value = uri.toString(true);
    if (value.length > 0 && !/[\0\r\n\u2028\u2029]/u.test(value)) {
      return value.slice(0, 1_024);
    }
  } catch {
    // A malformed host URI cannot be exposed to the Webview.
  }
  return "Selected file";
}
