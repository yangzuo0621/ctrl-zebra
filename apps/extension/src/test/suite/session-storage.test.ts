import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { persistenceFormatVersion } from "@ctrl-zebra/protocol";
import * as vscode from "vscode";
import {
  createWorkspaceCheckpointStoreProvider,
  WorkspaceCheckpointStorageUnavailableError,
} from "../../adapters/vscode-checkpoint-storage.js";
import {
  createWorkspaceSessionRepositoryProvider,
  WorkspaceSessionStorageUnavailableError,
} from "../../adapters/vscode-session-storage.js";

export async function verifySessionStorage(): Promise<void> {
  const unavailable = createWorkspaceSessionRepositoryProvider(undefined, vscode.workspace.fs);
  await assert.rejects(unavailable(), WorkspaceSessionStorageUnavailableError);
  const hashText = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  const unavailableCheckpoints = createWorkspaceCheckpointStoreProvider(
    undefined,
    vscode.workspace.fs,
    hashText,
  );
  await assert.rejects(unavailableCheckpoints(), WorkspaceCheckpointStorageUnavailableError);

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

    const checkpointStore = await createWorkspaceCheckpointStoreProvider(
      root,
      vscode.workspace.fs,
      hashText,
    )();
    const beforeContent = "before\n";
    const checkpoint = {
      id: "checkpoint-1",
      sessionId: manifest.sessionId,
      runId: "run-1",
      createdAt: "2026-07-19T10:00:02.000Z",
      files: [
        {
          uri: "file:///workspace/file.ts",
          beforeContent,
          beforeHash: hashText(beforeContent),
          afterHash: hashText("after\n"),
        },
      ],
    } as const;
    await checkpointStore.create(checkpoint, new AbortController().signal);
    const checkpointUri = vscode.Uri.joinPath(
      root,
      "checkpoints",
      "v1",
      "636865636b706f696e742d31.json",
    );
    const persistedCheckpoint = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(checkpointUri),
    );
    assert.deepEqual(JSON.parse(persistedCheckpoint), checkpoint);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
