import { createHash } from "node:crypto";

import type { IdeContextPort, ReadEditorContextInput } from "@ctrl-zebra/builtin-tools";
import { EditorContextUnavailableError } from "@ctrl-zebra/builtin-tools";
import {
  type IdePositionDto,
  type IdeTextContextDto,
  type IdeTextPrefix,
  IdeTextPrefixCollector,
  type IdeTruncationReason,
  ideTextContextSchema,
  maxIdeLanguageIdBytes,
  maxIdeLanguageIdCodePoints,
  maxIdeUriPathBytes,
  maxIdeUriPathCodePoints,
  maxIdeUriSchemeBytes,
  maxIdeUriSchemeCodePoints,
} from "@ctrl-zebra/protocol";
import type { Range, TextDocument, TextEditor, Uri } from "vscode";
import { IdeSourceProjectionError, ideSourceProjector } from "./ide-source-projector.js";
import { type WorkspaceScope, WorkspaceScopeError } from "./workspace-scope.js";

export { EditorContextUnavailableError } from "@ctrl-zebra/builtin-tools";

const maxTextChunkCodeUnits = 16_384;

export interface VsCodeEditorContextDependencies {
  readonly getActiveEditor: () => TextEditor | undefined;
  readonly getSelectedRoot: () => Uri | undefined;
  readonly createScope: (root: Uri) => Pick<WorkspaceScope, "validate">;
  readonly isEnabled: () => boolean;
  readonly isTrusted?: () => boolean;
}

export type VsCodeEditorContextAvailability =
  | "disabled"
  | "no-editor"
  | "no-selection"
  | "untrusted-workspace"
  | "unsupported-document"
  | "outside-workspace"
  | "unavailable";

export interface EditorContextSourceFingerprintInput {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly documentVersion: number;
  readonly languageId: string;
  readonly range?: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
}

interface CaptureSnapshot {
  readonly scope: ReadEditorContextInput["scope"];
  readonly editor: TextEditor;
  readonly document: TextDocument;
  readonly root: Uri;
  readonly uri: Uri;
  readonly version: number;
  readonly languageId: string;
  readonly selection: SelectionSnapshot;
  readonly trusted: boolean | undefined;
}

interface SelectionSnapshot {
  readonly start: IdePositionDto;
  readonly end: IdePositionDto;
}

interface BoundedDisplayText {
  readonly text: string;
  readonly truncated: boolean;
  readonly truncationReasons: readonly IdeTruncationReason[];
}

/**
 * Owns the VS Code editor read and keeps host objects private until a validated Protocol DTO is built.
 */
export class VsCodeEditorContext implements IdeContextPort {
  readonly #dependencies: VsCodeEditorContextDependencies;
  #disposed = false;

  constructor(dependencies: VsCodeEditorContextDependencies) {
    this.#dependencies = dependencies;
  }

  async readEditorContext(
    input: ReadEditorContextInput,
    signal: AbortSignal,
  ): Promise<IdeTextContextDto> {
    this.#assertOpen(signal);
    const snapshot = this.#capture(input, signal);
    let scope: Pick<WorkspaceScope, "validate">;
    try {
      scope = this.#dependencies.createScope(snapshot.root);
    } catch {
      throw new EditorContextUnavailableError();
    }

    let canonicalRoot: Uri;
    let canonicalTarget: Uri;
    try {
      canonicalRoot = await scope.validate(snapshot.root, signal);
      signal.throwIfAborted();
      canonicalTarget = await scope.validate(snapshot.uri, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof EditorContextUnavailableError) throw error;
      throw new EditorContextUnavailableError();
    }

    this.#assertOpen(signal);
    this.#assertOwner(snapshot);

    const textProjection = this.#readText(snapshot, input);
    const languageProjection = takeBoundedDisplayText(
      snapshot.languageId,
      maxIdeLanguageIdCodePoints,
      maxIdeLanguageIdBytes,
    );
    let result: ReturnType<typeof ideTextContextSchema.safeParse>;
    try {
      const relativePath = toWorkspaceRelativePath(canonicalRoot, canonicalTarget);
      const source = {
        uri: {
          scheme: boundedRequiredText(
            canonicalTarget.scheme,
            maxIdeUriSchemeCodePoints,
            maxIdeUriSchemeBytes,
          ),
          authority: canonicalTarget.authority.length === 0 ? "" : "workspace",
          path: boundedRequiredText(relativePath, maxIdeUriPathCodePoints, maxIdeUriPathBytes),
        },
        ...(input.scope === "selection" ? { range: snapshot.selection } : {}),
        ...(languageProjection.text.length > 0 || snapshot.languageId.length === 0
          ? { languageId: languageProjection.text }
          : {}),
        documentVersion: snapshot.version,
        stale: this.#isStale(snapshot),
        truncated: textProjection.truncated || languageProjection.truncated,
        ...(textProjection.truncated || languageProjection.truncated
          ? {
              truncationReasons: mergeTruncationReasons(
                textProjection.truncationReasons,
                languageProjection.truncationReasons,
              ),
            }
          : {}),
      };
      result = ideTextContextSchema.safeParse({ source, text: textProjection.text });
    } catch (error) {
      if (error instanceof EditorContextUnavailableError) throw error;
      throw new EditorContextUnavailableError();
    }
    if (!result.success) {
      throw new EditorContextUnavailableError();
    }
    this.#assertOpen(signal);
    this.#assertOwner(snapshot);
    return result.data;
  }

  async getAvailability(
    scope: ReadEditorContextInput["scope"],
  ): Promise<VsCodeEditorContextAvailability | undefined> {
    if (!this.#dependencies.isEnabled()) return "disabled";
    if (this.#dependencies.isTrusted?.() === false) return "untrusted-workspace";
    const editor = this.#dependencies.getActiveEditor();
    if (editor === undefined) return "no-editor";
    if (scope === "selection" && editor.selection === undefined) return "no-selection";
    const document = editor.document;
    if (document === undefined || document.uri === undefined || document.uri.scheme !== "file") {
      return "unsupported-document";
    }
    const root = this.#dependencies.getSelectedRoot();
    if (root === undefined) return "outside-workspace";
    try {
      await this.#dependencies
        .createScope(root)
        .validate(document.uri, new AbortController().signal);
    } catch (error) {
      if (error instanceof WorkspaceScopeError && error.code === "outside-workspace") {
        return "outside-workspace";
      }
      if (error instanceof WorkspaceScopeError && error.code === "invalid-uri") {
        return "unsupported-document";
      }
      return "unavailable";
    }
    return undefined;
  }

  getSourceFingerprint(scope: ReadEditorContextInput["scope"]): string | undefined {
    const editor = this.#dependencies.getActiveEditor();
    if (editor === undefined || editor.document === undefined) return undefined;
    return createEditorContextSourceFingerprint({
      scheme: editor.document.uri.scheme,
      authority: editor.document.uri.authority,
      path: editor.document.uri.path,
      documentVersion: editor.document.version,
      languageId: editor.document.languageId,
      ...(scope === "selection" && editor.selection !== undefined
        ? {
            range: {
              start: editor.selection.start,
              end: editor.selection.end,
            },
          }
        : {}),
    });
  }

  dispose(): void {
    this.#disposed = true;
  }

  #capture(input: ReadEditorContextInput, signal: AbortSignal): CaptureSnapshot {
    signal.throwIfAborted();
    try {
      const editor = this.#dependencies.getActiveEditor();
      const root = this.#dependencies.getSelectedRoot();
      if (editor === undefined || root === undefined) {
        throw new EditorContextUnavailableError();
      }
      const document = editor.document;
      if (
        document === undefined ||
        document.uri === undefined ||
        typeof document.languageId !== "string"
      ) {
        throw new EditorContextUnavailableError();
      }
      const version = document.version;
      if (!Number.isSafeInteger(version) || version < 0) {
        throw new EditorContextUnavailableError();
      }

      const selection = readSelection(editor);
      if (input.scope === "selection") {
        validateDocumentRange(document, selection);
      }

      return {
        scope: input.scope,
        editor,
        document,
        root,
        uri: document.uri,
        version,
        languageId: document.languageId,
        selection,
        trusted: this.#dependencies.isTrusted?.(),
      };
    } catch {
      throw new EditorContextUnavailableError();
    }
  }

  #readText(snapshot: CaptureSnapshot, input: ReadEditorContextInput): IdeTextPrefix {
    try {
      const range =
        input.scope === "selection"
          ? {
              start: snapshot.selection.start,
              end: snapshot.selection.end,
            }
          : {
              start: { line: 0, character: 0 },
              end: {
                line: snapshot.document.lineCount - 1,
                character: snapshot.document.lineAt(snapshot.document.lineCount - 1).text.length,
              },
            };
      const collector = new IdeTextPrefixCollector();
      for (
        let lineNumber = range.start.line;
        lineNumber <= range.end.line && !collector.limitReached;
        lineNumber += 1
      ) {
        const line = snapshot.document.lineAt(lineNumber);
        if (typeof line.text !== "string") throw new EditorContextUnavailableError();
        const startCharacter = lineNumber === range.start.line ? range.start.character : 0;
        const endCharacter = lineNumber === range.end.line ? range.end.character : line.text.length;
        if (startCharacter > endCharacter || endCharacter > line.text.length) {
          throw new EditorContextUnavailableError();
        }

        for (let character = startCharacter; character < endCharacter; ) {
          let chunkEnd = Math.min(character + maxTextChunkCodeUnits, endCharacter);
          if (
            chunkEnd < endCharacter &&
            ideSourceProjector.isHighSurrogate(line.text.charCodeAt(chunkEnd - 1))
          ) {
            chunkEnd -= 1;
          }
          if (chunkEnd <= character) throw new EditorContextUnavailableError();
          const chunk = readDocumentRange(
            snapshot.document,
            toRange(lineNumber, character, lineNumber, chunkEnd),
            chunkEnd - character,
          );
          collector.add(chunk);
          if (collector.limitReached) break;
          character = chunkEnd;
        }

        if (!collector.limitReached && lineNumber < range.end.line) {
          collector.add(
            readDocumentRange(
              snapshot.document,
              toRange(lineNumber, line.text.length, lineNumber + 1, 0),
              2,
            ),
          );
        }
      }
      return collector.finish();
    } catch (error) {
      if (error instanceof EditorContextUnavailableError) throw error;
      throw new EditorContextUnavailableError();
    }
  }

  #isStale(snapshot: CaptureSnapshot): boolean {
    try {
      const editor = this.#dependencies.getActiveEditor();
      if (
        editor === undefined ||
        editor !== snapshot.editor ||
        editor.document !== snapshot.document ||
        !ideSourceProjector.sameUri(editor.document.uri, snapshot.uri)
      ) {
        throw new EditorContextUnavailableError();
      }
      const root = this.#dependencies.getSelectedRoot();
      if (root === undefined || !ideSourceProjector.sameUri(root, snapshot.root)) {
        throw new EditorContextUnavailableError();
      }
      if (this.#dependencies.isTrusted?.() !== snapshot.trusted) {
        throw new EditorContextUnavailableError();
      }
      if (!this.#dependencies.isEnabled()) {
        throw new EditorContextUnavailableError();
      }
      return (
        editor.document.version !== snapshot.version ||
        (snapshot.scope === "selection" &&
          !sameSelection(readSelection(editor), snapshot.selection))
      );
    } catch (error) {
      if (error instanceof EditorContextUnavailableError) throw error;
      throw new EditorContextUnavailableError();
    }
  }

  #assertOwner(snapshot: CaptureSnapshot): void {
    try {
      const editor = this.#dependencies.getActiveEditor();
      if (
        editor === undefined ||
        editor !== snapshot.editor ||
        editor.document !== snapshot.document ||
        !ideSourceProjector.sameUri(editor.document.uri, snapshot.uri)
      ) {
        throw new EditorContextUnavailableError();
      }
    } catch (error) {
      if (error instanceof EditorContextUnavailableError) throw error;
      throw new EditorContextUnavailableError();
    }
  }

  #assertOpen(signal: AbortSignal): void {
    signal.throwIfAborted();
    let enabled = false;
    try {
      enabled = this.#dependencies.isEnabled();
    } catch {
      throw new EditorContextUnavailableError();
    }
    if (this.#disposed || !enabled) {
      throw new EditorContextUnavailableError();
    }
  }
}

/** Returns a bounded opaque identity without retaining or publishing the raw URI. */
export function createEditorContextSourceFingerprint(
  input: EditorContextSourceFingerprintInput,
): string {
  const range =
    input.range === undefined
      ? ""
      : `${input.range.start.line}:${input.range.start.character}:${input.range.end.line}:${input.range.end.character}`;
  return createHash("sha256")
    .update(
      [
        input.scheme,
        input.authority,
        input.path,
        input.documentVersion,
        input.languageId,
        range,
      ].join("\u0000"),
      "utf8",
    )
    .digest("hex");
}

function readSelection(editor: TextEditor): SelectionSnapshot {
  return {
    start: toPosition(editor.selection.start),
    end: toPosition(editor.selection.end),
  };
}

function toPosition(position: {
  readonly line: number;
  readonly character: number;
}): IdePositionDto {
  if (
    !Number.isSafeInteger(position.line) ||
    !Number.isSafeInteger(position.character) ||
    position.line < 0 ||
    position.character < 0
  ) {
    throw new EditorContextUnavailableError();
  }
  return { line: position.line, character: position.character };
}

function validateDocumentRange(document: TextDocument, selection: SelectionSnapshot): void {
  validateDocumentPosition(document, selection.start);
  validateDocumentPosition(document, selection.end);
  if (ideSourceProjector.comparePositions(selection.start, selection.end) > 0) {
    throw new EditorContextUnavailableError();
  }
}

function readDocumentRange(document: TextDocument, range: Range, maxCodeUnits: number): string {
  let value: unknown;
  try {
    value = document.getText(range);
  } catch {
    throw new EditorContextUnavailableError();
  }
  if (typeof value !== "string" || value.length > maxCodeUnits || value.includes("\u0000")) {
    throw new EditorContextUnavailableError();
  }
  return value;
}

function toRange(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): Range {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  } as unknown as Range;
}

function validateDocumentPosition(document: TextDocument, position: IdePositionDto): void {
  let line: { readonly text: string };
  try {
    line = document.lineAt(position.line);
  } catch {
    throw new EditorContextUnavailableError();
  }
  try {
    ideSourceProjector.validateDocumentPosition(document.lineCount, line.text, position);
  } catch (error) {
    if (error instanceof IdeSourceProjectionError) {
      throw new EditorContextUnavailableError();
    }
    throw error;
  }
}

function sameSelection(left: SelectionSnapshot, right: SelectionSnapshot): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}

function toWorkspaceRelativePath(root: Uri, target: Uri): string {
  try {
    return ideSourceProjector.toWorkspaceRelativePath(root, target);
  } catch (error) {
    if (error instanceof IdeSourceProjectionError) {
      throw new EditorContextUnavailableError();
    }
    throw error;
  }
}

function boundedRequiredText(value: string, maxCodePoints: number, maxBytes: number): string {
  try {
    return ideSourceProjector.boundedRequired(value, maxCodePoints, maxBytes);
  } catch (error) {
    if (error instanceof IdeSourceProjectionError) {
      throw new EditorContextUnavailableError();
    }
    throw error;
  }
}

function takeBoundedDisplayText(
  value: string,
  maxCodePoints: number,
  maxBytes: number,
): BoundedDisplayText {
  try {
    const projection = ideSourceProjector.takeBoundedText(value, maxCodePoints, maxBytes);
    return {
      text: projection.text,
      truncated: projection.truncated,
      truncationReasons: projection.reasons,
    };
  } catch (error) {
    if (error instanceof IdeSourceProjectionError) {
      throw new EditorContextUnavailableError();
    }
    throw error;
  }
}

function mergeTruncationReasons(
  textReasons: readonly IdeTruncationReason[],
  languageReasons: readonly IdeTruncationReason[],
): readonly IdeTruncationReason[] {
  const reasons = new Set([...textReasons, ...languageReasons]);
  return (
    ["code-points", "utf8-bytes", "lines", "entries", "tokens", "out-of-workspace"] as const
  ).filter((reason): reason is IdeTruncationReason => reasons.has(reason));
}
