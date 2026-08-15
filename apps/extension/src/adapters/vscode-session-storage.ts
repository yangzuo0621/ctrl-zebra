import {
  AtomicManifestStore,
  type EventStorage,
  JsonlEventStore,
  type ManifestStorage,
  PersistedSessionRepository,
  type PersistencePath,
  type SessionCatalog,
  type SessionDeletionReport,
  type SessionRepository,
} from "@ctrl-zebra/core";
import {
  getSessionPersistencePaths,
  persistenceFormatDirectory,
  persistenceSessionsDirectory,
  sessionManifestFileName,
  sessionManifestSchema,
} from "@ctrl-zebra/protocol";
import { FileType, Uri } from "vscode";
import {
  type VscodeBoundedTextFileSystem,
  VscodeBoundedTextStorage,
} from "./vscode-bounded-text-storage.js";
import { isVscodeFileNotFound } from "./vscode-file-system-error.js";

export const maxManifestBytes = 65_536;

type SessionFileSystem = Pick<
  VscodeBoundedTextFileSystem,
  "createDirectory" | "delete" | "readDirectory" | "readFile" | "rename" | "stat" | "writeFile"
>;

export class WorkspaceSessionStorageUnavailableError extends Error {
  constructor() {
    super("Open a workspace before starting a persistent CtrlZebra Session.");
    this.name = "WorkspaceSessionStorageUnavailableError";
  }
}

export function createWorkspaceSessionRepositoryProvider(
  storageUri: Uri | undefined,
  fileSystem: SessionFileSystem,
): () => Promise<SessionRepository> {
  let pending: Promise<SessionRepository> | undefined;
  return async () => {
    if (storageUri === undefined) {
      throw new WorkspaceSessionStorageUnavailableError();
    }
    pending ??= createRepository(storageUri, fileSystem);
    return pending;
  };
}

class VsCodeSessionStorage implements ManifestStorage, EventStorage, SessionCatalog {
  readonly #storage: VscodeBoundedTextStorage;

  constructor(root: Uri, fileSystem: SessionFileSystem) {
    this.#storage = new VscodeBoundedTextStorage({
      root,
      fileSystem,
      joinPath: Uri.joinPath,
      isFileNotFound: isVscodeFileNotFound,
    });
  }

  async initialize(): Promise<void> {
    await this.#storage.initialize([
      [persistenceSessionsDirectory],
      [persistenceSessionsDirectory, persistenceFormatDirectory],
    ]);
  }

  async readText(path: PersistencePath, maxBytes = maxManifestBytes): Promise<string | undefined> {
    return await this.#storage.readText(path, maxBytes);
  }

  async writeText(path: PersistencePath, content: string): Promise<void> {
    await this.#storage.writeText(path, content, maxManifestBytes, "Persisted manifest");
  }

  async rename(source: PersistencePath, destination: PersistencePath): Promise<void> {
    await this.#storage.rename(source, destination, true);
  }

  async deleteFile(path: PersistencePath): Promise<void> {
    await this.#storage.deleteFile(path);
  }

  async deleteSession(sessionId: unknown): Promise<boolean> {
    const paths = getSessionPersistencePaths(sessionId);
    if (!(await this.#storage.exists(paths.directory))) {
      return false;
    }
    await this.#storage.deleteDirectory(paths.directory);
    return true;
  }

  async clearSessions(): Promise<SessionDeletionReport> {
    const directory = [persistenceSessionsDirectory, persistenceFormatDirectory] as const;
    const entries = await this.#storage.readDirectory(directory);
    let deleted = 0;
    let failed = 0;
    for (const [name, type] of entries) {
      const path = [...directory, name] as PersistencePath;
      try {
        if ((type & FileType.Directory) !== 0) {
          await this.#storage.deleteDirectory(path);
        } else {
          await this.#storage.deleteFile(path);
        }
        deleted += 1;
      } catch {
        failed += 1;
      }
    }
    return { deleted, failed } satisfies SessionDeletionReport;
  }

  async appendText(path: PersistencePath, content: string, maxTotalBytes: number): Promise<void> {
    await this.#storage.appendText(path, content, maxTotalBytes);
  }

  async listSessionIds(): Promise<readonly string[]> {
    const entries = await this.#storage.readDirectory([
      persistenceSessionsDirectory,
      persistenceFormatDirectory,
    ]);
    const sessionIds: string[] = [];
    for (const [name, type] of entries) {
      if ((type & FileType.Directory) === 0) {
        continue;
      }
      const content = await this.#storage.readText(
        [persistenceSessionsDirectory, persistenceFormatDirectory, name, sessionManifestFileName],
        maxManifestBytes,
      );
      if (content === undefined) {
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(content) as unknown;
      } catch {
        continue;
      }
      const result = sessionManifestSchema.safeParse(value);
      if (result.success) {
        sessionIds.push(result.data.sessionId);
      }
    }
    return sessionIds;
  }
}

async function createRepository(
  storageUri: Uri,
  fileSystem: SessionFileSystem,
): Promise<SessionRepository> {
  const storage = new VsCodeSessionStorage(storageUri, fileSystem);
  await storage.initialize();
  return new PersistedSessionRepository(
    new AtomicManifestStore(storage),
    new JsonlEventStore(storage),
    storage,
  );
}
