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

import type { WorkspaceScope } from "./workspace-scope.js";

export { EditorContextUnavailableError } from "@ctrl-zebra/builtin-tools";

const maxTextChunkCodeUnits = 16_384;

export interface VsCodeEditorContextDependencies {
  readonly getActiveEditor: () => TextEditor | undefined;
  readonly getSelectedRoot: () => Uri | undefined;
  readonly createScope: (root: Uri) => Pick<WorkspaceScope, "validate">;
  readonly isEnabled: () => boolean;
  readonly isTrusted?: () => boolean;
}

interface CaptureSnapshot {
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
          if (chunkEnd < endCharacter && isHighSurrogate(line.text.charCodeAt(chunkEnd - 1))) {
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
        !sameUri(editor.document.uri, snapshot.uri)
      ) {
        throw new EditorContextUnavailableError();
      }
      const root = this.#dependencies.getSelectedRoot();
      if (root === undefined || !sameUri(root, snapshot.root)) {
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
        !sameSelection(readSelection(editor), snapshot.selection)
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
        !sameUri(editor.document.uri, snapshot.uri)
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
  if (comparePositions(selection.start, selection.end) > 0) {
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

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function validateDocumentPosition(document: TextDocument, position: IdePositionDto): void {
  if (!Number.isSafeInteger(document.lineCount) || document.lineCount <= position.line) {
    throw new EditorContextUnavailableError();
  }
  let line: { readonly text: string };
  try {
    line = document.lineAt(position.line);
  } catch {
    throw new EditorContextUnavailableError();
  }
  if (
    typeof line.text !== "string" ||
    position.character > line.text.length ||
    isInsideSurrogate(line.text, position.character)
  ) {
    throw new EditorContextUnavailableError();
  }
}

function isInsideSurrogate(line: string, character: number): boolean {
  if (character <= 0 || character >= line.length) return false;
  const previous = line.charCodeAt(character - 1);
  const next = line.charCodeAt(character);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function comparePositions(left: IdePositionDto, right: IdePositionDto): number {
  return left.line - right.line || left.character - right.character;
}

function sameSelection(left: SelectionSnapshot, right: SelectionSnapshot): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}

function sameUri(left: Uri, right: Uri): boolean {
  return (
    left.scheme.toLocaleLowerCase("en-US") === right.scheme.toLocaleLowerCase("en-US") &&
    left.authority.toLocaleLowerCase("en-US") === right.authority.toLocaleLowerCase("en-US") &&
    left.path === right.path &&
    left.query === right.query &&
    left.fragment === right.fragment
  );
}

function toWorkspaceRelativePath(root: Uri, target: Uri): string {
  const rootSegments = pathSegments(root.path);
  const targetSegments = pathSegments(target.path);
  if (
    targetSegments.length <= rootSegments.length ||
    !sameIdentityPart(root.scheme, target.scheme) ||
    !sameIdentityPart(root.authority, target.authority)
  ) {
    throw new EditorContextUnavailableError();
  }
  for (let index = 0; index < rootSegments.length; index += 1) {
    if (!sameIdentityPart(rootSegments[index] ?? "", targetSegments[index] ?? "")) {
      throw new EditorContextUnavailableError();
    }
  }
  const relative = targetSegments.slice(rootSegments.length).join("/");
  if (relative.length === 0) throw new EditorContextUnavailableError();
  return relative;
}

function pathSegments(path: string): readonly string[] {
  if (!path.startsWith("/") || path.includes("\\")) {
    throw new EditorContextUnavailableError();
  }
  if (path === "/") return [];
  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new EditorContextUnavailableError();
  }
  return segments;
}

function sameIdentityPart(left: string, right: string): boolean {
  return left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}

function boundedRequiredText(value: string, maxCodePoints: number, maxBytes: number): string {
  const projection = takeBoundedDisplayText(value, maxCodePoints, maxBytes);
  if (projection.truncated || projection.text.length === 0) {
    throw new EditorContextUnavailableError();
  }
  return projection.text;
}

function takeBoundedDisplayText(
  value: string,
  maxCodePoints: number,
  maxBytes: number,
): BoundedDisplayText {
  const output: string[] = [];
  let codePoints = 0;
  let bytes = 0;
  const reasons = new Set<IdeTruncationReason>();
  let retained = true;
  for (let index = 0; index < value.length; ) {
    const codeUnit = value.charCodeAt(index);
    let width = 1;
    let codePoint = codeUnit;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new EditorContextUnavailableError();
      width = 2;
      codePoint = value.codePointAt(index) ?? 0;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new EditorContextUnavailableError();
    }
    const candidateBytes =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (retained) {
      if (codePoints + 1 > maxCodePoints) {
        reasons.add("code-points");
      }
      if (bytes + candidateBytes > maxBytes) {
        reasons.add("utf8-bytes");
      }
      if (reasons.size > 0) {
        retained = false;
        index += width;
        continue;
      }
      output.push(value.slice(index, index + width));
      codePoints += 1;
      bytes += candidateBytes;
    }
    index += width;
  }
  const truncationReasons = (["code-points", "utf8-bytes"] as const).filter((reason) =>
    reasons.has(reason),
  );
  return {
    text: output.join(""),
    truncated: truncationReasons.length > 0,
    truncationReasons,
  };
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
