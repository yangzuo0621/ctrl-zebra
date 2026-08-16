import type { PersistencePath } from "@ctrl-zebra/core";
import { describe, expect, it } from "vitest";
import type { FileSystem, FileType, Uri } from "vscode";
import { createTestUri } from "../test/support/test-uri.js";
import {
  type VscodeBoundedTextFileSystem,
  VscodeBoundedTextStorage,
} from "./vscode-bounded-text-storage.js";

describe("VscodeBoundedTextStorage", () => {
  it("initializes, resolves, reads, writes, appends, renames, and deletes bounded text", async () => {
    const { storage, fileSystem } = createStorage();
    const manifestPath = ["sessions", "v1", "session-1", "manifest.json"] as const;

    await storage.initialize([["sessions"], ["sessions", "v1"]]);
    await storage.writeText(manifestPath, "A😀", 5, "Persisted manifest");

    expect(await storage.readText(manifestPath, 5)).toBe("A😀");
    expect(await storage.readText(["sessions", "v1", "missing.json"], 5)).toBeUndefined();
    expect(fileSystem.directories).toEqual(
      new Set([
        "file:///storage",
        "file:///storage/sessions",
        "file:///storage/sessions/v1",
        "file:///storage/sessions/v1/session-1",
      ]),
    );

    const eventsPath = ["sessions", "v1", "events.jsonl"] as const;
    await storage.appendText(eventsPath, "first\n", 32);
    await storage.appendText(eventsPath, "第二\n", 32);
    expect(await storage.readText(eventsPath, 32)).toBe("first\n第二\n");

    await storage.rename(eventsPath, ["sessions", "v1", "events.final.jsonl"], false);
    expect(fileSystem.renameCalls.at(-1)).toEqual({
      overwrite: false,
      source: "file:///storage/sessions/v1/events.jsonl",
      target: "file:///storage/sessions/v1/events.final.jsonl",
    });
    await storage.deleteFile(["sessions", "v1", "events.final.jsonl"]);
    await storage.deleteFile(["sessions", "v1", "already-missing.jsonl"]);
    expect(await storage.readText(["sessions", "v1", "events.final.jsonl"], 32)).toBeUndefined();
  });

  it("deletes a bounded recursive directory while retaining neighboring data", async () => {
    const { storage, fileSystem } = createStorage();
    await storage.writeText(["sessions", "v1", "session-1", "manifest.json"], "one", 32);
    await storage.writeText(["sessions", "v1", "session-2", "manifest.json"], "two", 32);

    await storage.deleteDirectory(["sessions", "v1", "session-1"]);

    expect(await storage.readText(["sessions", "v1", "session-1", "manifest.json"], 32)).toBe(
      undefined,
    );
    expect(await storage.readText(["sessions", "v1", "session-2", "manifest.json"], 32)).toBe(
      "two",
    );
    expect(fileSystem.directories.has("file:///storage/sessions/v1/session-1")).toBe(false);
  });

  it("enforces UTF-8 byte ceilings before writes and reads", async () => {
    const { storage, fileSystem } = createStorage();
    const path = ["sessions", "v1", "bounded.txt"] as const;

    await expect(storage.writeText(path, "😀", 3)).rejects.toThrow(
      "Persisted file exceeds the 3-byte limit.",
    );
    fileSystem.files.set(
      uriKey(joinPath(createTestUri("/storage"), ...path)),
      new Uint8Array([1, 2, 3, 4]),
    );
    await expect(storage.readText(path, 3)).rejects.toThrow(
      "Persisted file exceeds the 3-byte read limit.",
    );

    await expect(storage.appendText(["sessions", "v1", "events.jsonl"], "x", 0)).rejects.toThrow(
      "Persisted event log exceeds the 0-byte limit.",
    );
  });

  it("rejects a directory scan that exceeds its entry ceiling", async () => {
    const { storage, fileSystem } = createStorage();
    fileSystem.directoryEntries.set("file:///storage/sessions", [
      ["one", 0 as FileType],
      ["two", 0 as FileType],
    ]);

    await expect(storage.readDirectory(["sessions"], 1)).rejects.toThrow(
      "Persistence directory exceeds the 1-entry limit.",
    );
  });

  it("rejects malformed UTF-8 and invalid relative path segments", async () => {
    const { storage, fileSystem } = createStorage();
    const malformedPath = ["sessions", "v1", "malformed.txt"] as const;
    fileSystem.files.set(
      uriKey(joinPath(createTestUri("/storage"), ...malformedPath)),
      new Uint8Array([0xc3, 0x28]),
    );
    await expect(storage.readText(malformedPath, 2)).rejects.toThrow(TypeError);

    fileSystem.readError = Object.assign(new Error("provider failure"), {
      code: "FileNotFound",
    });
    await expect(storage.readText(["sessions", "v1", "provider-error.txt"], 32)).rejects.toThrow(
      "provider failure",
    );

    for (const path of [[], ["."], [".."], ["nested/file"], ["nested\\file"], ["drive:file"]]) {
      await expect(storage.readText(path as unknown as PersistencePath, 32)).rejects.toThrow(
        "Persistence paths must contain portable relative path segments.",
      );
    }
    expect(fileSystem.readCount).toBe(2);
  });

  it("preserves atomic rename failures and maps missing-file cleanup", async () => {
    const { storage, fileSystem } = createStorage();
    const source = ["sessions", "v1", "source.tmp"] as const;
    const target = ["sessions", "v1", "target.json"] as const;
    await storage.writeText(source, "content", 32);
    fileSystem.renameError = new Error("rename failed");

    await expect(storage.rename(source, target, true)).rejects.toThrow("rename failed");
    await expect(
      storage.deleteFile(["sessions", "v1", "never-created.tmp"]),
    ).resolves.toBeUndefined();
    fileSystem.deleteError = new Error("delete failed");
    await expect(storage.deleteFile(source)).rejects.toThrow("delete failed");
    expect(fileSystem.renameCalls.at(-1)?.overwrite).toBe(true);
  });

  it("reports existence and propagates non-missing stat failures", async () => {
    const { storage, fileSystem } = createStorage();
    const path = ["sessions", "v1", "manifest.json"] as const;
    await storage.writeText(path, "{}", 32);
    expect(await storage.exists(path)).toBe(true);
    expect(await storage.exists(["sessions", "v1", "missing.json"])).toBe(false);

    fileSystem.statError = new Error("stat failed");
    await expect(storage.exists(path)).rejects.toThrow("stat failed");
  });
});

function createStorage(): {
  readonly storage: VscodeBoundedTextStorage;
  readonly fileSystem: FakeFileSystem;
} {
  const fileSystem = new FakeFileSystem();
  const root = createTestUri("/storage");
  return {
    fileSystem,
    storage: new VscodeBoundedTextStorage({
      root,
      fileSystem,
      joinPath,
      isFileNotFound: (error) =>
        error instanceof FileNotFoundError && error.code === "FileNotFound",
    }),
  };
}

function joinPath(base: Uri, ...segments: string[]): Uri {
  return createTestUri({
    scheme: base.scheme,
    authority: base.authority,
    path: [base.path.replace(/\/$/u, ""), ...segments].join("/"),
    query: base.query,
    fragment: base.fragment,
  });
}

function uriKey(uri: Uri): string {
  return uri.toString();
}

class FileNotFoundError extends Error {
  readonly code = "FileNotFound";

  constructor() {
    super("File not found");
    this.name = "FileSystemError";
  }
}

class FakeFileSystem implements VscodeBoundedTextFileSystem {
  readonly directories = new Set<string>();
  readonly directoryEntries = new Map<string, [string, FileType][]>();
  readonly files = new Map<string, Uint8Array>();
  readonly renameCalls: Array<{
    readonly overwrite: boolean;
    readonly source: string;
    readonly target: string;
  }> = [];
  readCount = 0;
  deleteError: Error | undefined;
  readError: Error | undefined;
  renameError: Error | undefined;
  statError: Error | undefined;

  async createDirectory(uri: Uri): Promise<void> {
    this.directories.add(uriKey(uri));
  }

  async delete(uri: Uri, options?: Parameters<FileSystem["delete"]>[1]): Promise<void> {
    if (this.deleteError !== undefined) {
      throw this.deleteError;
    }
    const key = uriKey(uri);
    if (options?.recursive === true) {
      const prefix = `${key}/`;
      for (const file of this.files.keys()) {
        if (file.startsWith(prefix)) {
          this.files.delete(file);
        }
      }
      for (const directory of this.directories) {
        if (directory === key || directory.startsWith(prefix)) {
          this.directories.delete(directory);
        }
      }
      return;
    }
    if (!this.files.delete(key)) {
      throw new FileNotFoundError();
    }
  }

  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    return this.directoryEntries.get(uriKey(uri)) ?? [];
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    this.readCount += 1;
    if (this.readError !== undefined) {
      throw this.readError;
    }
    const content = this.files.get(uriKey(uri));
    if (content === undefined) {
      throw new FileNotFoundError();
    }
    return content;
  }

  async rename(
    source: Uri,
    target: Uri,
    options?: Parameters<FileSystem["rename"]>[2],
  ): Promise<void> {
    const overwrite = options?.overwrite ?? false;
    this.renameCalls.push({ overwrite, source: uriKey(source), target: uriKey(target) });
    if (this.renameError !== undefined) {
      throw this.renameError;
    }
    const content = this.files.get(uriKey(source));
    if (content === undefined) {
      throw new FileNotFoundError();
    }
    if (!overwrite && this.files.has(uriKey(target))) {
      throw new Error("destination exists");
    }
    this.files.set(uriKey(target), content);
    this.files.delete(uriKey(source));
  }

  async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    this.files.set(uriKey(uri), content);
  }

  async stat(uri: Uri): Promise<{
    readonly type: number;
    readonly ctime: number;
    readonly mtime: number;
    readonly size: number;
  }> {
    if (this.statError !== undefined) {
      throw this.statError;
    }
    const content = this.files.get(uriKey(uri));
    if (content === undefined && !this.directories.has(uriKey(uri))) {
      throw new FileNotFoundError();
    }
    return { type: 1, ctime: 0, mtime: 0, size: content?.byteLength ?? 0 };
  }
}
