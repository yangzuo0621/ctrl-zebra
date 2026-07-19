import {
  AtomicCheckpointStore,
  type CheckpointStorage,
  type CheckpointStore,
  type PersistencePath,
} from "@ctrl-zebra/core";
import { persistenceCheckpointsDirectory, persistenceFormatDirectory } from "@ctrl-zebra/protocol";
import { type FileSystem, FileSystemError, FileType, Uri } from "vscode";

type CheckpointFileSystem = Pick<
  FileSystem,
  "createDirectory" | "delete" | "readDirectory" | "readFile" | "rename" | "stat" | "writeFile"
>;

export class WorkspaceCheckpointStorageUnavailableError extends Error {
  constructor() {
    super("Open a workspace before creating a CtrlZebra Checkpoint.");
    this.name = "WorkspaceCheckpointStorageUnavailableError";
  }
}

export function createWorkspaceCheckpointStoreProvider(
  storageUri: Uri | undefined,
  fileSystem: CheckpointFileSystem,
  hashText: (text: string) => string,
): () => Promise<CheckpointStore> {
  let pending: Promise<CheckpointStore> | undefined;
  return async () => {
    if (storageUri === undefined) {
      throw new WorkspaceCheckpointStorageUnavailableError();
    }
    pending ??= createStore(storageUri, fileSystem, hashText).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

class VsCodeCheckpointStorage implements CheckpointStorage {
  readonly #root: Uri;
  readonly #fileSystem: CheckpointFileSystem;

  constructor(root: Uri, fileSystem: CheckpointFileSystem) {
    this.#root = root;
    this.#fileSystem = fileSystem;
  }

  async initialize(): Promise<void> {
    await this.#fileSystem.createDirectory(this.#root);
    await this.#fileSystem.createDirectory(
      Uri.joinPath(this.#root, persistenceCheckpointsDirectory),
    );
    await this.#fileSystem.createDirectory(
      Uri.joinPath(this.#root, persistenceCheckpointsDirectory, persistenceFormatDirectory),
    );
  }

  async exists(path: PersistencePath): Promise<boolean> {
    try {
      await this.#fileSystem.stat(this.#resolve(path));
      return true;
    } catch (error) {
      if (isFileNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async readText(path: PersistencePath, maxBytes: number): Promise<string | undefined> {
    let content: Uint8Array;
    try {
      content = await this.#fileSystem.readFile(this.#resolve(path));
    } catch (error) {
      if (isFileNotFound(error)) {
        return undefined;
      }
      throw error;
    }
    if (content.byteLength > maxBytes) {
      throw new RangeError(`Persisted Checkpoint exceeds the ${maxBytes}-byte limit.`);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  }

  async listFiles(directory: PersistencePath, maxFiles: number): Promise<readonly string[]> {
    const entries = await this.#fileSystem.readDirectory(this.#resolve(directory));
    const files: string[] = [];
    for (const [name, type] of entries) {
      if ((type & FileType.File) !== 0) {
        files.push(name);
        if (files.length > maxFiles) {
          throw new RangeError(`Persisted Checkpoint count exceeds the ${maxFiles}-file limit.`);
        }
      }
    }
    return files;
  }

  async writeText(path: PersistencePath, content: string, maxBytes: number): Promise<void> {
    await this.#ensureParent(path);
    const encoded = new TextEncoder().encode(content);
    if (encoded.byteLength > maxBytes) {
      throw new RangeError(`Persisted Checkpoint exceeds the ${maxBytes}-byte limit.`);
    }
    await this.#fileSystem.writeFile(this.#resolve(path), encoded);
  }

  async commit(source: PersistencePath, destination: PersistencePath): Promise<void> {
    await this.#fileSystem.rename(this.#resolve(source), this.#resolve(destination), {
      overwrite: false,
    });
  }

  async deleteFile(path: PersistencePath): Promise<void> {
    try {
      await this.#fileSystem.delete(this.#resolve(path), { recursive: false, useTrash: false });
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw error;
      }
    }
  }

  async #ensureParent(path: PersistencePath): Promise<void> {
    let current = this.#root;
    await this.#fileSystem.createDirectory(current);
    for (const segment of path.slice(0, -1)) {
      assertPathSegment(segment);
      current = Uri.joinPath(current, segment);
      await this.#fileSystem.createDirectory(current);
    }
  }

  #resolve(path: PersistencePath): Uri {
    for (const segment of path) {
      assertPathSegment(segment);
    }
    return Uri.joinPath(this.#root, ...path);
  }
}

async function createStore(
  storageUri: Uri,
  fileSystem: CheckpointFileSystem,
  hashText: (text: string) => string,
): Promise<CheckpointStore> {
  const storage = new VsCodeCheckpointStorage(storageUri, fileSystem);
  await storage.initialize();
  return new AtomicCheckpointStore(storage, hashText);
}

function assertPathSegment(segment: string): void {
  if (segment.length === 0 || segment === "." || segment === ".." || /[\\/:]/.test(segment)) {
    throw new TypeError("Persistence paths must contain portable relative path segments.");
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof FileSystemError && error.code === "FileNotFound";
}
