import { maxMcpListEntries, maxMcpListPages } from "./contracts.js";
import { isRecord } from "./record-validation.js";

export type McpCatalogCollectionErrorCode = "malformed-message" | "limit-exceeded";

/**
 * A bounded page-walk failure. The class is package-private so each catalog
 * owner can translate the shared collection outcome to its stable error type.
 */
export class McpCatalogCollectionError extends Error {
  constructor(readonly code: McpCatalogCollectionErrorCode) {
    super(
      code === "limit-exceeded"
        ? "The MCP catalog exceeded its bounded limit."
        : "The MCP catalog page was malformed.",
    );
    this.name = "McpCatalogCollectionError";
  }
}

export interface McpCatalogPageRequest {
  readonly request: (cursor?: string) => Promise<unknown>;
  readonly field: string;
  readonly signal: AbortSignal;
  readonly maxPages?: number;
  readonly maxEntries?: number;
}

/**
 * Collect one bounded, cursor-paginated MCP catalog.
 *
 * The MCP client owns the request transport, while this collector owns the
 * common cursor, page, entry, cancellation, and malformed-page policy. It
 * returns values only after the complete walk succeeds; callers publish the
 * returned array atomically in their domain-specific refresh path.
 */
export async function collectMcpCatalogPages<T = unknown>(
  options: McpCatalogPageRequest,
): Promise<T[]> {
  const values: T[] = [];
  const cursors = new Set<string>();
  const maxPages = options.maxPages ?? maxMcpListPages;
  const maxEntries = options.maxEntries ?? maxMcpListEntries;
  let cursor: string | undefined;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    options.signal.throwIfAborted();
    const page = await options.request(cursor);
    const record = readRecord(page);
    const pageValues = record[options.field];
    if (!Array.isArray(pageValues)) {
      throw new McpCatalogCollectionError("malformed-message");
    }
    if (values.length + pageValues.length > maxEntries) {
      throw new McpCatalogCollectionError("limit-exceeded");
    }
    values.push(...(pageValues as T[]));

    const nextCursor = record.nextCursor;
    if (nextCursor === undefined) {
      return values;
    }
    if (typeof nextCursor !== "string" || nextCursor === "" || cursors.has(nextCursor)) {
      throw new McpCatalogCollectionError("malformed-message");
    }
    cursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new McpCatalogCollectionError("limit-exceeded");
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new McpCatalogCollectionError("malformed-message");
  }
  return value as Readonly<Record<string, unknown>>;
}
