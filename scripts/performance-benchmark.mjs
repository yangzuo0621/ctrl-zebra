import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import yauzl from "yauzl";
import {
  validateArchiveEntries,
  validateSelectedFiles,
} from "../apps/extension/scripts/vsix-policy.mjs";
import fixture from "./performance-fixtures.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const extensionRoot = join(repositoryRoot, "apps", "extension");
const extensionManifest = JSON.parse(await readFile(join(extensionRoot, "package.json"), "utf8"));
const defaultOutput = join(repositoryRoot, ".artifacts", "performance", "baseline.json");
const defaultRuns = 5;
const defaultWarmups = 1;
const thresholds = {
  extensionActivationMs: 25,
  webviewFirstUsableMs: 1_100,
  sessionRestoreMs: 25,
  workspaceSearchMs: 500,
  mcpCatalogLoadMs: 400,
  steadyStateMemoryBytes: 384 * 1024 * 1024,
  peakMemoryBytes: 384 * 1024 * 1024,
  webviewBundleBytes: 700_000,
  vsixBytes: 5 * 1024 * 1024,
};
const platformSensitiveMetrics = new Set([
  "extensionActivationMs",
  "webviewFirstUsableMs",
  "sessionRestoreMs",
  "workspaceSearchMs",
  "mcpCatalogLoadMs",
  "steadyStateMemoryBytes",
  "peakMemoryBytes",
]);

const options = parseOptions(process.argv.slice(2));
const outputPath = resolve(repositoryRoot, options.output);
await mkdir(dirname(outputPath), { recursive: true });

for (let index = 0; index < options.warmups; index += 1) {
  await runIntegration(`warmup-${index}`);
}

const samples = [];
for (let index = 0; index < options.runs; index += 1) {
  const label = `sample-${index + 1}`;
  const resultPath = join(dirname(outputPath), `${label}.json`);
  const extensionPath = join(dirname(outputPath), `${label}.extension.jsonl`);
  await runIntegration(label, resultPath, extensionPath);
  samples.push(JSON.parse(await readFile(resultPath, "utf8")));
}
const cardinalities = verifyCardinalities(samples);

const bundleBytes = await readBundleBytes();
const vsix = await packageForSizeMeasurement();
const report = {
  schemaVersion: 1,
  fixtureVersion: fixture.schemaVersion,
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    vscode: "1.125.0",
    runs: options.runs,
    warmups: options.warmups,
    source: (await git(["rev-parse", "HEAD"])).trim(),
  },
  fixture,
  cardinalities,
  distributions: summarize(samples),
  sizes: {
    webviewBundleBytes: bundleBytes,
    vsixBytes: vsix.compressedBytes,
    vsixUncompressedBytes: vsix.uncompressedBytes,
  },
  thresholds,
  policy: {
    platformSensitive: [
      "extensionActivationMs",
      "webviewFirstUsableMs",
      "sessionRestoreMs",
      "workspaceSearchMs",
      "mcpCatalogLoadMs",
      "steadyStateMemoryBytes",
      "peakMemoryBytes",
    ],
    deterministic: ["webviewBundleBytes", "vsixBytes"],
    comparison:
      "Compare platform-sensitive distributions only with the same OS, Node, VS Code, fixture, and run mode. A single noisy sample is not threshold evidence.",
    thresholdEvidenceEnvironment: {
      platform: "win32",
      arch: "x64",
      node: "v24.19.0",
      vscode: "1.125.0",
    },
  },
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    { outputPath, report: summarizeForConsole(report), failures: checkThresholds(report) },
    null,
    2,
  ),
);

const failures = checkThresholds(report);
if (failures.length > 0) {
  console.error(
    `Performance budget exceeded. Re-run ${relativeCommand(outputPath)} on the same environment before changing a threshold.`,
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

async function runIntegration(label, resultPath, extensionPath) {
  const actualResultPath = resultPath ?? join(dirname(outputPath), `${label}.discarded.json`);
  const actualExtensionPath = extensionPath ?? join(tmpdir(), `ctrl-zebra-${label}.jsonl`);
  await rm(actualResultPath, { force: true });
  await rm(actualExtensionPath, { force: true });
  const env = {
    ...process.env,
    CTRL_ZEBRA_PERFORMANCE_BENCHMARK: "1",
    CTRL_ZEBRA_PERFORMANCE_RESULT: actualResultPath,
    CTRL_ZEBRA_PERFORMANCE_OUTPUT: actualExtensionPath,
  };
  await runPnpm(["test:integration"], env);
}

async function readBundleBytes() {
  const paths = [
    join(extensionRoot, "dist", "webview", "main.js"),
    join(extensionRoot, "dist", "webview", "main.css"),
  ];
  const sizes = await Promise.all(paths.map(async (path) => (await stat(path)).size));
  return sizes.reduce((total, size) => total + size, 0);
}

async function packageForSizeMeasurement() {
  const artifactPath = join(dirname(outputPath), "performance-size.vsix");
  const vsce = join(repositoryRoot, "node_modules", "@vscode", "vsce", "vsce");
  await writeFile(
    join(extensionRoot, "dist", "package", "build-metadata.json"),
    `${JSON.stringify({ schemaVersion: 1, commit: (await git(["rev-parse", "HEAD"])).trim(), version: extensionManifest.version })}\n`,
    "utf8",
  );
  const selected = (await run(process.execPath, [vsce, "ls", "--no-dependencies"], extensionRoot))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  validateSelectedFiles(selected);
  await run(
    process.execPath,
    [vsce, "package", "--no-dependencies", "--out", artifactPath],
    extensionRoot,
  );
  const archiveStat = await stat(artifactPath);
  const zipFile = await yauzl.openPromise(artifactPath, {
    lazyEntries: true,
    validateEntrySizes: true,
  });
  const entries = [];
  for await (const entry of zipFile.eachEntry()) {
    entries.push({ fileName: entry.fileName, uncompressedSize: entry.uncompressedSize });
  }
  return validateArchiveEntries(entries, archiveStat.size);
}

function summarize(samples) {
  const names = Object.keys(samples[0].metrics);
  return Object.fromEntries(
    names.map((name) => [name, distribution(samples.map(({ metrics }) => metrics[name]))]),
  );
}

function verifyCardinalities(samples) {
  const first = samples[0]?.cardinalities;
  if (first === undefined) throw new Error("Performance samples must include cardinalities.");
  const expected = JSON.stringify(first);
  for (let index = 1; index < samples.length; index += 1) {
    if (JSON.stringify(samples[index]?.cardinalities) !== expected) {
      throw new Error(`Performance sample ${index + 1} cardinalities differ from sample 1.`);
    }
  }
  return first;
}

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1),
  };
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function checkThresholds(report) {
  const failures = [];
  const sizeNames = new Set(["webviewBundleBytes", "vsixBytes"]);
  const environmentMatches =
    report.environment.platform === "win32" &&
    report.environment.arch === "x64" &&
    report.environment.node === "v24.19.0" &&
    report.environment.vscode === "1.125.0";
  for (const [name, limit] of Object.entries(thresholds)) {
    if (platformSensitiveMetrics.has(name) && !environmentMatches) continue;
    const actual = sizeNames.has(name) ? report.sizes[name] : report.distributions[name]?.p95;
    if (actual !== undefined && actual > limit) {
      failures.push(
        `${name} p95/observed ${actual} exceeds ${limit}; inspect the raw JSON distribution and environment before changing the budget.`,
      );
    }
  }
  return failures;
}

function summarizeForConsole(report) {
  return {
    environment: report.environment,
    distributions: report.distributions,
    sizes: report.sizes,
  };
}

function parseOptions(args) {
  const values = { runs: defaultRuns, warmups: defaultWarmups, output: defaultOutput };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--runs") values.runs = parsePositiveInteger(args[++index], "--runs");
    else if (argument === "--warmups")
      values.warmups = parseNonNegativeInteger(args[++index], "--warmups");
    else if (argument === "--output") values.output = args[++index] ?? defaultOutput;
    else throw new Error(`Unknown performance benchmark option: ${argument}`);
  }
  return values;
}

function parsePositiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20)
    throw new Error(`${option} must be an integer from 1 to 20.`);
  return parsed;
}

function parseNonNegativeInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 20)
    throw new Error(`${option} must be an integer from 0 to 20.`);
  return parsed;
}

async function runPnpm(args, env) {
  if (process.platform !== "win32") {
    return run("pnpm", args, repositoryRoot, env);
  }

  const pnpmScript = await resolveWindowsPnpmScript();
  if (pnpmScript !== undefined) {
    return run(process.execPath, [pnpmScript, ...args], repositoryRoot, env);
  }
  return run(
    "cmd.exe",
    ["/d", "/s", "/c", `pnpm ${args.map(quoteWindowsArgument).join(" ")}`],
    repositoryRoot,
    env,
  );
}

async function resolveWindowsPnpmScript() {
  const candidates = [];
  if (process.env.npm_execpath !== undefined) candidates.push(process.env.npm_execpath);
  if (process.env.APPDATA !== undefined) {
    candidates.push(join(process.env.APPDATA, "npm", "node_modules", "pnpm", "bin", "pnpm.mjs"));
  }
  try {
    const located = await execFileAsync("where.exe", ["pnpm.cmd"], { encoding: "utf8" });
    const command = located.stdout.split(/\r?\n/u).find(Boolean);
    if (command !== undefined) {
      candidates.push(join(dirname(command.trim()), "node_modules", "pnpm", "bin", "pnpm.mjs"));
    }
  } catch {
    // The cmd.exe fallback below provides the actionable process error if pnpm is unavailable.
  }
  return candidates.find((candidate) => existsSync(candidate));
}

function quoteWindowsArgument(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function run(executable, args, cwd, env) {
  const result = await execFileAsync(executable, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}

async function git(args) {
  return run("git", args, repositoryRoot, process.env);
}

function relativeCommand(path) {
  return `pnpm benchmark:performance -- --output ${path.replaceAll("\\", "/")}`;
}
