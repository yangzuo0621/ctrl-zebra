const assert = require("node:assert/strict");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");

const {
  findFiles,
  maxSmokeLogReadBytes,
  maxSmokeLogSearchDepth,
  maxSmokeLogSearchEntries,
  readLogTail,
} = require("./log-wait.cjs");

test("reads only the bounded tail of a smoke log", async () => {
  const root = await createTemporaryDirectory();
  try {
    const logPath = join(root, "CtrlZebra.log");
    await writeFile(logPath, `{"event":"old"}${"x".repeat(maxSmokeLogReadBytes)}{"event":"new"}`);

    const tail = await readLogTail(logPath);

    assert.ok(tail.length <= maxSmokeLogReadBytes);
    assert.match(tail, /"event":"new"/u);
    assert.doesNotMatch(tail, /"event":"old"/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enforces the bounded smoke log search entry count", async () => {
  const root = await createTemporaryDirectory();
  try {
    await Promise.all(
      Array.from({ length: maxSmokeLogSearchEntries + 1 }, (_, index) =>
        writeFile(join(root, `entry-${index}.txt`), "fixture"),
      ),
    );

    await assert.rejects(findFiles(root, "CtrlZebra.log"), /exceeded its bounded entry limit/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops searching beyond the bounded directory depth", async () => {
  const root = await createTemporaryDirectory();
  try {
    let directory = root;
    for (let depth = 0; depth <= maxSmokeLogSearchDepth; depth += 1) {
      directory = join(directory, `level-${depth}`);
      await mkdir(directory);
    }
    await writeFile(join(directory, "CtrlZebra.log"), '{"event":"too-deep"}');

    assert.deepEqual(await findFiles(root, "CtrlZebra.log"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("propagates non-missing-directory errors", async () => {
  const root = await createTemporaryDirectory();
  try {
    const filePath = join(root, "not-a-directory");
    await writeFile(filePath, "fixture");

    await assert.rejects(findFiles(filePath, "CtrlZebra.log"), { code: "ENOTDIR" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createTemporaryDirectory() {
  return await mkdtemp(join(tmpdir(), "ctrl-zebra-smoke-log-test-"));
}
