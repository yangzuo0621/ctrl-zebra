import {
  AtomicCheckpointStore,
  type CheckpointStorage,
  type CheckpointStore,
  type PersistencePath,
} from "@ctrl-zebra/core";
import { persistenceCheckpointsDirectory, persistenceFormatDirectory } from "@ctrl-zebra/protocol";
import { type FileSystem, FileType, Uri } from "vscode";
import {
  type VscodeBoundedTextFileSystem,
  VscodeBoundedTextStorage,
} from "./vscode-bounded-text-storage.js";
import { isVscodeFileNotFound } from "./vscode-file-system-error.js";

type CheckpointFileSystem = VscodeBoundedTextFileSystem & Pick<FileSystem, "stat">;

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
  readonly #storage: VscodeBoundedTextStorage;

  constructor(root: Uri, fileSystem: CheckpointFileSystem) {
    this.#storage = new VscodeBoundedTextStorage({
      root,
      fileSystem,
      joinPath: Uri.joinPath,
      isFileNotFound: isVscodeFileNotFound,
    });
  }

  async initialize(): Promise<void> {
    await this.#storage.initialize([
      [persistenceCheckpointsDirectory],
      [persistenceCheckpointsDirectory, persistenceFormatDirectory],
    ]);
  }

  async exists(path: PersistencePath): Promise<boolean> {
    return await this.#storage.exists(path);
  }

  async readText(path: PersistencePath, maxBytes: number): Promise<string | undefined> {
    return await this.#storage.readText(path, maxBytes, "Persisted Checkpoint");
  }

  async listFiles(directory: PersistencePath, maxFiles: number): Promise<readonly string[]> {
    const entries = await this.#storage.readDirectory(directory);
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
    await this.#storage.writeText(path, content, maxBytes, "Persisted Checkpoint");
  }

  async commit(source: PersistencePath, destination: PersistencePath): Promise<void> {
    await this.#storage.rename(source, destination, false);
  }

  async deleteFile(path: PersistencePath): Promise<void> {
    await this.#storage.deleteFile(path);
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
