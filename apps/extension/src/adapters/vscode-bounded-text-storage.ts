import type { PersistencePath } from "@ctrl-zebra/core";
import type { FileSystem, FileType, Uri } from "vscode";

export type VscodeBoundedTextFileSystem = Pick<
  FileSystem,
  "createDirectory" | "delete" | "readDirectory" | "readFile" | "rename" | "writeFile"
> &
  Partial<Pick<FileSystem, "stat">>;

export type VscodeUriJoinPath = (base: Uri, ...pathSegments: string[]) => Uri;

export interface VscodeBoundedTextStorageOptions {
  readonly root: Uri;
  readonly fileSystem: VscodeBoundedTextFileSystem;
  readonly joinPath: VscodeUriJoinPath;
  readonly isFileNotFound: (error: unknown) => boolean;
}

export interface VscodeRootEntryCleanupReport {
  readonly deleted: number;
  readonly failed: number;
}

/**
 * Extension-private bounded UTF-8 storage over the VS Code FileSystem port.
 * Domain stores retain ownership of persistence semantics; this module owns
 * path resolution, byte limits, and host-level missing-file behavior.
 */
export class VscodeBoundedTextStorage {
  readonly #root: Uri;
  readonly #fileSystem: VscodeBoundedTextFileSystem;
  readonly #joinPath: VscodeUriJoinPath;
  readonly #isFileNotFound: (error: unknown) => boolean;

  constructor({ root, fileSystem, joinPath, isFileNotFound }: VscodeBoundedTextStorageOptions) {
    this.#root = root;
    this.#fileSystem = fileSystem;
    this.#joinPath = joinPath;
    this.#isFileNotFound = isFileNotFound;
  }

  async initialize(directories: readonly PersistencePath[]): Promise<void> {
    await this.#fileSystem.createDirectory(this.#root);
    for (const directory of directories) {
      await this.#fileSystem.createDirectory(this.#resolve(directory));
    }
  }

  async exists(path: PersistencePath): Promise<boolean> {
    if (this.#fileSystem.stat === undefined) {
      throw new TypeError("The FileSystem port does not support stat.");
    }
    try {
      await this.#fileSystem.stat(this.#resolve(path));
      return true;
    } catch (error) {
      if (this.#isFileNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async readDirectory(
    path: PersistencePath,
    maxEntries?: number,
  ): Promise<readonly [string, FileType][]> {
    const entries = await this.#fileSystem.readDirectory(this.#resolve(path));
    if (maxEntries !== undefined && entries.length > maxEntries) {
      throw new RangeError(`Persistence directory exceeds the ${maxEntries}-entry limit.`);
    }
    return entries;
  }

  async readText(
    path: PersistencePath,
    maxBytes: number,
    label = "Persisted file",
  ): Promise<string | undefined> {
    let content: Uint8Array;
    try {
      content = await this.#fileSystem.readFile(this.#resolve(path));
    } catch (error) {
      if (this.#isFileNotFound(error)) {
        return undefined;
      }
      throw error;
    }
    if (content.byteLength > maxBytes) {
      throw new RangeError(`${label} exceeds the ${maxBytes}-byte read limit.`);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  }

  async writeText(
    path: PersistencePath,
    content: string,
    maxBytes: number,
    label = "Persisted file",
  ): Promise<void> {
    await this.#ensureParent(path);
    const encoded = new TextEncoder().encode(content);
    if (encoded.byteLength > maxBytes) {
      throw new RangeError(`${label} exceeds the ${maxBytes}-byte limit.`);
    }
    await this.#fileSystem.writeFile(this.#resolve(path), encoded);
  }

  async rename(
    source: PersistencePath,
    destination: PersistencePath,
    overwrite: boolean,
  ): Promise<void> {
    await this.#fileSystem.rename(this.#resolve(source), this.#resolve(destination), { overwrite });
  }

  async deleteFile(path: PersistencePath): Promise<void> {
    try {
      await this.#fileSystem.delete(this.#resolve(path), { recursive: false, useTrash: false });
    } catch (error) {
      if (!this.#isFileNotFound(error)) {
        throw error;
      }
    }
  }

  async deleteDirectory(path: PersistencePath): Promise<void> {
    try {
      await this.#fileSystem.delete(this.#resolve(path), { recursive: true, useTrash: false });
    } catch (error) {
      if (!this.#isFileNotFound(error)) {
        throw error;
      }
    }
  }

  async clearRootEntries(
    excludedNames: readonly string[],
    maxEntries = 10_000,
  ): Promise<VscodeRootEntryCleanupReport> {
    let entries: readonly [string, FileType][];
    try {
      entries = await this.#fileSystem.readDirectory(this.#root);
    } catch (error) {
      if (this.#isFileNotFound(error)) {
        return { deleted: 0, failed: 0 };
      }
      throw error;
    }
    if (entries.length > maxEntries) {
      throw new RangeError(`Storage root exceeds the ${maxEntries}-entry limit.`);
    }

    const excluded = new Set(excludedNames);
    let deleted = 0;
    let failed = 0;
    for (const [name] of entries) {
      if (excluded.has(name)) {
        continue;
      }
      try {
        assertPathSegment(name);
        await this.#fileSystem.delete(this.#joinPath(this.#root, name), {
          recursive: true,
          useTrash: false,
        });
        deleted += 1;
      } catch (error) {
        if (this.#isFileNotFound(error)) {
          continue;
        }
        failed += 1;
      }
    }
    return { deleted, failed };
  }

  async appendText(path: PersistencePath, content: string, maxTotalBytes: number): Promise<void> {
    const existing = (await this.readText(path, maxTotalBytes)) ?? "";
    const combined = `${existing}${content}`;
    const encoded = new TextEncoder().encode(combined);
    if (encoded.byteLength > maxTotalBytes) {
      throw new RangeError(`Persisted event log exceeds the ${maxTotalBytes}-byte limit.`);
    }
    const temporaryPath: PersistencePath = [
      path[0],
      ...path.slice(1, -1),
      `${path[path.length - 1]}.append.tmp`,
    ];
    await this.#ensureParent(temporaryPath);
    await this.#fileSystem.writeFile(this.#resolve(temporaryPath), encoded);
    await this.rename(temporaryPath, path, true);
  }

  #resolve(path: PersistencePath): Uri {
    if (path.length === 0) {
      throw new TypeError("Persistence paths must contain portable relative path segments.");
    }
    for (const segment of path) {
      assertPathSegment(segment);
    }
    return this.#joinPath(this.#root, ...path);
  }

  async #ensureParent(path: PersistencePath): Promise<void> {
    let current = this.#root;
    await this.#fileSystem.createDirectory(current);
    for (const segment of path.slice(0, -1)) {
      assertPathSegment(segment);
      current = this.#joinPath(current, segment);
      await this.#fileSystem.createDirectory(current);
    }
  }
}

function assertPathSegment(segment: string): void {
  if (segment.length === 0 || segment === "." || segment === ".." || /[\\/:]/.test(segment)) {
    throw new TypeError("Persistence paths must contain portable relative path segments.");
  }
}
