import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportUrl = "https://github.com/yangzuo0621/ctrl-zebra/security/advisories/new";
const errors = [];

const requiredFiles = [
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "README.md",
  "PRIVACY.md",
  "docs/product.md",
  ".github/CODEOWNERS",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/bug-report.yml",
  ".github/ISSUE_TEMPLATE/feature-request.yml",
  ".github/pull_request_template.md",
];

const text = new Map();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`${relativePath}: file is missing`);
    return "";
  }
  if (fs.statSync(absolutePath).isDirectory()) {
    text.set(relativePath, "");
    return "";
  }
  const value = fs.readFileSync(absolutePath, "utf8");
  text.set(relativePath, value);
  return value;
}

function requireText(relativePath, expected) {
  const value = text.get(relativePath) ?? read(relativePath);
  if (!value.includes(expected)) {
    errors.push(`${relativePath}: missing expected text ${JSON.stringify(expected)}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

function markdownSlug(value) {
  return value
    .replace(/[`*_]/g, "")
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function headings(value) {
  return new Set(
    value.split(/\r?\n/).flatMap((line) => {
      const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
      return match === null ? [] : [markdownSlug(match[1])];
    }),
  );
}

function checkMarkdownLinks(relativePath) {
  const value = text.get(relativePath) ?? read(relativePath);
  const sourceDirectory = path.dirname(relativePath);
  const sourceHeadings = headings(value);
  const linkPattern = /(?<!!)(?:\[[^\]]+\])\((<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\)/g;

  for (const match of value.matchAll(linkPattern)) {
    let target = match[1];
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    }
    if (target.startsWith("http://")) {
      errors.push(`${relativePath}: insecure external link ${target}`);
      continue;
    }
    if (target.startsWith("https://") || target.startsWith("mailto:")) {
      continue;
    }

    const [targetPath, fragment] = target.split("#", 2);
    const decodedPath = decodeURIComponent(targetPath.split("?", 1)[0]);
    const resolvedPath =
      decodedPath === "" ? relativePath : path.join(sourceDirectory, decodedPath);
    const normalizedPath = path.normalize(resolvedPath).replaceAll("\\", "/");
    const targetValue = text.get(normalizedPath) ?? read(normalizedPath);
    if (targetValue === "") {
      continue;
    }
    if (fragment !== undefined) {
      const targetHeadings =
        normalizedPath === relativePath ? sourceHeadings : headings(targetValue);
      if (!targetHeadings.has(fragment.toLowerCase())) {
        errors.push(`${relativePath}: missing link target ${target}`);
      }
    }
  }
}

function checkRequiredFormFields(relativePath, ids) {
  const value = text.get(relativePath) ?? read(relativePath);
  for (const id of ids) {
    const idMatch = new RegExp(`\\bid:\\s*${escapeRegExp(id)}\\b`).exec(value);
    if (idMatch === null) {
      errors.push(`${relativePath}: missing field id ${id}`);
      continue;
    }
    const nextBodyItem = value.indexOf("\n  - type:", idMatch.index + idMatch[0].length);
    const fieldBlock = value.slice(
      idMatch.index,
      nextBodyItem === -1 ? value.length : nextBodyItem,
    );
    if (!/validations:\s*\n\s+required:\s+true/.test(fieldBlock)) {
      errors.push(`${relativePath}: field ${id} must be required`);
    }
  }
}

for (const relativePath of requiredFiles) {
  read(relativePath);
}

requireText("SECURITY.md", reportUrl);
requireText("SECURITY.md", "Do not open a public issue or pull request");
requireText("SECURITY.md", "[product security contract](docs/security.md)");
requireText("SECURITY.md", "[release policy](docs/release.md)");
requireText("CONTRIBUTING.md", "[Security Policy](SECURITY.md)");
requireText("CONTRIBUTING.md", "pnpm test:docs");
requireText("CONTRIBUTING.md", "[.github/CODEOWNERS](.github/CODEOWNERS)");
requireText("README.md", "[contributor guide](CONTRIBUTING.md)");
requireText("README.md", "[Security Policy](SECURITY.md)");
requireText("README.md", "[Changelog](CHANGELOG.md)");
requireText("PRIVACY.md", "[Security Policy](SECURITY.md)");
requireText(".github/pull_request_template.md", "[SECURITY.md](../SECURITY.md)");

const owners = text.get(".github/CODEOWNERS") ?? "";
if (!/^\s*\*\s+@yangzuo0621\s*$/m.test(owners)) {
  errors.push(".github/CODEOWNERS: missing default owner @yangzuo0621");
}

const issueConfig = text.get(".github/ISSUE_TEMPLATE/config.yml") ?? "";
requireText(".github/ISSUE_TEMPLATE/config.yml", "blank_issues_enabled: false");
requireText(".github/ISSUE_TEMPLATE/config.yml", reportUrl);
if (!issueConfig.includes("contact_links:")) {
  errors.push(".github/ISSUE_TEMPLATE/config.yml: missing contact_links");
}

checkRequiredFormFields(".github/ISSUE_TEMPLATE/bug-report.yml", [
  "summary",
  "steps-to-reproduce",
  "expected-behavior",
  "version",
  "environment",
]);
checkRequiredFormFields(".github/ISSUE_TEMPLATE/feature-request.yml", [
  "problem",
  "proposed-change",
]);

for (const expected of [
  "## Summary",
  "## Scope",
  "## Verification",
  "## Contributor checklist",
  "## Reuse and Similarity Audit",
  "[SECURITY.md](../SECURITY.md)",
]) {
  requireText(".github/pull_request_template.md", expected);
}

for (const relativePath of [
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "README.md",
  "PRIVACY.md",
  "docs/product.md",
  ".github/pull_request_template.md",
]) {
  checkMarkdownLinks(relativePath);
}

if (errors.length > 0) {
  console.error("Governance documentation check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Governance documentation check passed.");
}
