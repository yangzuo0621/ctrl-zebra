const { open, opendir } = require("node:fs/promises");
const { join } = require("node:path");

// These bounds cover the known VS Code log layout while preventing a malformed
// isolated profile from turning readiness polling into an unbounded scan.
const agentViewReadyTimeoutMs = 10_000;
const agentViewReadyPollIntervalMs = 50;
const maxSmokeLogSearchDepth = 8;
const maxSmokeLogSearchEntries = 512;
const maxSmokeLogReadBytes = 64 * 1024;

async function waitForStructuredLogEvent(event, logRoot) {
  const deadline = Date.now() + agentViewReadyTimeoutMs;
  while (Date.now() < deadline) {
    if (await logContainsEvent(event, logRoot)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, agentViewReadyPollIntervalMs));
  }
  throw new Error(`The installed extension did not emit ${event} after focusing the Agent view.`);
}

async function logContainsEvent(event, logRoot) {
  if (logRoot === undefined) {
    throw new Error(
      "The installed-extension smoke harness cannot locate its isolated user-data directory.",
    );
  }
  for (const logPath of await findFiles(logRoot, "CtrlZebra.log")) {
    const log = await readLogTail(logPath);
    if (log?.includes(`"event":"${event}"`)) {
      return true;
    }
  }
  return false;
}

async function readLogTail(logPath) {
  let handle;
  try {
    handle = await open(logPath, "r");
    const { size } = await handle.stat();
    const bytesToRead = Math.min(size, maxSmokeLogReadBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      bytesToRead,
      Math.max(0, size - bytesToRead),
    );
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function findFiles(directory, fileName, depth = 0, searchState = { entries: 0 }) {
  if (depth > maxSmokeLogSearchDepth) {
    return [];
  }

  const matches = [];
  let directoryHandle;
  try {
    directoryHandle = await opendir(directory);
  } catch (error) {
    if (isFileNotFound(error)) {
      return matches;
    }
    throw error;
  }

  for await (const entry of directoryHandle) {
    searchState.entries += 1;
    if (searchState.entries > maxSmokeLogSearchEntries) {
      throw new Error("The installed-extension smoke log search exceeded its bounded entry limit.");
    }
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findFiles(entryPath, fileName, depth + 1, searchState)));
    } else if (entry.isFile() && entry.name === fileName) {
      matches.push(entryPath);
    }
  }
  return matches;
}

function isFileNotFound(error) {
  return error !== null && typeof error === "object" && error.code === "ENOENT";
}

module.exports = {
  findFiles,
  maxSmokeLogReadBytes,
  maxSmokeLogSearchDepth,
  maxSmokeLogSearchEntries,
  readLogTail,
  waitForStructuredLogEvent,
};
