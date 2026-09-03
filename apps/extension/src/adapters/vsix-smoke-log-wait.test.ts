import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

type SmokeLogWaitModule = {
  findFiles(directory: string, fileName: string): Promise<string[]>;
  maxSmokeLogReadBytes: number;
  maxSmokeLogSearchDepth: number;
  maxSmokeLogSearchEntries: number;
  readLogTail(logPath: string): Promise<string | undefined>;
};

// The smoke harness is intentionally CommonJS because VS Code loads its test host that way;
// this cast describes only the private helper surface exercised by this unit suite.
const smokeLogWait = createRequire(import.meta.url)(
  "../../scripts/vsix-smoke-harness/log-wait.cjs",
) as SmokeLogWaitModule;

test("reads only the bounded tail of a smoke log", async () => {
  await withTemporaryDirectory(async (temporaryDirectory) => {
    const logPath = join(temporaryDirectory, "CtrlZebra.log");
    await writeFile(
      logPath,
      `{"event":"old"}${"x".repeat(smokeLogWait.maxSmokeLogReadBytes)}{"event":"new"}`,
    );

    const tail = await smokeLogWait.readLogTail(logPath);

    assert.ok(tail !== undefined && tail.length <= smokeLogWait.maxSmokeLogReadBytes);
    assert.match(tail ?? "", /"event":"new"/u);
    assert.doesNotMatch(tail ?? "", /"event":"old"/u);
  });
});

test("enforces the bounded smoke log search entry count", async () => {
  await withTemporaryDirectory(async (temporaryDirectory) => {
    await Promise.all(
      Array.from({ length: smokeLogWait.maxSmokeLogSearchEntries + 1 }, (_, index) =>
        writeFile(join(temporaryDirectory, `entry-${index}.txt`), "fixture"),
      ),
    );

    await assert.rejects(
      smokeLogWait.findFiles(temporaryDirectory, "CtrlZebra.log"),
      /exceeded its bounded entry limit/u,
    );
  });
});

test("stops searching beyond the bounded directory depth", async () => {
  await withTemporaryDirectory(async (temporaryDirectory) => {
    let directory = temporaryDirectory;
    for (let depth = 0; depth <= smokeLogWait.maxSmokeLogSearchDepth; depth += 1) {
      directory = join(directory, `level-${depth}`);
      await mkdir(directory);
    }
    await writeFile(join(directory, "CtrlZebra.log"), '{"event":"too-deep"}');

    assert.deepEqual(await smokeLogWait.findFiles(temporaryDirectory, "CtrlZebra.log"), []);
  });
});

test("propagates non-missing-directory errors", async () => {
  await withTemporaryDirectory(async (temporaryDirectory) => {
    const filePath = join(temporaryDirectory, "not-a-directory");
    await writeFile(filePath, "fixture");

    await assert.rejects(smokeLogWait.findFiles(filePath, "CtrlZebra.log"), { code: "ENOTDIR" });
  });
});

async function withTemporaryDirectory<T>(
  callback: (temporaryDirectory: string) => Promise<T>,
): Promise<T> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "ctrl-zebra-smoke-log-test-"));
  try {
    return await callback(temporaryDirectory);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
