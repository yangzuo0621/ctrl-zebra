import type { GetDiagnosticsInput, IdeDiagnosticsPort } from "@ctrl-zebra/builtin-tools";
import {
  DiagnosticsUnavailableError,
  InvalidDiagnosticsOutputError,
} from "@ctrl-zebra/builtin-tools";
import {
  type IdeDiagnosticDto,
  type IdeDiagnosticsResultDto,
  type IdePositionDto,
  type IdeRangeDto,
  type IdeSourceDto,
  type IdeTruncationReason,
  ideDiagnosticsResultSchema,
  maxIdeDiagnosticAggregateBytes,
  maxIdeDiagnosticAggregateCodePoints,
  maxIdeDiagnosticEntries,
  maxIdeDiagnosticLabelBytes,
  maxIdeDiagnosticLabelCodePoints,
  maxIdeDiagnosticMessageBytes,
  maxIdeDiagnosticMessageCodePoints,
  maxIdeLanguageIdBytes,
  maxIdeLanguageIdCodePoints,
  maxIdeUriPathBytes,
  maxIdeUriPathCodePoints,
  maxIdeUriSchemeBytes,
  maxIdeUriSchemeCodePoints,
} from "@ctrl-zebra/protocol";
import type { Diagnostic, TextDocument, TextEditor, Uri } from "vscode";
import { IdeSourceProjectionError, ideSourceProjector } from "./ide-source-projector.js";
import type { WorkspaceScope } from "./workspace-scope.js";
import { WorkspaceScopeError } from "./workspace-scope.js";

export {
  DiagnosticsUnavailableError,
  InvalidDiagnosticsOutputError,
} from "@ctrl-zebra/builtin-tools";

type DiagnosticProviderValue =
  | readonly Diagnostic[]
  | readonly (readonly [Uri, readonly Diagnostic[]])[];

export interface VsCodeDiagnosticsDependencies {
  readonly getActiveEditor: () => TextEditor | undefined;
  readonly getSelectedRoot: () => Uri | undefined;
  readonly createScope: (root: Uri) => Pick<WorkspaceScope, "validate">;
  readonly joinPath: (root: Uri, path: string) => Uri;
  readonly getDiagnostics: (
    uri?: Uri,
  ) => DiagnosticProviderValue | Promise<DiagnosticProviderValue>;
  readonly getDocument?: (uri: Uri) => TextDocument | undefined;
  readonly isEnabled?: () => boolean;
  readonly isTrusted?: () => boolean;
}

interface QuerySnapshot {
  readonly generation: number;
  readonly input: GetDiagnosticsInput;
  readonly root: Uri;
  readonly canonicalRoot: Uri;
  readonly target?: Uri;
  readonly targetDocument?: TextDocument;
  readonly targetVersion?: number;
  readonly editor?: TextEditor;
  readonly document?: TextDocument;
  readonly documentUri?: Uri;
  readonly trusted: boolean | undefined;
}

interface BoundedText {
  readonly text: string;
  readonly truncated: boolean;
  readonly reasons: readonly IdeTruncationReason[];
}

interface NormalizedCandidate {
  readonly source: IdeSourceDto;
  readonly diagnostic: IdeDiagnosticDto;
  readonly aggregateValues: readonly string[];
}

interface CollectedDiagnostics {
  readonly candidates: readonly NormalizedCandidate[];
  readonly reasons: ReadonlySet<IdeTruncationReason>;
  readonly overflowed: boolean;
  readonly outsideCount: number;
  readonly sawProviderResource: boolean;
  readonly sawInWorkspaceResource: boolean;
}

/**
 * Reads VS Code diagnostics and keeps the host-only URI/provider values private.
 * The VS Code API is synchronous today, but the injected provider is awaitable so
 * cancellation and editor/workspace races remain testable and explicit.
 */
export class VsCodeDiagnostics implements IdeDiagnosticsPort {
  readonly #dependencies: VsCodeDiagnosticsDependencies;
  #disposed = false;
  #generation = 0;

  constructor(dependencies: VsCodeDiagnosticsDependencies) {
    this.#dependencies = dependencies;
  }

  async getDiagnostics(
    input: GetDiagnosticsInput,
    signal: AbortSignal,
  ): Promise<IdeDiagnosticsResultDto> {
    const generation = this.#generation;
    this.#assertOpen(signal, generation);
    const snapshot = await this.#capture(input, signal, generation);
    const value = await this.#readProvider(snapshot, signal);
    signal.throwIfAborted();
    this.#assertOpen(signal, snapshot.generation);

    const stale = this.#readStale(snapshot);
    const collected = await this.#collect(snapshot, value, stale, signal);
    this.#assertOpen(signal, snapshot.generation);
    if (
      snapshot.input.scope === "workspace" &&
      snapshot.input.path === undefined &&
      collected.sawProviderResource &&
      collected.outsideCount > 0 &&
      !collected.sawInWorkspaceResource
    ) {
      throw new InvalidDiagnosticsOutputError();
    }

    const reasons = new Set<IdeTruncationReason>(collected.reasons);
    if (collected.outsideCount > 0) reasons.add("out-of-workspace");
    const diagnostics = collected.candidates.map(({ diagnostic }) => diagnostic);
    const truncated = reasons.size > 0;
    const source = this.#resultSource(snapshot, collected.candidates, stale, truncated, reasons);
    const result = ideDiagnosticsResultSchema.safeParse({
      kind: "diagnostics",
      source,
      diagnostics,
      stale,
      truncated,
      ...(truncated ? { truncationReasons: orderedReasons(reasons) } : {}),
    });
    if (!result.success) throw new InvalidDiagnosticsOutputError();
    this.#assertOpen(signal, snapshot.generation);
    this.#assertSnapshotIdentity(snapshot, true);
    return result.data;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
  }

  async #capture(
    input: GetDiagnosticsInput,
    signal: AbortSignal,
    generation: number,
  ): Promise<QuerySnapshot> {
    this.#assertOpen(signal, generation);
    const enabled = this.#dependencies.isEnabled?.() ?? true;
    const trusted = this.#dependencies.isTrusted?.();
    if (!enabled) throw new DiagnosticsUnavailableError();

    const root = this.#dependencies.getSelectedRoot();
    if (root === undefined) throw new DiagnosticsUnavailableError();
    let scope: Pick<WorkspaceScope, "validate">;
    try {
      scope = this.#dependencies.createScope(root);
    } catch {
      throw new DiagnosticsUnavailableError();
    }

    let canonicalRoot: Uri;
    try {
      canonicalRoot = await scope.validate(root, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof DiagnosticsUnavailableError) throw error;
      throw new DiagnosticsUnavailableError();
    }
    this.#assertOpen(signal, generation);

    let editor: TextEditor | undefined;
    let document: TextDocument | undefined;
    let documentUri: Uri | undefined;
    let target: Uri | undefined;
    let targetDocument: TextDocument | undefined;
    let targetVersion: number | undefined;
    if (input.scope === "active-file") {
      editor = this.#dependencies.getActiveEditor();
      document = editor?.document;
      documentUri = document?.uri;
      if (editor === undefined || document === undefined || documentUri === undefined) {
        throw new DiagnosticsUnavailableError();
      }
      target = await this.#validateTarget(scope, documentUri, signal, generation);
      targetDocument = document;
      targetVersion = readDocumentVersion(document);
      if (targetVersion === undefined) throw new DiagnosticsUnavailableError();
    } else if (input.path !== undefined) {
      let joined: Uri;
      try {
        joined = this.#dependencies.joinPath(root, input.path);
      } catch {
        throw new DiagnosticsUnavailableError();
      }
      target = await this.#validateTarget(scope, joined, signal, generation);
      targetDocument = this.#dependencies.getDocument?.(target);
      targetVersion =
        targetDocument === undefined ? undefined : readDocumentVersion(targetDocument);
      if (targetDocument !== undefined && targetVersion === undefined) {
        throw new DiagnosticsUnavailableError();
      }
    }

    this.#assertOpen(signal, generation);
    this.#assertSnapshotIdentity({
      generation,
      input,
      root,
      canonicalRoot,
      target,
      targetDocument,
      targetVersion,
      editor,
      document,
      documentUri,
      trusted,
    });
    return {
      generation,
      input,
      root,
      canonicalRoot,
      target,
      targetDocument,
      targetVersion,
      editor,
      document,
      documentUri,
      trusted,
    };
  }

  async #validateTarget(
    scope: Pick<WorkspaceScope, "validate">,
    target: Uri,
    signal: AbortSignal,
    generation: number,
  ): Promise<Uri> {
    try {
      const canonical = await scope.validate(target, signal);
      this.#assertOpen(signal, generation);
      return canonical;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof WorkspaceScopeError) throw new DiagnosticsUnavailableError();
      throw new DiagnosticsUnavailableError();
    }
  }

  async #readProvider(
    snapshot: QuerySnapshot,
    signal: AbortSignal,
  ): Promise<DiagnosticProviderValue> {
    this.#assertOpen(signal, snapshot.generation);
    try {
      const value = await this.#dependencies.getDiagnostics(
        snapshot.input.scope === "workspace" && snapshot.input.path === undefined
          ? undefined
          : snapshot.target,
      );
      signal.throwIfAborted();
      this.#assertOpen(signal, snapshot.generation);
      this.#assertSnapshotIdentity(snapshot, true);
      return value;
    } catch (error) {
      signal.throwIfAborted();
      if (
        error instanceof DiagnosticsUnavailableError ||
        error instanceof InvalidDiagnosticsOutputError
      ) {
        throw error;
      }
      throw new DiagnosticsUnavailableError();
    }
  }

  async #collect(
    snapshot: QuerySnapshot,
    value: DiagnosticProviderValue,
    stale: boolean,
    signal: AbortSignal,
  ): Promise<CollectedDiagnostics> {
    this.#assertOpen(signal, snapshot.generation);
    const candidates: NormalizedCandidate[] = [];
    const reasons = new Set<IdeTruncationReason>();
    let outsideCount = 0;
    let sawProviderResource = false;
    let sawInWorkspaceResource = false;
    let overflowed = false;

    const addCandidate = (candidate: NormalizedCandidate): void => {
      const key = candidateKey(candidate);
      if (candidates.some((existing) => candidateKey(existing) === key)) return;
      if (candidates.length < maxIdeDiagnosticEntries) {
        candidates.push(candidate);
        return;
      }
      overflowed = true;
      let worstIndex = 0;
      for (let index = 1; index < candidates.length; index += 1) {
        const worst = candidates[worstIndex];
        const current = candidates[index];
        if (worst !== undefined && current !== undefined && compareCandidates(worst, current) < 0) {
          worstIndex = index;
        }
      }
      const worst = candidates[worstIndex];
      if (worst !== undefined && compareCandidates(candidate, worst) < 0) {
        candidates[worstIndex] = candidate;
      }
    };

    if (snapshot.input.scope === "workspace" && snapshot.input.path === undefined) {
      if (!Array.isArray(value)) throw new InvalidDiagnosticsOutputError();
      for (const entry of value) {
        this.#assertOpen(signal, snapshot.generation);
        if (!isDiagnosticTuple(entry)) throw new InvalidDiagnosticsOutputError();
        sawProviderResource = true;
        let canonical: Uri;
        try {
          canonical = await this.#validateProviderUri(snapshot, entry[0], signal);
          this.#assertOpen(signal, snapshot.generation);
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof DiagnosticsUnavailableError) throw error;
          if (error instanceof OutsideWorkspaceError) {
            outsideCount += 1;
            continue;
          }
          throw new InvalidDiagnosticsOutputError();
        }
        sawInWorkspaceResource = true;
        const document = this.#dependencies.getDocument?.(canonical);
        for (const diagnostic of entry[1]) {
          this.#assertOpen(signal, snapshot.generation);
          const candidate = this.#normalizeDiagnosticSafe(
            snapshot,
            canonical,
            document,
            diagnostic,
            stale,
          );
          for (const reason of candidate.reasons) reasons.add(reason);
          addCandidate(candidate);
        }
      }
    } else {
      if (!Array.isArray(value) || (value.length > 0 && isDiagnosticTuple(value[0]))) {
        throw new InvalidDiagnosticsOutputError();
      }
      const canonical = snapshot.target;
      if (canonical === undefined) throw new InvalidDiagnosticsOutputError();
      const document = snapshot.targetDocument;
      for (const diagnostic of value) {
        this.#assertOpen(signal, snapshot.generation);
        const candidate = this.#normalizeDiagnosticSafe(
          snapshot,
          canonical,
          document,
          diagnostic,
          stale,
        );
        for (const reason of candidate.reasons) reasons.add(reason);
        addCandidate(candidate);
      }
      sawProviderResource = true;
      sawInWorkspaceResource = true;
    }

    if (overflowed) reasons.add("entries");
    candidates.sort(compareCandidates);

    const budget = new DiagnosticBudget();
    const accepted: NormalizedCandidate[] = [];
    const firstSource = candidates[0]?.source;
    const topLevelSourceValues =
      firstSource === undefined
        ? sourceAggregateValues(this.#resultSource(snapshot, candidates, stale, false, new Set()))
        : sourceAggregateValues(firstSource);
    if (budget.fit(topLevelSourceValues) !== undefined) {
      for (const candidate of candidates) {
        this.#assertOpen(signal, snapshot.generation);
        if (budget.fit(candidate.aggregateValues) === undefined) break;
        accepted.push(candidate);
      }
    }
    for (const reason of budget.takeReasons) reasons.add(reason);
    this.#assertOpen(signal, snapshot.generation);
    this.#assertSnapshotIdentity(snapshot, true);

    return {
      candidates: accepted,
      reasons,
      overflowed,
      outsideCount,
      sawProviderResource,
      sawInWorkspaceResource,
    };
  }

  async #validateProviderUri(snapshot: QuerySnapshot, uri: Uri, signal: AbortSignal): Promise<Uri> {
    try {
      if (!isUriLike(uri)) throw new InvalidDiagnosticsOutputError();
      const scope = this.#dependencies.createScope(snapshot.root);
      const canonical = await scope.validate(uri, signal);
      this.#assertOpen(signal, snapshot.generation);
      return canonical;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof DiagnosticsUnavailableError) throw error;
      if (error instanceof WorkspaceScopeError && error.code === "outside-workspace") {
        throw new OutsideWorkspaceError();
      }
      if (error instanceof OutsideWorkspaceError) throw error;
      throw new InvalidDiagnosticsOutputError();
    }
  }

  #normalizeDiagnostic(
    snapshot: QuerySnapshot,
    uri: Uri,
    document: TextDocument | undefined,
    diagnostic: Diagnostic,
    stale: boolean,
  ): NormalizedCandidate & { readonly reasons: readonly IdeTruncationReason[] } {
    if (!isRecord(diagnostic)) throw new InvalidDiagnosticsOutputError();
    const range = normalizeRange(diagnostic.range, document);
    const severity = mapSeverity(diagnostic.severity);
    if (severity === undefined || typeof diagnostic.message !== "string") {
      throw new InvalidDiagnosticsOutputError();
    }
    const message = takeBoundedText(
      diagnostic.message,
      maxIdeDiagnosticMessageCodePoints,
      maxIdeDiagnosticMessageBytes,
    );
    const code = normalizeDiagnosticCode(diagnostic.code);
    const origin = normalizeDiagnosticOrigin(diagnostic.source);
    const codeProjection =
      code === undefined
        ? undefined
        : takeBoundedText(code, maxIdeDiagnosticLabelCodePoints, maxIdeDiagnosticLabelBytes);
    const originProjection =
      origin === undefined
        ? undefined
        : takeBoundedText(origin, maxIdeDiagnosticLabelCodePoints, maxIdeDiagnosticLabelBytes);

    const source = this.#sourceForUri(snapshot, uri, range, stale, document);
    const textValues = [
      source.uri.scheme,
      source.uri.authority,
      source.uri.path,
      ...(source.languageId === undefined ? [] : [source.languageId]),
      message.text,
      ...(codeProjection === undefined ? [] : [codeProjection.text]),
      ...(originProjection === undefined ? [] : [originProjection.text]),
    ];
    const reasons = [
      ...message.reasons,
      ...(codeProjection?.reasons ?? []),
      ...(originProjection?.reasons ?? []),
    ];
    const diagnosticSource = source;
    const projected = {
      source: diagnosticSource,
      severity,
      message: message.text,
      ...(codeProjection === undefined ? {} : { code: codeProjection.text }),
      ...(originProjection === undefined ? {} : { origin: originProjection.text }),
    } satisfies IdeDiagnosticDto;
    return {
      source: diagnosticSource,
      diagnostic: projected,
      aggregateValues: textValues,
      reasons: [...new Set(reasons)],
    };
  }

  #normalizeDiagnosticSafe(
    snapshot: QuerySnapshot,
    uri: Uri,
    document: TextDocument | undefined,
    diagnostic: Diagnostic,
    stale: boolean,
  ): NormalizedCandidate & { readonly reasons: readonly IdeTruncationReason[] } {
    try {
      return this.#normalizeDiagnostic(snapshot, uri, document, diagnostic, stale);
    } catch (error) {
      if (error instanceof InvalidDiagnosticsOutputError) throw error;
      throw new InvalidDiagnosticsOutputError();
    }
  }

  #sourceForUri(
    snapshot: QuerySnapshot,
    uri: Uri,
    range: IdeRangeDto,
    stale: boolean,
    document: TextDocument | undefined,
  ): IdeSourceDto {
    const root = snapshot.canonicalRoot;
    const path = toWorkspaceRelativePath(root, uri);
    const languageId = document === undefined ? undefined : readLanguageId(document);
    const version =
      snapshot.target !== undefined && sameUri(uri, snapshot.target)
        ? snapshot.targetVersion
        : document === undefined
          ? undefined
          : readDocumentVersion(document);
    return {
      uri: {
        scheme: boundedRequired(uri.scheme, maxIdeUriSchemeCodePoints, maxIdeUriSchemeBytes),
        authority: uri.authority.length === 0 ? "" : "workspace",
        path: boundedRequired(path, maxIdeUriPathCodePoints, maxIdeUriPathBytes),
      },
      range,
      ...(languageId === undefined ? {} : { languageId }),
      ...(version === undefined ? {} : { documentVersion: version }),
      stale,
      truncated: false,
    };
  }

  #resultSource(
    snapshot: QuerySnapshot,
    candidates: readonly NormalizedCandidate[],
    stale: boolean,
    truncated: boolean,
    reasons: ReadonlySet<IdeTruncationReason>,
  ): IdeSourceDto {
    const first = candidates[0]?.source;
    if (first !== undefined) {
      const { range: _range, truncationReasons: _sourceReasons, ...base } = first;
      return {
        ...base,
        stale,
        truncated,
        ...(truncated ? { truncationReasons: [...orderedReasons(reasons)] } : {}),
      };
    }
    if (snapshot.target !== undefined) {
      const source = this.#sourceForUri(
        snapshot,
        snapshot.target,
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        stale,
        snapshot.targetDocument,
      );
      return {
        uri: source.uri,
        ...(source.languageId === undefined ? {} : { languageId: source.languageId }),
        ...(source.documentVersion === undefined
          ? {}
          : { documentVersion: source.documentVersion }),
        stale,
        truncated,
        ...(truncated ? { truncationReasons: [...orderedReasons(reasons)] } : {}),
      };
    }
    return {
      uri: {
        scheme: boundedRequired(
          snapshot.canonicalRoot.scheme,
          maxIdeUriSchemeCodePoints,
          maxIdeUriSchemeBytes,
        ),
        authority: snapshot.canonicalRoot.authority.length === 0 ? "" : "workspace",
        path: "workspace",
      },
      stale,
      truncated,
      ...(truncated ? { truncationReasons: [...orderedReasons(reasons)] } : {}),
    };
  }

  #readStale(snapshot: QuerySnapshot): boolean {
    this.#assertSnapshotIdentity(snapshot, true);
    const document = snapshot.editor === undefined ? snapshot.targetDocument : snapshot.document;
    if (document === undefined) return false;
    const currentVersion = readDocumentVersion(document);
    if (currentVersion === undefined) throw new DiagnosticsUnavailableError();
    return currentVersion !== snapshot.targetVersion;
  }

  #assertSnapshotIdentity(snapshot: QuerySnapshot, allowDocumentChange = false): void {
    if (snapshot.generation !== this.#generation || this.#disposed) {
      throw new DiagnosticsUnavailableError();
    }
    const root = this.#dependencies.getSelectedRoot();
    if (root === undefined || !sameUri(root, snapshot.root)) {
      throw new DiagnosticsUnavailableError();
    }
    const trusted = this.#dependencies.isTrusted?.();
    if (trusted !== snapshot.trusted || this.#dependencies.isEnabled?.() === false) {
      throw new DiagnosticsUnavailableError();
    }
    if (snapshot.editor === undefined || snapshot.document === undefined) return;
    const editor = this.#dependencies.getActiveEditor();
    if (
      editor === undefined ||
      editor !== snapshot.editor ||
      editor.document !== snapshot.document ||
      snapshot.documentUri === undefined ||
      !sameUri(editor.document.uri, snapshot.documentUri)
    ) {
      throw new DiagnosticsUnavailableError();
    }
    if (!allowDocumentChange && readDocumentVersion(editor.document) !== snapshot.targetVersion) {
      throw new DiagnosticsUnavailableError();
    }
  }

  #assertOpen(signal: AbortSignal, generation = this.#generation): void {
    signal.throwIfAborted();
    if (
      this.#disposed ||
      generation !== this.#generation ||
      this.#dependencies.isEnabled?.() === false
    ) {
      throw new DiagnosticsUnavailableError();
    }
  }
}

class OutsideWorkspaceError extends Error {}

class DiagnosticBudget {
  #codePoints = 0;
  #bytes = 0;
  readonly takeReasons = new Set<IdeTruncationReason>();

  fit(values: readonly string[]): readonly string[] | undefined {
    const codePoints = values.reduce((sum, value) => sum + countCodePoints(value), 0);
    const bytes = values.reduce((sum, value) => sum + utf8ByteLength(value), 0);
    if (
      this.#codePoints + codePoints > maxIdeDiagnosticAggregateCodePoints ||
      this.#bytes + bytes > maxIdeDiagnosticAggregateBytes
    ) {
      if (this.#codePoints + codePoints > maxIdeDiagnosticAggregateCodePoints) {
        this.takeReasons.add("code-points");
      }
      if (this.#bytes + bytes > maxIdeDiagnosticAggregateBytes) this.takeReasons.add("utf8-bytes");
      return undefined;
    }
    this.#codePoints += codePoints;
    this.#bytes += bytes;
    return values;
  }
}

function normalizeRange(value: unknown, document: TextDocument | undefined): IdeRangeDto {
  if (!isRecord(value) || !isPosition(value.start) || !isPosition(value.end)) {
    throw new InvalidDiagnosticsOutputError();
  }
  if (document === undefined) throw new InvalidDiagnosticsOutputError();
  const range = {
    start: value.start,
    end: value.end,
  } as IdeRangeDto;
  if (ideSourceProjector.comparePositions(range.start, range.end) > 0) {
    throw new InvalidDiagnosticsOutputError();
  }
  validateDocumentPosition(document, range.start);
  validateDocumentPosition(document, range.end);
  return range;
}

function isPosition(value: unknown): value is IdePositionDto {
  return ideSourceProjector.isPosition(value);
}

function validateDocumentPosition(document: TextDocument, position: IdePositionDto): void {
  let line: { readonly text: string };
  try {
    line = document.lineAt(position.line);
  } catch {
    throw new InvalidDiagnosticsOutputError();
  }
  try {
    ideSourceProjector.validateDocumentPosition(document.lineCount, line.text, position);
  } catch (error) {
    if (error instanceof IdeSourceProjectionError) {
      throw new InvalidDiagnosticsOutputError();
    }
    throw error;
  }
}

function takeBoundedText(value: string, maxCodePoints: number, maxBytes: number): BoundedText {
  try {
    return ideSourceProjector.takeBoundedText(value, maxCodePoints, maxBytes);
  } catch (error) {
    if (error instanceof IdeSourceProjectionError) {
      throw new InvalidDiagnosticsOutputError();
    }
    throw error;
  }
}

function boundedRequired(value: string, maxCodePoints: number, maxBytes: number): string {
  try {
    return ideSourceProjector.boundedRequired(value, maxCodePoints, maxBytes);
  } catch (error) {
    if (error instanceof IdeSourceProjectionError) {
      throw new InvalidDiagnosticsOutputError();
    }
    throw error;
  }
}

function sameUri(left: Uri, right: Uri): boolean {
  return ideSourceProjector.sameUri(left, right);
}

function toWorkspaceRelativePath(root: Uri, target: Uri): string {
  try {
    return ideSourceProjector.toWorkspaceRelativePath(root, target);
  } catch (error) {
    if (error instanceof IdeSourceProjectionError) {
      throw new InvalidDiagnosticsOutputError();
    }
    throw error;
  }
}

function countCodePoints(value: string): number {
  try {
    return ideSourceProjector.countCodePoints(value);
  } catch (error) {
    if (error instanceof IdeSourceProjectionError) {
      throw new InvalidDiagnosticsOutputError();
    }
    throw error;
  }
}

function utf8ByteLength(value: string): number {
  try {
    return ideSourceProjector.utf8ByteLength(value);
  } catch (error) {
    if (error instanceof IdeSourceProjectionError) {
      throw new InvalidDiagnosticsOutputError();
    }
    throw error;
  }
}

function orderedReasons(reasons: Iterable<IdeTruncationReason>): readonly IdeTruncationReason[] {
  return ideSourceProjector.orderedReasons(reasons);
}

function compareOptionalRanges(
  left: IdeRangeDto | undefined,
  right: IdeRangeDto | undefined,
): number {
  return ideSourceProjector.compareOptionalRanges(left, right);
}

function compareOptionalStrings(left: string | undefined, right: string | undefined): number {
  return ideSourceProjector.compareOptionalStrings(left, right);
}

function compareStrings(left: string, right: string): number {
  return ideSourceProjector.compareStrings(left, right);
}

function mapSeverity(value: unknown): IdeDiagnosticDto["severity"] | undefined {
  return value === 0
    ? "error"
    : value === 1
      ? "warning"
      : value === 2
        ? "information"
        : value === 3
          ? "hint"
          : undefined;
}

function normalizeDiagnosticCode(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidDiagnosticsOutputError();
    return String(value);
  }
  if (isRecord(value)) {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 2 ||
      !Object.hasOwn(value, "target") ||
      !Object.hasOwn(value, "value") ||
      !isUriLike(value.target)
    ) {
      throw new InvalidDiagnosticsOutputError();
    }
    if (typeof value.value === "number" && !Number.isFinite(value.value)) {
      throw new InvalidDiagnosticsOutputError();
    }
    if (typeof value.value === "string" || typeof value.value === "number") {
      return String(value.value);
    }
  }
  throw new InvalidDiagnosticsOutputError();
}

function normalizeDiagnosticOrigin(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new InvalidDiagnosticsOutputError();
  return value;
}

function readDocumentVersion(document: TextDocument): number | undefined {
  return Number.isSafeInteger(document.version) && document.version >= 0
    ? document.version
    : undefined;
}

function readLanguageId(document: TextDocument): string | undefined {
  return typeof document.languageId === "string" && document.languageId.length > 0
    ? readBoundedLanguageId(document.languageId)
    : undefined;
}

function readBoundedLanguageId(value: string): string {
  const projection = takeBoundedText(value, maxIdeLanguageIdCodePoints, maxIdeLanguageIdBytes);
  if (projection.truncated) throw new InvalidDiagnosticsOutputError();
  return projection.text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUriLike(value: unknown): value is Uri {
  return (
    isRecord(value) &&
    typeof value.scheme === "string" &&
    typeof value.authority === "string" &&
    typeof value.path === "string" &&
    typeof value.query === "string" &&
    typeof value.fragment === "string"
  );
}

function isDiagnosticTuple(value: unknown): value is readonly [Uri, readonly Diagnostic[]] {
  return (
    Array.isArray(value) && value.length === 2 && isUriLike(value[0]) && Array.isArray(value[1])
  );
}

function candidateKey(candidate: NormalizedCandidate): string {
  return JSON.stringify({ source: candidate.source, diagnostic: candidate.diagnostic });
}

function sourceAggregateValues(source: IdeSourceDto): readonly string[] {
  return [
    source.uri.scheme,
    source.uri.authority,
    source.uri.path,
    ...(source.languageId === undefined ? [] : [source.languageId]),
  ];
}

function compareCandidates(left: NormalizedCandidate, right: NormalizedCandidate): number {
  const leftSource = left.source;
  const rightSource = right.source;
  return (
    compareStrings(leftSource.uri.scheme, rightSource.uri.scheme) ||
    compareStrings(leftSource.uri.authority, rightSource.uri.authority) ||
    compareStrings(leftSource.uri.path, rightSource.uri.path) ||
    compareOptionalRanges(leftSource.range, rightSource.range) ||
    compareNumbers(
      severityOrder(left.diagnostic.severity),
      severityOrder(right.diagnostic.severity),
    ) ||
    compareStrings(left.diagnostic.message, right.diagnostic.message) ||
    compareOptionalStrings(left.diagnostic.code, right.diagnostic.code) ||
    compareOptionalStrings(left.diagnostic.origin, right.diagnostic.origin) ||
    compareOptionalStrings(leftSource.languageId, rightSource.languageId) ||
    compareOptionalNumbers(leftSource.documentVersion, rightSource.documentVersion) ||
    compareNumbers(Number(leftSource.stale), Number(rightSource.stale)) ||
    compareNumbers(Number(leftSource.truncated), Number(rightSource.truncated)) ||
    compareStrings(candidateKey(left), candidateKey(right))
  );
}

function severityOrder(value: IdeDiagnosticDto["severity"]): number {
  return value === "error" ? 0 : value === "warning" ? 1 : value === "information" ? 2 : 3;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return compareNumbers(left, right);
}
