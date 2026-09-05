import { utf8ByteLength } from "@ctrl-zebra/protocol";
import { z } from "zod";

export interface BoundedWorkspaceTextBounds {
  readonly maxCharacters: number;
  readonly maxLines: number;
  readonly maxBytes: number;
}

/**
 * Splits on line endings the same way a text editor counts logical lines: a trailing newline
 * does not itself start a new (empty) line, and the empty string has zero lines.
 */
export function countLogicalLines(text: string): number {
  return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/u).length;
}

/**
 * Was triplicated verbatim across propose-file-create.ts, propose-file-delete.ts and
 * propose-file-rename.ts (flagged as real duplication during PR #301's review) -- extracted here
 * as the single implementation both `boundedWorkspaceTextSchema` below and each tool's
 * host-snapshot parser (which validates the `beforeContent`/`content` payload the workspace host
 * returns, not model input, so it stays a plain predicate rather than a zod schema) now share.
 *
 * `maxCharacters` counts Unicode code points via `[...text].length`, matching how JSON Schema's
 * own `maxLength` keyword is defined -- NOT what zod's built-in `z.string().max()` counts, which
 * is UTF-16 code units and would reject some valid astral-character text within this same bound
 * (see bounded-text-schema.test.ts). That is why `boundedWorkspaceTextSchema` enforces this bound
 * entirely through `.refine()` instead of `.max()`.
 */
export function isBoundedWorkspaceText(text: string, bounds: BoundedWorkspaceTextBounds): boolean {
  return (
    text.isWellFormed() &&
    !text.includes("\0") &&
    [...text].length <= bounds.maxCharacters &&
    countLogicalLines(text) <= bounds.maxLines &&
    utf8ByteLength(text) <= bounds.maxBytes
  );
}

/**
 * A bounded UTF-8 text field for a tool's model-facing input schema. `toToolInputSchema()` will
 * not add a `maxLength` for this field -- there is no `.max()` call to derive one from,
 * deliberately, per `isBoundedWorkspaceText`'s docs -- so a caller that advertised a `maxLength`
 * for this field before migrating must splice it back into the generated JSON Schema itself.
 */
export function boundedWorkspaceTextSchema(
  description: string,
  bounds: BoundedWorkspaceTextBounds,
) {
  return z
    .string()
    .describe(description)
    .refine((text) => isBoundedWorkspaceText(text, bounds), {
      message: "Text exceeds a bounded UTF-8 text limit.",
    });
}
