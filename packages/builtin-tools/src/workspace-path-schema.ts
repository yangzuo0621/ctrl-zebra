import { utf8ByteLength } from "@ctrl-zebra/protocol";
import { z } from "zod";

import { isSafeForwardSlashPath } from "./boundary-validation.js";

export const maxWorkspaceRelativePathCharacters = 4_096;

/**
 * A workspace-relative forward-slash path: no leading slash, no backslash, no "."/".." segment.
 * Equivalent to calling `isSafeForwardSlashPath(value, { allowLeadingSlash: false,
 * rejectCurrentSegments: true, maxLength })` from boundary-validation.ts -- proven equivalent
 * (not assumed) by workspace-path-schema.test.ts running both against a shared battery of inputs.
 * Expressed as a single regex, rather than calling that predicate from a zod `.refine()`, so this
 * constraint appears as a `pattern` hint in the JSON Schema advertised to the model, the same way
 * every one of these tools' hand-written schemas already did before this shared constant existed.
 */
export const workspaceRelativePathPattern = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$)).+$/u;

/**
 * `maxBytes`, when given, adds an extra UTF-8 byte-length ceiling on top of the code-unit
 * `maxLength` above -- a workspace-relative path made of multi-byte characters can stay under
 * `maxLength` in code units while still exceeding a much smaller byte budget the host imposes.
 * Invisible in the generated JSON Schema (the same as every other `.refine()` in this package),
 * matching the hand-written schemas this replaces, which never advertised this bound either.
 */
export function workspaceRelativePathSchema(
  description: string,
  maxLength: number = maxWorkspaceRelativePathCharacters,
  maxBytes?: number,
) {
  const schema = z
    .string()
    .min(1)
    .max(maxLength)
    .regex(workspaceRelativePathPattern)
    .describe(description);

  return maxBytes === undefined
    ? schema
    : schema.refine((path) => utf8ByteLength(path) <= maxBytes, {
        message: "Path exceeds the maximum UTF-8 byte length.",
      });
}

/**
 * The plain-predicate counterpart to `workspaceRelativePathSchema` above, for host-snapshot
 * validators that are not model input and so stay hand-written rather than becoming zod schemas
 * (see bounded-text-schema.ts's docs for the same distinction applied to bounded text). Was
 * triplicated verbatim across propose-file-create.ts, propose-file-delete.ts and
 * propose-file-rename.ts before being extracted here.
 */
export function isSafeWorkspaceRelativePath(value: unknown, maxBytes: number): value is string {
  return (
    isSafeForwardSlashPath(value, {
      maxLength: maxWorkspaceRelativePathCharacters,
      allowLeadingSlash: false,
      rejectCurrentSegments: true,
    }) && utf8ByteLength(value) <= maxBytes
  );
}
