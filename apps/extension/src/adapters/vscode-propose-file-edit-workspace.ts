import { createHash } from "node:crypto";
import type { FileEditRevisionSnapshot, ProposeFileEditWorkspace } from "@ctrl-zebra/builtin-tools";
import { isBoundedWorkspaceEditText, maxWorkspaceEditTextBytes } from "@ctrl-zebra/core";
import { FileType, type TextDocument, Uri, workspace } from "vscode";
import { readLocalFilePrefix } from "./read-local-file-prefix.js";
import type { JoinWorkspacePath } from "./workspace-file-reader.js";
import type { WorkspaceScope } from "./workspace-scope.js";

export class VsCodeProposeFileEditWorkspace implements ProposeFileEditWorkspace {
  readonly #root: Uri;
  readonly #scope: WorkspaceScope;
  readonly #joinPath: JoinWorkspacePath;
  readonly #requireSupportedText: boolean;

  constructor(
    root: Uri,
    scope: WorkspaceScope,
    joinPath: JoinWorkspacePath,
    options: VsCodeProposeFileEditWorkspaceOptions = {},
  ) {
    this.#root = root;
    this.#scope = scope;
    this.#joinPath = joinPath;
    this.#requireSupportedText = options.requireSupportedText ?? false;
  }

  async captureFileRevision(
    request: { readonly path: string },
    signal: AbortSignal,
  ): Promise<FileEditRevisionSnapshot> {
    signal.throwIfAborted();
    const target = this.#joinPath(this.#root, request.path);
    const canonical = await this.#scope.validate(target, signal);
    signal.throwIfAborted();
    let rawText: string | undefined;
    if (this.#requireSupportedText) {
      rawText = await readSupportedWorkspaceText(canonical, signal);
    }
    const document = await workspace.openTextDocument(canonical);
    signal.throwIfAborted();
    if (rawText !== undefined) {
      assertSupportedWorkspaceDocument(document, rawText);
    }
    return {
      uri: document.uri.toString(),
      revision: {
        kind: "content_hash",
        algorithm: "sha256",
        value: hashText(document.getText()),
      },
    };
  }

  async isFileRevisionCurrent(
    snapshot: FileEditRevisionSnapshot,
    signal: AbortSignal,
  ): Promise<boolean> {
    signal.throwIfAborted();
    const requested = Uri.parse(snapshot.uri, true);
    const canonical = await this.#scope.validate(requested, signal);
    signal.throwIfAborted();
    if (canonical.toString() !== snapshot.uri) {
      return false;
    }

    let rawText: string | undefined;
    if (this.#requireSupportedText) {
      rawText = await readSupportedWorkspaceText(canonical, signal);
    }
    const document = await workspace.openTextDocument(canonical);
    signal.throwIfAborted();
    if (rawText !== undefined) {
      assertSupportedWorkspaceDocument(document, rawText);
    }
    const revision = snapshot.revision;
    return revision.kind === "document_version"
      ? document.version === revision.value
      : hashText(document.getText()) === revision.value;
  }
}

export interface VsCodeProposeFileEditWorkspaceOptions {
  readonly requireSupportedText?: boolean;
}

export class UnsupportedWorkspaceTextError extends Error {
  constructor() {
    super("The workspace target is not a supported bounded UTF-8 text file.");
    this.name = "UnsupportedWorkspaceTextError";
  }
}

/**
 * Validates the raw workspace bytes and the opened document before a lifecycle edit can use it.
 * The raw read is bounded by the same byte ceiling as the in-memory text policy.
 */
export async function assertSupportedWorkspaceText(
  uri: Uri,
  document: Pick<TextDocument, "getText">,
  signal: AbortSignal,
): Promise<void> {
  const rawText = await readSupportedWorkspaceText(uri, signal);
  assertSupportedWorkspaceDocument(document, rawText);
}

export async function readSupportedWorkspaceText(uri: Uri, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (uri.scheme !== "file") {
    throw new UnsupportedWorkspaceTextError();
  }

  let stat: { readonly type: FileType; readonly size: number };
  let bytes: Uint8Array;
  try {
    stat = await workspace.fs.stat(uri);
    signal.throwIfAborted();
    if ((stat.type & FileType.File) === 0 || stat.size > maxWorkspaceEditTextBytes) {
      throw new UnsupportedWorkspaceTextError();
    }
    const prefix = await readLocalFilePrefix(uri.fsPath, maxWorkspaceEditTextBytes, signal);
    signal.throwIfAborted();
    if (prefix.truncated) {
      throw new UnsupportedWorkspaceTextError();
    }
    bytes = prefix.bytes;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof UnsupportedWorkspaceTextError) {
      throw error;
    }
    throw new UnsupportedWorkspaceTextError();
  }

  if (bytes.byteLength > maxWorkspaceEditTextBytes) {
    throw new UnsupportedWorkspaceTextError();
  }

  let rawText: string;
  try {
    rawText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new UnsupportedWorkspaceTextError();
  }
  if (!isBoundedWorkspaceEditText(rawText)) {
    throw new UnsupportedWorkspaceTextError();
  }
  return rawText;
}

export function assertSupportedWorkspaceDocument(
  document: Pick<TextDocument, "getText">,
  rawText: string,
): void {
  if (!isBoundedWorkspaceEditText(rawText) || !isBoundedWorkspaceEditText(document.getText())) {
    throw new UnsupportedWorkspaceTextError();
  }
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
