import type {
  IdeLanguageServicePort,
  LanguageServiceInput,
  ListSymbolsInput,
} from "@ctrl-zebra/builtin-tools";
import {
  InvalidLanguageServiceOutputError,
  LanguageServiceUnavailableError,
} from "@ctrl-zebra/builtin-tools";
import {
  type IdeLanguageLocationDto,
  type IdeLanguageLocationsResultDto,
  type IdePositionDto,
  type IdeRangeDto,
  type IdeSourceDto,
  type IdeSymbolDto,
  type IdeSymbolsResultDto,
  type IdeTruncationReason,
  ideLanguageLocationsResultSchema,
  ideSymbolsResultSchema,
  maxIdeDiagnosticAggregateBytes,
  maxIdeDiagnosticAggregateCodePoints,
  maxIdeDiagnosticLabelBytes,
  maxIdeDiagnosticLabelCodePoints,
  maxIdeLanguageLocationEntries,
  maxIdePositionCharacter,
  maxIdePositionLine,
  maxIdeSymbolEntries,
  maxIdeUriPathBytes,
  maxIdeUriPathCodePoints,
  maxIdeUriSchemeBytes,
  maxIdeUriSchemeCodePoints,
} from "@ctrl-zebra/protocol";
import type { TextDocument, Uri } from "vscode";

import type { WorkspaceScope } from "./workspace-scope.js";
import { WorkspaceScopeError } from "./workspace-scope.js";

export {
  InvalidLanguageServiceOutputError,
  LanguageServiceUnavailableError,
} from "@ctrl-zebra/builtin-tools";

type LanguageOperation = "definition" | "references";

// Provider trees are untrusted. These bounds cap traversal work separately from
// the 256-entry output budget while preserving deterministic depth-first order.
const maxDocumentSymbolTraversalNodes = 4_096;
const maxDocumentSymbolTraversalDepth = 512;

interface LocationCollection {
  readonly locations: readonly IdeLanguageLocationDto[];
  readonly reasons: ReadonlySet<IdeTruncationReason>;
  readonly outsideCount: number;
  readonly sawProviderResource: boolean;
  readonly sawInWorkspaceResource: boolean;
}

interface QuerySnapshot {
  readonly generation: number;
  readonly root: Uri;
  readonly canonicalRoot: Uri;
  readonly target: Uri;
  readonly targetDocument?: TextDocument;
  readonly targetVersion?: number;
  readonly trusted: boolean | undefined;
}

interface BoundedText {
  readonly text: string;
  readonly truncated: boolean;
  readonly reasons: readonly IdeTruncationReason[];
}

interface SymbolCandidate {
  readonly symbol: IdeSymbolDto;
  readonly aggregateValues: readonly string[];
  readonly reasons: readonly IdeTruncationReason[];
}

interface NormalizedSymbol {
  readonly candidate?: SymbolCandidate;
  readonly children: readonly unknown[];
  readonly parentName?: string;
  readonly providerResource: boolean;
  readonly inWorkspaceResource: boolean;
}

interface SymbolTraversalEnterFrame {
  readonly phase: "enter";
  readonly value: unknown;
  readonly parentName?: string;
  readonly depth: number;
}

interface SymbolTraversalExitFrame {
  readonly phase: "exit";
  readonly value: object;
}

type SymbolTraversalFrame = SymbolTraversalEnterFrame | SymbolTraversalExitFrame;

export interface VsCodeLanguageServicesDependencies {
  readonly getSelectedRoot: () => Uri | undefined;
  readonly createScope: (root: Uri) => Pick<WorkspaceScope, "validate">;
  readonly joinPath: (root: Uri, path: string) => Uri;
  readonly getDocument?: (uri: Uri) => TextDocument | undefined;
  readonly executeDefinitionProvider: (
    uri: Uri,
    position: IdePositionDto,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly executeReferenceProvider: (
    uri: Uri,
    position: IdePositionDto,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly executeDocumentSymbolProvider: (uri: Uri, signal: AbortSignal) => Promise<unknown>;
  readonly isEnabled?: () => boolean;
  readonly isTrusted?: () => boolean;
}

/**
 * Projects VS Code's read-only language providers into bounded Protocol DTOs.
 * Provider calls are intentionally uncached: each Tool call observes the current host state.
 */
export class VsCodeLanguageServices implements IdeLanguageServicePort {
  readonly #dependencies: VsCodeLanguageServicesDependencies;
  #disposed = false;
  #generation = 0;

  constructor(dependencies: VsCodeLanguageServicesDependencies) {
    this.#dependencies = dependencies;
  }

  async findDefinition(
    input: LanguageServiceInput,
    signal: AbortSignal,
  ): Promise<IdeLanguageLocationsResultDto> {
    return this.#findLocations("definition", input, signal);
  }

  async findReferences(
    input: LanguageServiceInput,
    signal: AbortSignal,
  ): Promise<IdeLanguageLocationsResultDto> {
    return this.#findLocations("references", input, signal);
  }

  async listSymbols(input: ListSymbolsInput, signal: AbortSignal): Promise<IdeSymbolsResultDto> {
    const generation = this.#generation;
    const snapshot = await this.#capture(input.path, signal, generation);
    if (snapshot.targetDocument === undefined) {
      throw new LanguageServiceUnavailableError();
    }
    const value = await this.#readProvider(
      () => this.#dependencies.executeDocumentSymbolProvider(snapshot.target, signal),
      snapshot,
      signal,
    );
    const stale = this.#readStale(snapshot);
    const collected = await this.#collectSymbols(snapshot, value, stale, signal);
    this.#assertOpen(signal, snapshot.generation);
    this.#assertSnapshotIdentity(snapshot, true);

    const reasons = new Set<IdeTruncationReason>(collected.reasons);
    if (collected.outsideCount > 0) reasons.add("out-of-workspace");
    if (collected.sawProviderResource && !collected.sawInWorkspaceResource) {
      throw new InvalidLanguageServiceOutputError();
    }
    const truncated = reasons.size > 0;
    const source = this.#sourceForUri(
      snapshot,
      snapshot.target,
      stale,
      truncated,
      reasons,
      snapshot.targetDocument,
    );
    const result = ideSymbolsResultSchema.safeParse({
      kind: "symbols",
      source,
      symbols: collected.symbols,
      stale,
      truncated,
      ...(truncated ? { truncationReasons: [...orderedReasons(reasons)] } : {}),
    });
    if (!result.success) throw new InvalidLanguageServiceOutputError();
    this.#assertOpen(signal, snapshot.generation);
    this.#assertSnapshotIdentity(snapshot, true);
    return result.data;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
  }

  async #findLocations(
    operation: LanguageOperation,
    input: LanguageServiceInput,
    signal: AbortSignal,
  ): Promise<IdeLanguageLocationsResultDto> {
    const generation = this.#generation;
    const snapshot = await this.#capture(input.path, signal, generation, input.position);
    const execute =
      operation === "definition"
        ? this.#dependencies.executeDefinitionProvider
        : this.#dependencies.executeReferenceProvider;
    const value = await this.#readProvider(
      () => execute(snapshot.target, input.position, signal),
      snapshot,
      signal,
    );
    const stale = this.#readStale(snapshot);
    const collected = await this.#collectLocations(operation, snapshot, value, stale, signal);
    this.#assertOpen(signal, snapshot.generation);
    this.#assertSnapshotIdentity(snapshot, true);

    const reasons = new Set<IdeTruncationReason>(collected.reasons);
    if (collected.outsideCount > 0) reasons.add("out-of-workspace");
    if (collected.sawProviderResource && !collected.sawInWorkspaceResource) {
      throw new InvalidLanguageServiceOutputError();
    }
    const truncated = reasons.size > 0;
    const source = this.#sourceForUri(
      snapshot,
      snapshot.target,
      stale,
      truncated,
      reasons,
      snapshot.targetDocument,
    );
    const result = ideLanguageLocationsResultSchema.safeParse({
      kind: "language-locations",
      operation,
      source,
      locations: collected.locations,
      stale,
      truncated,
      ...(truncated ? { truncationReasons: [...orderedReasons(reasons)] } : {}),
    });
    if (!result.success) throw new InvalidLanguageServiceOutputError();
    this.#assertOpen(signal, snapshot.generation);
    this.#assertSnapshotIdentity(snapshot, true);
    return result.data;
  }

  async #capture(
    path: string,
    signal: AbortSignal,
    generation: number,
    position?: IdePositionDto,
  ): Promise<QuerySnapshot> {
    this.#assertOpen(signal, generation);
    const root = this.#dependencies.getSelectedRoot();
    if (root === undefined) throw new LanguageServiceUnavailableError();
    const trusted = this.#dependencies.isTrusted?.();
    let scope: Pick<WorkspaceScope, "validate">;
    try {
      scope = this.#dependencies.createScope(root);
    } catch {
      throw new LanguageServiceUnavailableError();
    }

    let canonicalRoot: Uri;
    let target: Uri;
    try {
      canonicalRoot = await scope.validate(root, signal);
      signal.throwIfAborted();
      target = await scope.validate(this.#dependencies.joinPath(root, path), signal);
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof LanguageServiceUnavailableError) throw error;
      throw new LanguageServiceUnavailableError();
    }

    const targetDocument = this.#dependencies.getDocument?.(target);
    if (targetDocument === undefined) {
      throw new LanguageServiceUnavailableError();
    }
    const targetVersion =
      targetDocument === undefined ? undefined : readDocumentVersion(targetDocument);
    if (targetDocument !== undefined && targetVersion === undefined) {
      throw new LanguageServiceUnavailableError();
    }
    if (position !== undefined && targetDocument !== undefined) {
      validateDocumentPosition(targetDocument, position);
    }
    const snapshot = {
      generation,
      root,
      canonicalRoot,
      target,
      targetDocument,
      targetVersion,
      trusted,
    } satisfies QuerySnapshot;
    this.#assertOpen(signal, generation);
    this.#assertSnapshotIdentity(snapshot);
    return snapshot;
  }

  async #readProvider(
    read: () => Promise<unknown>,
    snapshot: QuerySnapshot,
    signal: AbortSignal,
  ): Promise<unknown> {
    this.#assertOpen(signal, snapshot.generation);
    let value: unknown;
    try {
      value = await read();
    } catch (error) {
      signal.throwIfAborted();
      if (
        error instanceof LanguageServiceUnavailableError ||
        error instanceof InvalidLanguageServiceOutputError
      ) {
        throw error;
      }
      throw new LanguageServiceUnavailableError();
    }
    signal.throwIfAborted();
    this.#assertOpen(signal, snapshot.generation);
    this.#assertSnapshotIdentity(snapshot, true);
    if (value === undefined) throw new LanguageServiceUnavailableError();
    return value;
  }

  async #collectLocations(
    operation: LanguageOperation,
    snapshot: QuerySnapshot,
    value: unknown,
    stale: boolean,
    signal: AbortSignal,
  ): Promise<LocationCollection> {
    if (!Array.isArray(value)) throw new InvalidLanguageServiceOutputError();
    const locations: IdeLanguageLocationDto[] = [];
    const reasons = new Set<IdeTruncationReason>();
    let outsideCount = 0;
    const sawProviderResource = value.length > 0;
    let sawInWorkspaceResource = false;
    let aggregateCodePoints = 0;
    let aggregateBytes = 0;
    const topSource = this.#sourceForUri(
      snapshot,
      snapshot.target,
      stale,
      false,
      new Set(),
      snapshot.targetDocument,
    );
    for (const text of sourceStrings(topSource)) {
      aggregateCodePoints += countCodePoints(text);
      aggregateBytes += utf8ByteLength(text);
    }

    const retained = new Map<string, IdeLanguageLocationDto>();
    let overflowed = false;
    for (const valueItem of value) {
      this.#assertOpen(signal, snapshot.generation);
      const normalized = await this.#normalizeLocation(
        operation,
        snapshot,
        valueItem,
        stale,
        signal,
      );
      if (normalized === undefined) {
        outsideCount += 1;
        continue;
      }
      sawInWorkspaceResource = true;
      const key = locationKey(normalized);
      if (retained.has(key)) continue;
      retained.set(key, normalized);
      if (retained.size > maxIdeLanguageLocationEntries) {
        overflowed = true;
        const worst = [...retained.entries()].sort((left, right) =>
          compareLocations(right[1], left[1]),
        )[0];
        if (worst !== undefined) retained.delete(worst[0]);
      }
    }

    if (overflowed) reasons.add("entries");
    const sortedLocations = [...retained.values()].sort(compareLocations);
    for (const normalized of sortedLocations) {
      const candidateValues = sourceStrings(normalized.source);
      const candidateCodePoints = candidateValues.reduce(
        (total, text) => total + countCodePoints(text),
        0,
      );
      const candidateBytes = candidateValues.reduce(
        (total, text) => total + utf8ByteLength(text),
        0,
      );
      if (
        aggregateCodePoints + candidateCodePoints > maxIdeDiagnosticAggregateCodePoints ||
        aggregateBytes + candidateBytes > maxIdeDiagnosticAggregateBytes
      ) {
        if (aggregateCodePoints + candidateCodePoints > maxIdeDiagnosticAggregateCodePoints) {
          reasons.add("code-points");
        }
        if (aggregateBytes + candidateBytes > maxIdeDiagnosticAggregateBytes) {
          reasons.add("utf8-bytes");
        }
        continue;
      }
      aggregateCodePoints += candidateCodePoints;
      aggregateBytes += candidateBytes;
      locations.push(normalized);
    }

    return {
      locations,
      reasons,
      outsideCount,
      sawProviderResource,
      sawInWorkspaceResource,
    };
  }

  async #normalizeLocation(
    operation: LanguageOperation,
    snapshot: QuerySnapshot,
    value: unknown,
    stale: boolean,
    signal: AbortSignal,
  ): Promise<IdeLanguageLocationDto | undefined> {
    if (!isRecord(value)) throw new InvalidLanguageServiceOutputError();
    const hasTargetUri = Object.hasOwn(value, "targetUri");
    const hasTargetRange = Object.hasOwn(value, "targetRange");
    const hasUri = Object.hasOwn(value, "uri");
    const hasRange = Object.hasOwn(value, "range");
    let uri: unknown;
    let range: unknown;
    let selectionRange: unknown;
    if (hasTargetUri || hasTargetRange) {
      if (operation !== "definition" || !hasTargetUri || !hasTargetRange || hasUri || hasRange) {
        throw new InvalidLanguageServiceOutputError();
      }
      uri = value.targetUri;
      range = value.targetRange;
      selectionRange = value.targetSelectionRange;
    } else {
      if (!hasUri || !hasRange) throw new InvalidLanguageServiceOutputError();
      uri = value.uri;
      range = value.range;
    }
    if (!isUriLike(uri)) throw new InvalidLanguageServiceOutputError();

    assertProviderUriShape(uri);
    const normalizedRange = normalizeRangeShape(range);
    const normalizedSelectionRange =
      selectionRange === undefined ? undefined : normalizeRangeShape(selectionRange);
    const providerDocument = this.#dependencies.getDocument?.(uri);
    if (providerDocument !== undefined) {
      validateRangeDocument(normalizedRange, providerDocument);
      if (normalizedSelectionRange !== undefined) {
        validateRangeDocument(normalizedSelectionRange, providerDocument);
      }
    }

    let canonical: Uri;
    try {
      canonical = await this.#validateProviderUri(snapshot, uri, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof OutsideWorkspaceError) return undefined;
      throw error;
    }
    const canonicalDocument = this.#dependencies.getDocument?.(canonical);
    if (canonicalDocument === undefined) throw new InvalidLanguageServiceOutputError();
    validateRangeDocument(normalizedRange, canonicalDocument);
    if (normalizedSelectionRange !== undefined) {
      validateRangeDocument(normalizedSelectionRange, canonicalDocument);
    }
    const source = this.#sourceForUri(
      snapshot,
      canonical,
      stale,
      false,
      new Set(),
      canonicalDocument,
    );
    return {
      source,
      range: normalizedRange,
      kind: operation === "definition" ? "definition" : "reference",
    };
  }

  async #collectSymbols(
    snapshot: QuerySnapshot,
    value: unknown,
    stale: boolean,
    signal: AbortSignal,
  ): Promise<{
    readonly symbols: readonly IdeSymbolDto[];
    readonly reasons: ReadonlySet<IdeTruncationReason>;
    readonly outsideCount: number;
    readonly sawProviderResource: boolean;
    readonly sawInWorkspaceResource: boolean;
  }> {
    if (!Array.isArray(value)) throw new InvalidLanguageServiceOutputError();
    const stack: SymbolTraversalFrame[] = [];
    const rootCount = Math.min(value.length, maxDocumentSymbolTraversalNodes);
    for (let index = rootCount - 1; index >= 0; index -= 1) {
      stack.push({ phase: "enter", value: value[index], depth: 0 });
    }
    const candidates = new Map<string, SymbolCandidate>();
    const reasons = new Set<IdeTruncationReason>();
    if (value.length > rootCount) reasons.add("entries");
    let outsideCount = 0;
    let sawProviderResource = value.length > 0;
    let sawInWorkspaceResource = false;
    let aggregateCodePoints = 0;
    let aggregateBytes = 0;
    const source = this.#sourceForUri(
      snapshot,
      snapshot.target,
      stale,
      false,
      new Set(),
      snapshot.targetDocument,
    );
    for (const text of sourceStrings(source)) {
      aggregateCodePoints += countCodePoints(text);
      aggregateBytes += utf8ByteLength(text);
    }

    const active = new WeakSet<object>();
    let traversedNodes = 0;
    while (stack.length > 0) {
      this.#assertOpen(signal, snapshot.generation);
      const entry = stack.pop();
      if (entry === undefined) continue;
      if (entry.phase === "exit") {
        active.delete(entry.value);
        continue;
      }
      if (entry.depth > maxDocumentSymbolTraversalDepth) {
        reasons.add("entries");
        break;
      }
      if (traversedNodes >= maxDocumentSymbolTraversalNodes) {
        reasons.add("entries");
        break;
      }
      if (!isRecord(entry.value)) throw new InvalidLanguageServiceOutputError();
      if (active.has(entry.value)) throw new InvalidLanguageServiceOutputError();
      active.add(entry.value);
      traversedNodes += 1;
      const normalized = await this.#normalizeSymbol(
        snapshot,
        entry.value,
        entry.parentName,
        signal,
      );
      if (normalized === undefined) {
        outsideCount += 1;
        active.delete(entry.value);
        continue;
      }
      sawProviderResource ||= normalized.providerResource;
      sawInWorkspaceResource ||= normalized.inWorkspaceResource;
      if (normalized.candidate !== undefined) {
        const candidate = normalized.candidate;
        for (const reason of candidate.reasons) reasons.add(reason);
        const key = symbolKey(candidate.symbol);
        if (!candidates.has(key)) candidates.set(key, candidate);
      }
      stack.push({ phase: "exit", value: entry.value });
      if (normalized.children.length === 0) continue;
      if (entry.depth >= maxDocumentSymbolTraversalDepth) {
        reasons.add("entries");
        continue;
      }
      const remainingNodes = maxDocumentSymbolTraversalNodes - traversedNodes;
      const childCount = Math.min(normalized.children.length, Math.max(remainingNodes, 0));
      if (childCount < normalized.children.length) reasons.add("entries");
      for (let index = childCount - 1; index >= 0; index -= 1) {
        stack.push({
          phase: "enter",
          value: normalized.children[index],
          parentName: normalized.parentName,
          depth: entry.depth + 1,
        });
      }
    }

    const sortedCandidates = [...candidates.values()].sort(compareSymbolCandidates);
    if (sortedCandidates.length > maxIdeSymbolEntries) reasons.add("entries");
    const symbols: IdeSymbolDto[] = [];
    for (const candidate of sortedCandidates.slice(0, maxIdeSymbolEntries)) {
      const candidateCodePoints = candidate.aggregateValues.reduce(
        (total, text) => total + countCodePoints(text),
        0,
      );
      const candidateBytes = candidate.aggregateValues.reduce(
        (total, text) => total + utf8ByteLength(text),
        0,
      );
      if (
        aggregateCodePoints + candidateCodePoints > maxIdeDiagnosticAggregateCodePoints ||
        aggregateBytes + candidateBytes > maxIdeDiagnosticAggregateBytes
      ) {
        if (aggregateCodePoints + candidateCodePoints > maxIdeDiagnosticAggregateCodePoints) {
          reasons.add("code-points");
        }
        if (aggregateBytes + candidateBytes > maxIdeDiagnosticAggregateBytes) {
          reasons.add("utf8-bytes");
        }
        continue;
      }
      aggregateCodePoints += candidateCodePoints;
      aggregateBytes += candidateBytes;
      symbols.push(candidate.symbol);
    }

    return {
      symbols,
      reasons,
      outsideCount,
      sawProviderResource,
      sawInWorkspaceResource,
    };
  }

  async #normalizeSymbol(
    snapshot: QuerySnapshot,
    value: Record<string, unknown>,
    parentName: string | undefined,
    signal: AbortSignal,
  ): Promise<NormalizedSymbol | undefined> {
    const name = normalizeSymbolText(value.name);
    const kind = mapSymbolKind(value.kind);
    if (name === undefined || kind === undefined) throw new InvalidLanguageServiceOutputError();

    if (Object.hasOwn(value, "location")) {
      const location = value.location;
      if (!isRecord(location) || !isUriLike(location.uri)) {
        throw new InvalidLanguageServiceOutputError();
      }
      assertProviderUriShape(location.uri);
      const range = normalizeRangeShape(location.range);
      const providerDocument = this.#dependencies.getDocument?.(location.uri);
      if (providerDocument !== undefined) validateRangeDocument(range, providerDocument);
      const containerName = normalizeOptionalSymbolText(value.containerName);
      if (containerName === null) throw new InvalidLanguageServiceOutputError();
      let canonical: Uri;
      try {
        canonical = await this.#validateProviderUri(snapshot, location.uri, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof OutsideWorkspaceError) return undefined;
        throw error;
      }
      const document = this.#dependencies.getDocument?.(canonical);
      if (document === undefined) throw new InvalidLanguageServiceOutputError();
      validateRangeDocument(range, document);
      if (!sameUri(canonical, snapshot.target)) {
        throw new InvalidLanguageServiceOutputError();
      }
      const symbol: IdeSymbolDto = {
        name: name.text,
        kind,
        range,
        ...(containerName === undefined ? {} : { containerName: containerName.text }),
      };
      return {
        candidate: {
          symbol,
          aggregateValues: [
            name.text,
            ...(containerName === undefined ? [] : [containerName.text]),
          ],
          reasons: [...name.reasons, ...(containerName === undefined ? [] : containerName.reasons)],
        },
        children: [],
        parentName: name.text,
        providerResource: true,
        inWorkspaceResource: true,
      };
    }

    if (!Object.hasOwn(value, "range")) throw new InvalidLanguageServiceOutputError();
    if (snapshot.targetDocument === undefined) throw new InvalidLanguageServiceOutputError();
    const range = normalizeRange(value.range, snapshot.targetDocument);
    const selectionRange =
      value.selectionRange === undefined
        ? undefined
        : normalizeRange(value.selectionRange, snapshot.targetDocument);
    const detail = normalizeOptionalSymbolText(value.detail);
    if (detail === null) throw new InvalidLanguageServiceOutputError();
    const children =
      value.children === undefined
        ? []
        : Array.isArray(value.children)
          ? value.children
          : (() => {
              throw new InvalidLanguageServiceOutputError();
            })();
    const container = parentName === undefined ? undefined : takeBoundedText(parentName);
    const symbol: IdeSymbolDto = {
      name: name.text,
      kind,
      range,
      ...(container === undefined ? {} : { containerName: container.text }),
      ...(detail === undefined ? {} : { detail: detail.text }),
      ...(selectionRange === undefined ? {} : { selectionRange }),
    };
    return {
      candidate: {
        symbol,
        aggregateValues: [
          name.text,
          ...(container === undefined ? [] : [container.text]),
          ...(detail === undefined ? [] : [detail.text]),
        ],
        reasons: [
          ...name.reasons,
          ...(container === undefined ? [] : container.reasons),
          ...(detail === undefined ? [] : detail.reasons),
        ],
      },
      children,
      parentName: name.text,
      providerResource: true,
      inWorkspaceResource: true,
    };
  }

  async #validateProviderUri(snapshot: QuerySnapshot, uri: Uri, signal: AbortSignal): Promise<Uri> {
    try {
      const scope = this.#dependencies.createScope(snapshot.root);
      const canonical = await scope.validate(uri, signal);
      this.#assertOpen(signal, snapshot.generation);
      return canonical;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof WorkspaceScopeError && error.code === "outside-workspace") {
        throw new OutsideWorkspaceError();
      }
      if (error instanceof LanguageServiceUnavailableError) throw error;
      throw new InvalidLanguageServiceOutputError();
    }
  }

  #sourceForUri(
    snapshot: QuerySnapshot,
    uri: Uri,
    stale: boolean,
    truncated: boolean,
    reasons: ReadonlySet<IdeTruncationReason>,
    document: TextDocument | undefined,
  ): IdeSourceDto {
    const relativePath = toWorkspaceRelativePath(snapshot.canonicalRoot, uri);
    const languageId = document === undefined ? undefined : readLanguageId(document);
    const sameTarget = sameUri(uri, snapshot.target);
    const version = sameTarget ? snapshot.targetVersion : readDocumentVersion(document);
    return {
      uri: {
        scheme: boundedRequired(uri.scheme, maxIdeUriSchemeCodePoints, maxIdeUriSchemeBytes),
        authority: uri.authority.length === 0 ? "" : "workspace",
        path: boundedRequired(relativePath, maxIdeUriPathCodePoints, maxIdeUriPathBytes),
      },
      ...(languageId === undefined ? {} : { languageId }),
      ...(version === undefined ? {} : { documentVersion: version }),
      stale,
      truncated,
      ...(truncated ? { truncationReasons: [...orderedReasons(reasons)] } : {}),
    };
  }

  #readStale(snapshot: QuerySnapshot): boolean {
    this.#assertSnapshotIdentity(snapshot, true);
    if (snapshot.targetDocument === undefined || snapshot.targetVersion === undefined) return false;
    const currentDocument =
      this.#dependencies.getDocument?.(snapshot.target) ?? snapshot.targetDocument;
    const currentVersion = readDocumentVersion(currentDocument);
    if (currentVersion === undefined) throw new LanguageServiceUnavailableError();
    return currentDocument !== snapshot.targetDocument || currentVersion !== snapshot.targetVersion;
  }

  #assertSnapshotIdentity(snapshot: QuerySnapshot, allowDocumentChange = false): void {
    const root = this.#dependencies.getSelectedRoot();
    if (root === undefined || !sameUri(root, snapshot.root)) {
      throw new LanguageServiceUnavailableError();
    }
    if (this.#dependencies.isTrusted?.() !== snapshot.trusted) {
      throw new LanguageServiceUnavailableError();
    }
    if (this.#dependencies.isEnabled?.() === false) {
      throw new LanguageServiceUnavailableError();
    }
    if (
      !allowDocumentChange &&
      snapshot.targetDocument !== undefined &&
      readDocumentVersion(snapshot.targetDocument) !== snapshot.targetVersion
    ) {
      throw new LanguageServiceUnavailableError();
    }
    if (this.#dependencies.getDocument !== undefined) {
      const currentDocument = this.#dependencies.getDocument(snapshot.target);
      if (currentDocument === undefined) {
        throw new LanguageServiceUnavailableError();
      }
      if (!allowDocumentChange && currentDocument !== snapshot.targetDocument) {
        throw new LanguageServiceUnavailableError();
      }
    }
  }

  #assertOpen(signal: AbortSignal, generation = this.#generation): void {
    signal.throwIfAborted();
    if (
      this.#disposed ||
      generation !== this.#generation ||
      this.#dependencies.isEnabled?.() === false
    ) {
      throw new LanguageServiceUnavailableError();
    }
  }
}

export { VsCodeLanguageServices as VsCodeLanguageService };

class OutsideWorkspaceError extends Error {}

function normalizeRange(value: unknown, document: TextDocument): IdeRangeDto {
  const range = normalizeRangeShape(value);
  validateRangeDocument(range, document);
  return range;
}

function normalizeRangeShape(value: unknown): IdeRangeDto {
  if (!isRecord(value) || !isPosition(value.start) || !isPosition(value.end)) {
    throw new InvalidLanguageServiceOutputError();
  }
  const range = { start: value.start, end: value.end } as IdeRangeDto;
  if (comparePositions(range.start, range.end) > 0) {
    throw new InvalidLanguageServiceOutputError();
  }
  return range;
}

function validateRangeDocument(range: IdeRangeDto, document: TextDocument): void {
  validateDocumentPosition(document, range.start);
  validateDocumentPosition(document, range.end);
}

function isPosition(value: unknown): value is IdePositionDto {
  return (
    isRecord(value) &&
    typeof value.line === "number" &&
    Number.isSafeInteger(value.line) &&
    value.line >= 0 &&
    value.line <= maxIdePositionLine &&
    typeof value.character === "number" &&
    Number.isSafeInteger(value.character) &&
    value.character >= 0 &&
    value.character <= maxIdePositionCharacter
  );
}

function validateDocumentPosition(document: TextDocument, position: IdePositionDto): void {
  if (!Number.isSafeInteger(document.lineCount) || document.lineCount <= position.line) {
    throw new InvalidLanguageServiceOutputError();
  }
  let line: { readonly text: string };
  try {
    line = document.lineAt(position.line);
  } catch {
    throw new InvalidLanguageServiceOutputError();
  }
  if (
    typeof line.text !== "string" ||
    position.character > line.text.length ||
    isInsideSurrogate(line.text, position.character)
  ) {
    throw new InvalidLanguageServiceOutputError();
  }
  for (let index = 0; index < line.text.length; ) {
    index += readCodePoint(line.text, index).width;
  }
}

function mapSymbolKind(value: unknown): IdeSymbolDto["kind"] | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return numericSymbolKinds[value] ?? "unknown";
  }
  if (typeof value === "string") {
    const normalized = value
      .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
      .replace(/[_\s]+/gu, "-")
      .toLocaleLowerCase("en-US");
    return stringSymbolKinds[normalized] ?? "unknown";
  }
  return undefined;
}

const numericSymbolKinds: Readonly<Record<number, IdeSymbolDto["kind"]>> = {
  0: "file",
  1: "module",
  2: "namespace",
  3: "package",
  4: "class",
  5: "method",
  6: "property",
  7: "field",
  8: "constructor",
  9: "enum",
  10: "interface",
  11: "function",
  12: "variable",
  13: "constant",
  14: "string",
  15: "number",
  16: "boolean",
  17: "array",
  18: "object",
  19: "key",
  20: "null",
  21: "enum-member",
  22: "struct",
  23: "event",
  24: "operator",
  25: "type-parameter",
};

const stringSymbolKinds: Readonly<Record<string, IdeSymbolDto["kind"]>> = {
  file: "file",
  module: "module",
  namespace: "namespace",
  package: "package",
  class: "class",
  method: "method",
  property: "property",
  field: "field",
  constructor: "constructor" as IdeSymbolDto["kind"],
  enum: "enum",
  interface: "interface",
  function: "function",
  variable: "variable",
  constant: "constant",
  string: "string",
  number: "number",
  boolean: "boolean",
  array: "array",
  object: "object",
  key: "key",
  null: "null",
  "enum-member": "enum-member",
  struct: "struct",
  event: "event",
  operator: "operator",
  "type-parameter": "type-parameter",
};

function normalizeSymbolText(value: unknown): BoundedText | undefined {
  if (typeof value !== "string") return undefined;
  return takeBoundedText(value);
}

function normalizeOptionalSymbolText(value: unknown): BoundedText | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return takeBoundedText(value);
}

function takeBoundedText(value: string): BoundedText {
  const output: string[] = [];
  const reasons = new Set<IdeTruncationReason>();
  let codePoints = 0;
  let bytes = 0;
  let retained = true;
  for (let index = 0; index < value.length; ) {
    const point = readCodePoint(value, index);
    if (retained) {
      const candidateBytes = utf8BytesForCodePoint(point.value);
      if (codePoints + 1 > maxIdeDiagnosticLabelCodePoints) reasons.add("code-points");
      if (bytes + candidateBytes > maxIdeDiagnosticLabelBytes) reasons.add("utf8-bytes");
      if (reasons.size > 0) {
        retained = false;
      } else {
        output.push(value.slice(index, index + point.width));
        codePoints += 1;
        bytes += candidateBytes;
      }
    }
    index += point.width;
  }
  return { text: output.join(""), truncated: reasons.size > 0, reasons: orderedReasons(reasons) };
}

function readCodePoint(
  value: string,
  index: number,
): { readonly value: number; readonly width: 1 | 2 } {
  const codeUnit = value.charCodeAt(index);
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    if (!(next >= 0xdc00 && next <= 0xdfff)) throw new InvalidLanguageServiceOutputError();
    return { value: value.codePointAt(index) ?? 0, width: 2 };
  }
  if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) throw new InvalidLanguageServiceOutputError();
  return { value: codeUnit, width: 1 };
}

function boundedRequired(value: string, maxCodePoints: number, maxBytes: number): string {
  const projection = takeBoundedTextWithLimits(value, maxCodePoints, maxBytes);
  if (projection.truncated || projection.text.length === 0) {
    throw new InvalidLanguageServiceOutputError();
  }
  return projection.text;
}

function takeBoundedTextWithLimits(
  value: string,
  maxCodePoints: number,
  maxBytes: number,
): BoundedText {
  const output: string[] = [];
  const reasons = new Set<IdeTruncationReason>();
  let codePoints = 0;
  let bytes = 0;
  let retained = true;
  for (let index = 0; index < value.length; ) {
    const point = readCodePoint(value, index);
    if (retained) {
      const candidateBytes = utf8BytesForCodePoint(point.value);
      if (codePoints + 1 > maxCodePoints) reasons.add("code-points");
      if (bytes + candidateBytes > maxBytes) reasons.add("utf8-bytes");
      if (reasons.size > 0) retained = false;
      else {
        output.push(value.slice(index, index + point.width));
        codePoints += 1;
        bytes += candidateBytes;
      }
    }
    index += point.width;
  }
  return { text: output.join(""), truncated: reasons.size > 0, reasons: orderedReasons(reasons) };
}

function readDocumentVersion(document: TextDocument | undefined): number | undefined {
  return document !== undefined && Number.isSafeInteger(document.version) && document.version >= 0
    ? document.version
    : undefined;
}

function readLanguageId(document: TextDocument): string | undefined {
  if (typeof document.languageId !== "string" || document.languageId.length === 0) return undefined;
  const projection = takeBoundedTextWithLimits(document.languageId, 128, 512);
  if (projection.truncated) throw new InvalidLanguageServiceOutputError();
  return projection.text;
}

function sourceStrings(source: IdeSourceDto): readonly string[] {
  return [
    source.uri.scheme,
    source.uri.authority,
    source.uri.path,
    ...(source.languageId === undefined ? [] : [source.languageId]),
  ];
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

function assertProviderUriShape(uri: Uri): void {
  if (
    !isBoundedWellFormedUnicode(uri.scheme, maxIdeUriSchemeCodePoints, maxIdeUriSchemeBytes) ||
    !isBoundedWellFormedUnicode(uri.path, maxIdeUriPathCodePoints, maxIdeUriPathBytes) ||
    uri.scheme.length === 0 ||
    uri.path.length === 0 ||
    uri.query.length > 0 ||
    uri.fragment.length > 0 ||
    !uri.path.startsWith("/") ||
    uri.path.includes("\\") ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(uri.path) ||
    /%(?:2e|2f|5c)/iu.test(uri.path) ||
    uri.path
      .split("/")
      .slice(1)
      .some((segment) => segment.length === 0)
  ) {
    throw new InvalidLanguageServiceOutputError();
  }
}

function isBoundedWellFormedUnicode(
  value: string,
  maxCodePoints: number,
  maxBytes: number,
): boolean {
  let codePoints = 0;
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    let codePoint: number;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      codePoint = ((codeUnit - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
      index += 1;
    } else {
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
      codePoint = codeUnit;
    }
    codePoints += 1;
    bytes += utf8BytesForCodePoint(codePoint);
    if (codePoints > maxCodePoints || bytes > maxBytes) return false;
  }
  return true;
}

function toWorkspaceRelativePath(root: Uri, target: Uri): string {
  const rootSegments = pathSegments(root.path);
  const targetSegments = pathSegments(target.path);
  if (
    targetSegments.length <= rootSegments.length ||
    !sameIdentityPart(root.scheme, target.scheme) ||
    !sameIdentityPart(root.authority, target.authority)
  ) {
    throw new InvalidLanguageServiceOutputError();
  }
  for (let index = 0; index < rootSegments.length; index += 1) {
    if (!sameIdentityPart(rootSegments[index] ?? "", targetSegments[index] ?? "")) {
      throw new InvalidLanguageServiceOutputError();
    }
  }
  const relative = targetSegments.slice(rootSegments.length).join("/");
  if (relative.length === 0) throw new InvalidLanguageServiceOutputError();
  return relative;
}

function pathSegments(path: string): readonly string[] {
  if (!path.startsWith("/") || path.includes("\\")) throw new InvalidLanguageServiceOutputError();
  if (path === "/") return [];
  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new InvalidLanguageServiceOutputError();
  }
  return segments;
}

function sameIdentityPart(left: string, right: string): boolean {
  return left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
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

function isInsideSurrogate(line: string, character: number): boolean {
  if (character <= 0 || character >= line.length) return false;
  const previous = line.charCodeAt(character - 1);
  const next = line.charCodeAt(character);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function comparePositions(left: IdePositionDto, right: IdePositionDto): number {
  return left.line - right.line || left.character - right.character;
}

function locationKey(location: IdeLanguageLocationDto): string {
  return JSON.stringify(location);
}

function compareLocations(left: IdeLanguageLocationDto, right: IdeLanguageLocationDto): number {
  return (
    compareStrings(left.source.uri.scheme, right.source.uri.scheme) ||
    compareStrings(left.source.uri.authority, right.source.uri.authority) ||
    compareStrings(left.source.uri.path, right.source.uri.path) ||
    comparePositions(left.range.start, right.range.start) ||
    comparePositions(left.range.end, right.range.end) ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(locationKey(left), locationKey(right))
  );
}

function symbolKey(symbol: IdeSymbolDto): string {
  return JSON.stringify(symbol);
}

function compareSymbolCandidates(left: SymbolCandidate, right: SymbolCandidate): number {
  return (
    comparePositions(left.symbol.range.start, right.symbol.range.start) ||
    compareStrings(left.symbol.name, right.symbol.name) ||
    compareStrings(left.symbol.kind, right.symbol.kind) ||
    compareOptionalStrings(left.symbol.containerName, right.symbol.containerName) ||
    compareOptionalStrings(left.symbol.detail, right.symbol.detail) ||
    compareOptionalRanges(left.symbol.selectionRange, right.symbol.selectionRange) ||
    comparePositions(left.symbol.range.end, right.symbol.range.end) ||
    compareStrings(symbolKey(left.symbol), symbolKey(right.symbol))
  );
}

function compareOptionalRanges(
  left: IdeRangeDto | undefined,
  right: IdeRangeDto | undefined,
): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return comparePositions(left.start, right.start) || comparePositions(left.end, right.end);
}

function compareOptionalStrings(left: string | undefined, right: string | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return compareStrings(left, right);
}

function countCodePoints(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; ) {
    index += readCodePoint(value, index).width;
    count += 1;
  }
  return count;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; ) {
    const point = readCodePoint(value, index);
    index += point.width;
    bytes += utf8BytesForCodePoint(point.value);
  }
  return bytes;
}

function utf8BytesForCodePoint(codePoint: number): number {
  return codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index] ?? 0;
    const rightPoint = rightPoints[index] ?? 0;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
  }
  return leftPoints.length - rightPoints.length;
}

function orderedReasons(reasons: Iterable<IdeTruncationReason>): readonly IdeTruncationReason[] {
  const set = new Set(reasons);
  const order: readonly IdeTruncationReason[] = [
    "code-points",
    "utf8-bytes",
    "lines",
    "entries",
    "tokens",
    "out-of-workspace",
  ];
  return order.filter((reason) => set.has(reason));
}
