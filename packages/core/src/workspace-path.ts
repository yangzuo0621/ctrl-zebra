import { utf8ByteLength } from "./text-primitives.js";

/**
 * The shared bounds and safety check for a workspace-relative, forward-slash path proposed by a
 * Tool plan (file create, delete, rename, or workspace edit). Owned here once rather than
 * reimplemented per plan kind; each plan module re-exports these under its own public constant
 * names for backward compatibility of its existing public contract.
 */
export const maxWorkspacePathCharacters = 4_096;
export const maxWorkspacePathBytes = 16_384;

/** Windows device names reserved regardless of extension or case (`CON`, `con.txt`, ...). */
const windowsReservedDeviceNames = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/**
 * Validates a workspace-relative path before it reaches a Host boundary that joins it onto a
 * trusted workspace root. This is one layer of defense-in-depth, not the only one: the Host
 * adapter still canonicalizes and re-checks containment against the real filesystem root.
 *
 * Rejects, in addition to the obvious absolute-path/`\`/`.`/`..` cases:
 *  - any `:` anywhere in the path. A colon has no meaning in a plain relative path component on
 *    any platform CtrlZebra targets, but on Windows it introduces a drive root (`C:/...`) or an
 *    NTFS Alternate Data Stream (`file.txt:stream`) — both of which this check would otherwise
 *    accept as an ordinary segment, since neither contains `/`, `\`, `.`, or `..` by itself.
 *  - a segment that is (case-insensitively, with or without an extension) a Windows reserved
 *    device name (`CON`, `NUL`, `COM1`, ...), which the Windows filesystem layer treats specially
 *    regardless of the requested extension.
 *  - a segment ending in `.` or a space, which Windows silently strips — so `"foo. "` and `"foo"`
 *    can otherwise refer to the same real file under two different proposed paths.
 */
export function isSafeWorkspacePath(
  path: string,
  options: { readonly maxCharacters: number; readonly maxBytes: number },
): boolean {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    [...path].length > options.maxCharacters ||
    utf8ByteLength(path) > options.maxBytes
  ) {
    return false;
  }

  return path.split("/").every(isSafeWorkspacePathSegment);
}

function isSafeWorkspacePathSegment(segment: string): boolean {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.endsWith(".") ||
    segment.endsWith(" ")
  ) {
    return false;
  }

  // split(".") always returns at least one element, even for a string with no "." at all.
  const deviceName = segment.split(".")[0];
  return !windowsReservedDeviceNames.has(deviceName.toLowerCase());
}
