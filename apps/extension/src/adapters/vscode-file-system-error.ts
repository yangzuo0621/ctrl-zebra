import { FileSystemError } from "vscode";

export function isVscodeFileNotFound(error: unknown): boolean {
  return error instanceof FileSystemError && error.code === "FileNotFound";
}
