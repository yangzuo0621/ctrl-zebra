import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dependabotPath = path.join(root, ".github", "dependabot.yml");
const errors = [];

function expect(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function readPolicyLines(source) {
  return source.split(/\r?\n/).flatMap((raw, index) => {
    if (raw.includes("\t")) {
      errors.push(`.github/dependabot.yml:${index + 1}: tabs are not valid indentation`);
    }
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      return [];
    }
    return [{ indent: raw.length - raw.trimStart().length, line: index + 1, text: trimmed }];
  });
}

function expectedUpdateLines(ecosystem, versioningStrategy) {
  const lines = [
    [2, `- package-ecosystem: ${ecosystem}`],
    [4, 'directory: "/"'],
    [4, "schedule:"],
    [6, "interval: weekly"],
    [6, "day: sunday"],
    [6, 'time: "06:00"'],
    [6, "timezone: UTC"],
    [4, "target-branch: main"],
  ];
  if (versioningStrategy !== undefined) {
    lines.push([4, `versioning-strategy: ${versioningStrategy}`]);
  }
  lines.push(
    [4, "open-pull-requests-limit: 5"],
    [4, "groups:"],
    [6, "minor-and-patch:"],
    [8, "applies-to: version-updates"],
    [8, "patterns:"],
    [10, '- "*"'],
    [8, "update-types:"],
    [10, "- minor"],
    [10, "- patch"],
  );
  return lines;
}

function expectedPolicyLines() {
  return [
    [0, "version: 2"],
    [0, "updates:"],
    ...expectedUpdateLines("npm", "increase"),
    ...expectedUpdateLines("github-actions"),
  ];
}

function checkDependabotConfiguration() {
  expect(fs.existsSync(dependabotPath), ".github/dependabot.yml: file is missing");
  if (!fs.existsSync(dependabotPath)) {
    return;
  }

  const source = fs.readFileSync(dependabotPath, "utf8");
  const actual = readPolicyLines(source);
  const expected = expectedPolicyLines();
  expect(
    actual.length === expected.length,
    `.github/dependabot.yml: expected ${expected.length} policy lines, found ${actual.length}`,
  );
  for (let index = 0; index < Math.min(actual.length, expected.length); index += 1) {
    const [indent, text] = expected[index];
    const line = actual[index];
    expect(
      line.indent === indent && line.text === text,
      `.github/dependabot.yml:${line.line}: expected ${" ".repeat(indent)}${text}`,
    );
  }
  expect(
    !/^\s*(?:auto-?merge|automerge)\s*:/im.test(source),
    ".github/dependabot.yml: automatic merging is not allowed",
  );

  const packageJsonPath = path.join(root, "package.json");
  const lockfilePath = path.join(root, "pnpm-lock.yaml");
  expect(fs.existsSync(lockfilePath), "pnpm-lock.yaml: committed lockfile is required");
  expect(fs.existsSync(packageJsonPath), "package.json: file is missing");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      expect(
        /^pnpm@\d/.test(packageJson.packageManager),
        "package.json: pnpm packageManager is required",
      );
    } catch (error) {
      errors.push(`package.json: ${error.message}`);
    }
  }
  if (fs.existsSync(lockfilePath)) {
    const lockfile = fs.readFileSync(lockfilePath, "utf8");
    expect(
      /^lockfileVersion:\s*['"]?\d+\.\d+['"]?/m.test(lockfile),
      "pnpm-lock.yaml: lockfile version is required",
    );
  }
}

function stripComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && quote === '"') {
      index += 1;
      continue;
    }
    if ((character === '"' || character === "'") && (quote === null || quote === character)) {
      quote = quote === null ? character : null;
    } else if (character === "#" && quote === null) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function checkWorkflowActionReferences() {
  const workflowsPath = path.join(root, ".github", "workflows");
  expect(fs.existsSync(workflowsPath), ".github/workflows: directory is missing");
  if (!fs.existsSync(workflowsPath)) {
    return;
  }
  const workflowFiles = fs
    .readdirSync(workflowsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:yml|yaml)$/.test(entry.name));
  expect(workflowFiles.length > 0, ".github/workflows: no workflow files found");
  const fixedReference = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/;
  let actionCount = 0;
  for (const entry of workflowFiles) {
    const workflowPath = path.join(workflowsPath, entry.name);
    const lines = fs.readFileSync(workflowPath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const withoutComment = stripComment(line);
      if (!/^\s*(?:-\s*)?uses\s*:/.test(withoutComment)) {
        return;
      }
      const match = /^\s*(?:-\s*)?uses\s*:\s*(\S+)\s*$/.exec(withoutComment);
      actionCount += 1;
      if (match === null || !fixedReference.test(match[1])) {
        errors.push(
          `${path.relative(root, workflowPath)}:${index + 1}: Action must use a full 40-character commit SHA`,
        );
      }
    });
  }
  expect(actionCount > 0, ".github/workflows: at least one Action reference is required");
}

try {
  checkDependabotConfiguration();
  checkWorkflowActionReferences();
} catch (error) {
  errors.push(`dependency update policy check crashed: ${error.message}`);
}

if (errors.length > 0) {
  console.error("Dependency update policy check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Dependency update policy check passed.");
}
