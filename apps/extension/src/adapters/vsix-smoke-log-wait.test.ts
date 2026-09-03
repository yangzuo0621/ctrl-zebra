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

const smokeLogWait = createRequire(import.meta.url)(
  "../../scripts/vsix-smoke-harness/log-wait.cjs",
) as SmokeLogWaitModule;

test("reads only the bounded tail of a smoke log", async () => {
  const root = await createTemporaryDirectory();
  try {
    const logPath = join(root, "CtrlZebra.log");
    await writeFile(
      logPath,
      `{"event":"old"}${"x".repeat(smokeLogWait.maxSmokeLogReadBytes)}{"event":"new"}`,
    );

    const tail = await smokeLogWait.readLogTail(logPath);

    assert.ok(tail !== undefined && tail.length <= smokeLogWait.maxSmokeLogReadBytes);
    assert.match(tail ?? "", /"event":"new"/u);
    assert.doesNotMatch(tail ?? "", /"event":"old"/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enforces the bounded smoke log search entry count", async () => {
  const root = await createTemporaryDirectory();
  try {
    await Promise.all(
      Array.from({ length: smokeLogWait.maxSmokeLogSearchEntries + 1 }, (_, index) =>
        writeFile(join(root, `entry-${index}.txt`), "fixture"),
      ),
    );

    await assert.rejects(
      smokeLogWait.findFiles(root, "CtrlZebra.log"),
      /exceeded its bounded entry limit/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops searching beyond the bounded directory depth", async () => {
  const root = await createTemporaryDirectory();
  try {
    let directory = root;
    for (let depth = 0; depth <= smokeLogWait.maxSmokeLogSearchDepth; depth += 1) {
      directory = join(directory, `level-${depth}`);
      await mkdir(directory);
    }
    await writeFile(join(directory, "CtrlZebra.log"), '{"event":"too-deep"}');

    assert.deepEqual(await smokeLogWait.findFiles(root, "CtrlZebra.log"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("propagates non-missing-directory errors", async () => {
  const root = await createTemporaryDirectory();
  try {
    const filePath = join(root, "not-a-directory");
    await writeFile(filePath, "fixture");

    await assert.rejects(smokeLogWait.findFiles(filePath, "CtrlZebra.log"), { code: "ENOTDIR" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createTemporaryDirectory() {
  return await mkdtemp(join(tmpdir(), "ctrl-zebra-smoke-log-test-"));
}
