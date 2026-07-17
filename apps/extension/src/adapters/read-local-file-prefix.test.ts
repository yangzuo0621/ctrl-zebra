import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readLocalFilePrefix } from "./read-local-file-prefix.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("readLocalFilePrefix", () => {
  it("reads at most the requested byte count and detects more content", async () => {
    const path = await createFile(new Uint8Array([1, 2, 3, 4, 5]));

    await expect(readLocalFilePrefix(path, 3, new AbortController().signal)).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      truncated: true,
    });
  });

  it("returns a complete small file without truncation", async () => {
    const path = await createFile(new Uint8Array([1, 2]));

    await expect(readLocalFilePrefix(path, 3, new AbortController().signal)).resolves.toEqual({
      bytes: new Uint8Array([1, 2]),
      truncated: false,
    });
  });

  it("does not open a file after cancellation", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel local read");
    controller.abort(cancellation);

    await expect(readLocalFilePrefix("missing.txt", 3, controller.signal)).rejects.toBe(
      cancellation,
    );
  });
});

async function createFile(content: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ctrl-zebra-read-file-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "file.bin");
  await writeFile(path, content);
  return path;
}
