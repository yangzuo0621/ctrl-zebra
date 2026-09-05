import { z } from "zod";

export const maxWorkspaceGlobCharacters = 256;

/**
 * Allows a leading slash and "." segments (glob syntax uses both), unlike
 * workspace-path-schema.ts's stricter workspace-relative-path pattern -- only a ".." segment or a
 * backslash is rejected. Shared by list_files and search_files; was duplicated verbatim between
 * the two hand-written schemas before this tranche extracted it.
 *
 * Uses the `s` (dotAll) flag for the same reason workspace-path-schema.ts's
 * workspaceRelativePathPattern does: the trailing `.+` must also match a glob containing a
 * line-terminator code point, which `isSafeForwardSlashPath` never rejected.
 */
export const workspaceGlobPattern = /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/su;

export function workspaceGlobSchema(
  description: string,
  maxLength: number = maxWorkspaceGlobCharacters,
) {
  return z.string().min(1).max(maxLength).regex(workspaceGlobPattern).describe(description);
}
