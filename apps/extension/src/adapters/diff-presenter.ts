import type { TextEditPlan, TextPosition } from "@ctrl-zebra/core";

export const diffDocumentScheme = "ctrlzebra-diff";

export interface DiffResource {
  toString(): string;
}

export interface DiffSourceDocument {
  readonly uri: DiffResource;
  readonly version: number;
  readonly text: string;
  readonly label: string;
}

export interface DiffContentProvider {
  provideTextDocumentContent(uri: DiffResource): string | undefined;
}

export interface DiffPresenterDisposable {
  dispose(): void;
}

export interface DiffPresenterDependencies {
  readonly openSourceDocument: (uri: string, signal: AbortSignal) => Promise<DiffSourceDocument>;
  readonly createVirtualUri: (id: string, side: "before" | "after", label: string) => DiffResource;
  readonly registerContentProvider: (provider: DiffContentProvider) => DiffPresenterDisposable;
  readonly onDidCloseDocument: (listener: (uri: DiffResource) => void) => DiffPresenterDisposable;
  readonly showDiff: (before: DiffResource, after: DiffResource, title: string) => Promise<void>;
  readonly hashText: (text: string) => string;
  readonly nextId: () => string;
}

export class DiffSourceChangedError extends Error {
  constructor() {
    super("The source file changed before its proposed diff could be shown.");
    this.name = "DiffSourceChangedError";
  }
}

export class InvalidDiffEditRangeError extends Error {
  constructor() {
    super("A proposed text edit range is outside the source document.");
    this.name = "InvalidDiffEditRangeError";
  }
}

export class DiffPresenterDisposedError extends Error {
  constructor() {
    super("The Diff Presenter has been disposed.");
    this.name = "DiffPresenterDisposedError";
  }
}

export class DiffPresenter implements DiffPresenterDisposable {
  readonly #dependencies: DiffPresenterDependencies;
  readonly #contents = new Map<string, string>();
  readonly #providerRegistration: DiffPresenterDisposable;
  readonly #closeRegistration: DiffPresenterDisposable;
  #disposed = false;

  constructor(dependencies: DiffPresenterDependencies) {
    this.#dependencies = dependencies;
    this.#providerRegistration = dependencies.registerContentProvider({
      provideTextDocumentContent: (uri) => this.#contents.get(uri.toString()),
    });
    this.#closeRegistration = dependencies.onDidCloseDocument((uri) => {
      this.#contents.delete(uri.toString());
    });
  }

  async present(plan: TextEditPlan, signal: AbortSignal): Promise<void> {
    if (this.#disposed) {
      throw new DiffPresenterDisposedError();
    }

    signal.throwIfAborted();
    const source = await this.#dependencies.openSourceDocument(plan.uri, signal);
    signal.throwIfAborted();
    this.#assertSourceRevision(plan, source);
    const afterText = applyTextEdits(source.text, plan);
    const id = this.#dependencies.nextId();
    const beforeUri = this.#dependencies.createVirtualUri(id, "before", source.label);
    const afterUri = this.#dependencies.createVirtualUri(id, "after", source.label);
    const beforeKey = beforeUri.toString();
    const afterKey = afterUri.toString();
    this.#contents.set(beforeKey, source.text);
    this.#contents.set(afterKey, afterText);

    try {
      signal.throwIfAborted();
      await this.#dependencies.showDiff(
        beforeUri,
        afterUri,
        `CtrlZebra: ${source.label} (Proposed Changes)`,
      );
    } catch (error) {
      this.#contents.delete(beforeKey);
      this.#contents.delete(afterKey);
      throw error;
    }

    signal.throwIfAborted();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#contents.clear();
    this.#closeRegistration.dispose();
    this.#providerRegistration.dispose();
  }

  #assertSourceRevision(plan: TextEditPlan, source: DiffSourceDocument): void {
    if (source.uri.toString() !== plan.uri) {
      throw new DiffSourceChangedError();
    }

    const revision = plan.originalRevision;
    const current =
      revision.kind === "document_version"
        ? source.version === revision.value
        : this.#dependencies.hashText(source.text) === revision.value;
    if (!current) {
      throw new DiffSourceChangedError();
    }
  }
}

function applyTextEdits(text: string, plan: TextEditPlan): string {
  const lineBounds = findLineBounds(text);
  const replacements = plan.edits
    .map((edit) => ({
      start: offsetAt(edit.range.start, lineBounds),
      end: offsetAt(edit.range.end, lineBounds),
      newText: edit.newText,
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  for (let index = 0; index < replacements.length; index += 1) {
    const current = replacements[index];
    const previous = replacements[index - 1];
    if (
      current === undefined ||
      current.start > current.end ||
      (previous !== undefined && (current.start < previous.end || current.start === previous.start))
    ) {
      throw new InvalidDiffEditRangeError();
    }
  }

  let result = text;
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const replacement = replacements[index];
    if (replacement === undefined) {
      throw new InvalidDiffEditRangeError();
    }
    result = `${result.slice(0, replacement.start)}${replacement.newText}${result.slice(replacement.end)}`;
  }
  return result;
}

interface LineBounds {
  readonly start: number;
  readonly end: number;
}

function findLineBounds(text: string): readonly LineBounds[] {
  const lines: LineBounds[] = [];
  let lineStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character !== "\n" && character !== "\r") {
      continue;
    }

    lines.push({ start: lineStart, end: index });
    if (character === "\r" && text[index + 1] === "\n") {
      index += 1;
    }
    lineStart = index + 1;
  }
  lines.push({ start: lineStart, end: text.length });
  return lines;
}

function offsetAt(position: TextPosition, lines: readonly LineBounds[]): number {
  const line = lines[position.line];
  if (line === undefined || position.character > line.end - line.start) {
    throw new InvalidDiffEditRangeError();
  }
  return line.start + position.character;
}
