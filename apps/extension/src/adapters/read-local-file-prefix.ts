import { open } from "node:fs/promises";

import type { ReadFileBytes } from "@ctrl-zebra/builtin-tools";

export async function readLocalFilePrefix(
  path: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<ReadFileBytes> {
  signal.throwIfAborted();
  const handle = await open(path, "r");

  try {
    const buffer = new Uint8Array(maxBytes + 1);
    let totalBytes = 0;

    while (totalBytes < buffer.byteLength) {
      signal.throwIfAborted();
      // FileHandle.read has no AbortSignal; the post-read check discards bytes after cancellation.
      const { bytesRead } = await handle.read(
        buffer,
        totalBytes,
        buffer.byteLength - totalBytes,
        totalBytes,
      );
      signal.throwIfAborted();
      if (bytesRead === 0) {
        break;
      }

      totalBytes += bytesRead;
    }

    return {
      bytes: buffer.slice(0, Math.min(totalBytes, maxBytes)),
      truncated: totalBytes > maxBytes,
    };
  } finally {
    await handle.close();
  }
}
