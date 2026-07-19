import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { persistenceFormatVersion } from "@ctrl-zebra/protocol";
import * as vscode from "vscode";

import {
  createWorkspaceSessionRepositoryProvider,
  WorkspaceSessionStorageUnavailableError,
} from "../../adapters/vscode-session-storage.js";

export async function verifySessionStorage(): Promise<void> {
  const unavailable = createWorkspaceSessionRepositoryProvider(undefined, vscode.workspace.fs);
  await assert.rejects(unavailable(), WorkspaceSessionStorageUnavailableError);

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "ctrl-zebra-session-storage-"));
  const root = vscode.Uri.file(temporaryDirectory);
  try {
    const repository = await createWorkspaceSessionRepositoryProvider(root, vscode.workspace.fs)();
    const manifest = {
      formatVersion: persistenceFormatVersion,
      sessionId: "session-1",
      status: "idle",
      createdAt: "2026-07-19T10:00:00.000Z",
      updatedAt: "2026-07-19T10:00:00.000Z",
      lastEventSequence: 0,
    } as const;

    await repository.create(manifest);
    await repository.appendEvent(manifest.sessionId, {
      sequence: 1,
      recordedAt: "2026-07-19T10:00:01.000Z",
      event: { type: "session.created", data: {} },
    });

    assert.equal((await repository.get(manifest.sessionId))?.events.length, 1);
    assert.deepEqual(await repository.list(), [
      { sessionId: manifest.sessionId, status: "idle", createdAt: manifest.createdAt },
    ]);
    const versionDirectory = vscode.Uri.joinPath(root, "sessions", "v1");
    assert.ok((await vscode.workspace.fs.stat(versionDirectory)).type & vscode.FileType.Directory);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
