import { z } from "zod";

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

export function workspaceRelativePathSchema(
  description: string,
  maxLength: number = maxWorkspaceRelativePathCharacters,
) {
  return z.string().min(1).max(maxLength).regex(workspaceRelativePathPattern).describe(description);
}
