import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WORKSPACE_PREFIX = "@ctrl-zebra/";

export const allowedWorkspaceDependencies = Object.freeze({
  extension: new Set(["builtin-tools", "core", "mcp-client", "protocol", "providers"]),
  webview: new Set(["protocol"]),
  core: new Set(["protocol"]),
  providers: new Set(["core"]),
  "builtin-tools": new Set(["core", "protocol"]),
  "mcp-client": new Set(["core"]),
  protocol: new Set(),
  testkit: new Set(["core", "protocol"]),
});

const sdkOwners = Object.freeze([
  { prefix: "vscode", owner: "extension", label: "VS Code API" },
  { prefix: "@types/vscode", owner: "extension", label: "VS Code types" },
  { prefix: "@ai-sdk/", owner: "providers", label: "Provider SDK" },
  { prefix: "ai", owner: "providers", label: "Provider SDK" },
  {
    prefix: "@modelcontextprotocol/",
    owner: "mcp-client",
    label: "MCP SDK",
  },
]);

const nodeHostModules = new Set(
  builtinModules.map((moduleName) => moduleName.replace(/^node:/, "")),
);

const architectureSourcePattern = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const coreForbiddenDependencies = Object.freeze(["vscode", "@types/vscode", "@types/node", "node"]);
const advisoryLimits = Object.freeze({
  maxFileBytes: 4 * 1024 * 1024,
  maxDuplicateBlocks: 100_000,
});

const baselineHotspots = Object.freeze({
  production: Object.freeze({
    "apps/extension/src/extension.ts": 1448,
    "apps/webview/src/chat-store.ts": 1444,
    "packages/core/src/agent-runtime.ts": 1269,
    "apps/extension/src/adapters/vscode-language-services.ts": 1135,
    "packages/protocol/src/messages.ts": 1083,
    "apps/extension/src/adapters/vscode-diagnostics.ts": 892,
    "packages/mcp-client/src/controlled-mcp-client.ts": 886,
    "apps/webview/src/app.tsx": 867,
    "apps/extension/src/controllers/session-recovery.ts": 798,
    "apps/extension/src/controllers/session-history.ts": 763,
    "apps/extension/src/controllers/chat-runner.ts": 679,
  }),
  tests: Object.freeze({
    "packages/core/src/agent-runtime.test.ts": 3029,
    "apps/extension/src/controllers/webview-message-controller.test.ts": 2044,
    "apps/webview/src/chat-store.test.ts": 1595,
    "apps/extension/src/controllers/session-recovery.test.ts": 1314,
    "apps/webview/src/app.test.tsx": 1215,
    "apps/extension/src/controllers/chat-runner.test.ts": 1186,
    "packages/protocol/src/messages.test.ts": 919,
  }),
  documents: Object.freeze({
    "docs/product.md": 312,
    "docs/security.md": 1356,
    "docs/ux.md": 634,
    "docs/protocol.md": 38,
    "docs/webview.md": 562,
    "docs/persistence.md": 631,
    "docs/engineering-opportunities.md": 165,
    "docs/configuration.md": 242,
    "docs/development.md": 178,
    "docs/architecture.md": 20,
  }),
});

export const advisoryThresholds = Object.freeze({
  productionLines: 650,
  testLines: 900,
  documentLines: 600,
});

function normalize(value) {
  return value.replaceAll("\\", "/");
}

function relativeTo(root, absolutePath) {
  return normalize(path.relative(root, absolutePath));
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function readJson(absolutePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    errors.push(`${relativeTo(process.cwd(), absolutePath)}: invalid JSON (${error.message})`);
    return null;
  }
}

function loadWorkspace(root, errors = []) {
  const owners = new Map();
  for (const group of ["apps", "packages"]) {
    const groupPath = path.join(root, group);
    if (!fs.existsSync(groupPath)) {
      errors.push(`${group}/: workspace directory is missing`);
      continue;
    }
    for (const entry of fs.readdirSync(groupPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageRoot = path.join(groupPath, entry.name);
      const manifestPath = path.join(packageRoot, "package.json");
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = readJson(manifestPath, errors);
      if (manifest === null || typeof manifest.name !== "string") {
        errors.push(`${relativeTo(root, manifestPath)}: package name is required`);
        continue;
      }
      const owner = entry.name;
      owners.set(owner, {
        owner,
        name: manifest.name,
        root: packageRoot,
        sourceRoot: path.join(packageRoot, "src"),
        manifest,
      });
    }
  }
  return owners;
}

function collectFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const ignoredDirectories = new Set([
    ".git",
    ".vscode-test",
    ".turbo",
    "coverage",
    "dist",
    "node_modules",
    "out",
  ]);
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) visit(path.join(current, entry.name));
        continue;
      }
      const filePath = path.join(current, entry.name);
      if (predicate(filePath)) files.push(filePath);
    }
  }
  visit(directory);
  return files;
}

function sourceFilesFor(workspace) {
  return [...workspace.values()].flatMap((entry) =>
    collectFiles(entry.sourceRoot, (filePath) => architectureSourcePattern.test(filePath)),
  );
}

function stripComments(source) {
  let result = "";
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote !== null) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      result += character;
      continue;
    }
    if (character === "/" && next === "/") {
      result += "  ";
      index += 1;
      while (index + 1 < source.length && source[index + 1] !== "\n") {
        result += " ";
        index += 1;
      }
      continue;
    }
    if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      while (index + 1 < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        result += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index + 1 < source.length) {
        result += "  ";
        index += 1;
      }
      continue;
    }
    result += character;
  }
  return result;
}

function readQuotedString(source, start) {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;
  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      if (index + 1 < source.length) value += source[++index];
      continue;
    }
    if (character === quote) return { value, end: index + 1 };
    value += character;
  }
  return null;
}

function importsFrom(filePath) {
  const source = stripComments(fs.readFileSync(filePath, "utf8"));
  const imports = [];
  const isIdentifierCharacter = (character) => /[A-Za-z0-9_$]/.test(character ?? "");
  const add = (specifier, index) => {
    imports.push({ specifier, line: source.slice(0, index).split("\n").length });
  };
  for (let index = 0; index < source.length; ) {
    const character = source[index];
    if (character === '"' || character === "'" || character === "`") {
      const quoted = character === "`" ? null : readQuotedString(source, index);
      if (quoted !== null) {
        index = quoted.end;
      } else {
        index += 1;
        while (index < source.length && source[index] !== "`") {
          if (source[index] === "\\") index += 1;
          index += 1;
        }
        index += 1;
      }
      continue;
    }
    if (!/[A-Za-z_$]/.test(character)) {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (isIdentifierCharacter(source[index])) index += 1;
    const word = source.slice(start, index);
    let cursor = index;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (word === "import" && source[cursor] === "(") {
      cursor += 1;
      while (/\s/.test(source[cursor] ?? "")) cursor += 1;
      const quoted = readQuotedString(source, cursor);
      if (quoted !== null) add(quoted.value, start);
      continue;
    }
    if (word === "import" && (source[cursor] === '"' || source[cursor] === "'")) {
      const quoted = readQuotedString(source, cursor);
      if (quoted !== null) add(quoted.value, start);
      continue;
    }
    if (word === "require" && source[cursor] === "(") {
      cursor += 1;
      while (/\s/.test(source[cursor] ?? "")) cursor += 1;
      const quoted = readQuotedString(source, cursor);
      if (quoted !== null) add(quoted.value, start);
      continue;
    }
    if (word === "from" && (source[cursor] === '"' || source[cursor] === "'")) {
      const quoted = readQuotedString(source, cursor);
      if (quoted !== null) add(quoted.value, start);
    }
  }
  return imports;
}

function sourceEntries(workspace, sourceFiles) {
  return sourceFiles.flatMap((filePath) => {
    const owner = [...workspace.values()].find((entry) => isWithin(entry.sourceRoot, filePath));
    return owner === undefined ? [] : [{ filePath, owner }];
  });
}

function declaredDependencies(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

function resolveLocalModule(filePath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(filePath), specifier);
  const sourceBase = base.replace(/\.(?:js|jsx|mjs|cjs)$/, "");
  for (const candidate of [
    base,
    sourceBase,
    `${sourceBase}.ts`,
    `${sourceBase}.tsx`,
    `${sourceBase}.js`,
    `${sourceBase}.jsx`,
    `${sourceBase}.mjs`,
    `${sourceBase}.cjs`,
    path.join(sourceBase, "index.ts"),
    path.join(sourceBase, "index.tsx"),
    path.join(sourceBase, "index.js"),
    path.join(sourceBase, "index.jsx"),
    path.join(sourceBase, "index.mjs"),
    path.join(sourceBase, "index.cjs"),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function sdkForSpecifier(specifier) {
  return sdkOwners.find((candidate) => {
    const prefix = candidate.prefix.endsWith("/") ? candidate.prefix : `${candidate.prefix}/`;
    return specifier === candidate.prefix || specifier.startsWith(prefix);
  });
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sdkSpecifiersFromReexports(filePath, visited = new Set()) {
  if (visited.has(filePath)) return new Set();
  visited.add(filePath);
  const source = stripComments(fs.readFileSync(filePath, "utf8"));
  const specifiers = new Set();
  const exportFromPattern =
    /\bexport\s+(?:type\s+)?(?:\*\s+as\s+[A-Za-z_$][\w$]*|\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(exportFromPattern)) {
    const specifier = match[1];
    const sdk = sdkForSpecifier(specifier);
    if (sdk !== undefined) {
      specifiers.add(specifier);
      continue;
    }
    const localModule = resolveLocalModule(filePath, specifier);
    if (localModule !== null) {
      for (const nested of sdkSpecifiersFromReexports(localModule, visited)) {
        specifiers.add(nested);
      }
    }
  }

  const sdkImportedBindings = new Map();
  const sdkImportPattern = /\bimport\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(sdkImportPattern)) {
    const sdk = sdkForSpecifier(match[2]);
    if (sdk === undefined) continue;
    for (const binding of match[1].split(",")) {
      const localName = binding
        .trim()
        .split(/\s+as\s+/)
        .at(-1);
      if (localName !== undefined && localName !== "") {
        sdkImportedBindings.set(localName, match[2]);
      }
    }
  }
  const defaultImportPattern =
    /\bimport\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(defaultImportPattern)) {
    if (sdkForSpecifier(match[2]) !== undefined) sdkImportedBindings.set(match[1], match[2]);
  }
  const namespaceImportPattern =
    /\bimport\s+(?:type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(namespaceImportPattern)) {
    if (sdkForSpecifier(match[2]) !== undefined) sdkImportedBindings.set(match[1], match[2]);
  }
  const localExportPattern = /\bexport\s+(?:type\s+)?\{([^}]*)\}(?!\s+from)/g;
  for (const match of source.matchAll(localExportPattern)) {
    for (const binding of match[1].split(",")) {
      const exportedName = binding.trim().split(/\s+as\s+/)[0];
      if (sdkImportedBindings.has(exportedName)) {
        specifiers.add(sdkImportedBindings.get(exportedName));
      }
    }
  }
  for (const [localName, specifier] of sdkImportedBindings) {
    const escaped = escapedRegExp(localName);
    const exportPatterns = [
      new RegExp(`\\bexport\\s+default\\s+${escaped}\\b`),
      new RegExp(`\\bexport\\s+type\\s+[A-Za-z_$][\\w$]*\\s*=\\s*${escaped}\\b`),
      new RegExp(`\\bexport\\s+(?:const|let|var)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*${escaped}\\b`),
    ];
    if (exportPatterns.some((pattern) => pattern.test(source))) specifiers.add(specifier);
  }
  return specifiers;
}

function publicEntryFiles(workspace) {
  const entries = new Set();
  for (const packageInfo of workspace.values()) {
    const rootExport = packageInfo.manifest.exports?.["."];
    const exportPath =
      typeof rootExport === "string"
        ? rootExport
        : (rootExport?.import ?? rootExport?.default ?? rootExport?.types);
    entries.add(
      path.resolve(packageInfo.root, typeof exportPath === "string" ? exportPath : "src/index.ts"),
    );
  }
  return entries;
}

function workspaceTarget(specifier, workspace) {
  for (const entry of workspace.values()) {
    if (specifier === entry.name || specifier.startsWith(`${entry.name}/`)) return entry;
  }
  return null;
}

function packageEdges(root, workspace, sourceFiles, failures) {
  const edges = new Map([...workspace.keys()].map((owner) => [owner, new Set()]));
  const actualImports = [];
  for (const { filePath, owner: importer } of sourceEntries(workspace, sourceFiles)) {
    for (const imported of importsFrom(filePath)) {
      const target = workspaceTarget(imported.specifier, workspace);
      if (target !== null && target.owner !== importer.owner) {
        edges.get(importer.owner).add(target.owner);
        actualImports.push({ importer, target, filePath, ...imported });
        const dependencyName = target.name.slice(WORKSPACE_PREFIX.length);
        const allowed = allowedWorkspaceDependencies[importer.owner] ?? new Set();
        if (!allowed.has(dependencyName)) {
          failures.push(
            `${relativeTo(importer.root, filePath)}:${imported.line}: ${importer.name} imports ${target.name}, ` +
              `but that direction is not allowed; move the dependency behind the owning package's public entry point`,
          );
        }
        if (imported.specifier !== target.name) {
          failures.push(
            `${relativeTo(importer.root, filePath)}:${imported.line}: deep cross-package import ${imported.specifier}; ` +
              `import ${target.name} from its public entry point instead`,
          );
        }
        const declared = declaredDependencies(importer.manifest);
        if (!declared.has(target.name)) {
          failures.push(
            `${relativeTo(importer.root, filePath)}:${imported.line}: ${target.name} is imported by ${importer.name} ` +
              `but is missing from its package.json; declare the workspace dependency in the importing owner`,
          );
        }
      }

      if (imported.specifier.startsWith(".")) {
        const resolved = path.resolve(path.dirname(filePath), imported.specifier);
        const target = [...workspace.values()].find(
          (entry) => entry.owner !== importer.owner && isWithin(entry.root, resolved),
        );
        if (target !== undefined) {
          failures.push(
            `${relativeTo(importer.root, filePath)}:${imported.line}: relative cross-package import ${imported.specifier} ` +
              `reaches ${target.name}; use the target's public package entry point`,
          );
        }
      }
    }
  }

  for (const importer of workspace.values()) {
    const declared = declaredDependencies(importer.manifest);
    for (const targetName of declared) {
      const target = workspaceTarget(targetName, workspace);
      if (target === null || target.owner === importer.owner) continue;
      edges.get(importer.owner).add(target.owner);
      const allowed = allowedWorkspaceDependencies[importer.owner] ?? new Set();
      const dependencyName = target.name.slice(WORKSPACE_PREFIX.length);
      if (!allowed.has(dependencyName)) {
        failures.push(
          `${relativeTo(root, path.join(importer.root, "package.json"))}: ${importer.name} declares ${target.name}, ` +
            `but that direction is not allowed; remove it or move the integration to the owning package`,
        );
      }
    }
  }
  return { edges, actualImports };
}

function findCycles(edges) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function visit(owner) {
    if (visiting.has(owner)) {
      const start = stack.indexOf(owner);
      cycles.push([...stack.slice(start), owner]);
      return;
    }
    if (visited.has(owner)) return;
    visiting.add(owner);
    stack.push(owner);
    for (const target of edges.get(owner) ?? []) visit(target);
    stack.pop();
    visiting.delete(owner);
    visited.add(owner);
  }
  for (const owner of edges.keys()) visit(owner);
  return cycles;
}

function checkSdkBoundaries(workspace, sourceFiles, failures) {
  const publicEntries = publicEntryFiles(workspace);
  for (const { filePath, owner: importer } of sourceEntries(workspace, sourceFiles)) {
    for (const imported of importsFrom(filePath)) {
      const sdk = sdkOwners.find((candidate) => {
        const prefix = candidate.prefix.endsWith("/") ? candidate.prefix : `${candidate.prefix}/`;
        return imported.specifier === candidate.prefix || imported.specifier.startsWith(prefix);
      });
      if (sdk === undefined) continue;
      if (importer.owner !== sdk.owner) {
        failures.push(
          `${relativeTo(importer.root, filePath)}:${imported.line}: ${sdk.label} import ${imported.specifier} crosses ` +
            `${sdk.owner}'s public boundary; keep SDK types, failures, and adapters inside ${sdk.owner} and expose ` +
            `CtrlZebra-owned contracts instead`,
        );
      }
      if (publicEntries.has(filePath)) {
        failures.push(
          `${relativeTo(importer.root, filePath)}:${imported.line}: public package entry imports ${sdk.label} ` +
            `${imported.specifier}; re-export only CtrlZebra-owned types from the public boundary`,
        );
      }
    }
  }
  for (const filePath of publicEntries) {
    if (!fs.existsSync(filePath)) continue;
    const leakedSdkSpecifiers = sdkSpecifiersFromReexports(filePath);
    if (leakedSdkSpecifiers.size === 0) continue;
    const owner = [...workspace.values()].find((entry) => isWithin(entry.root, filePath));
    if (owner === undefined) continue;
    failures.push(
      `${relativeTo(owner.root, filePath)}: public package entry transitively re-exports ${[...leakedSdkSpecifiers].join(", ")}; ` +
        `keep SDK types and failures private to the owning adapter and expose CtrlZebra-owned contracts instead`,
    );
  }
}

function checkCoreHostIsolation(workspace, sourceFiles, failures) {
  const core = workspace.get("core");
  if (core === undefined) return;
  const coreManifestPath = path.join(core.root, "package.json");
  for (const dependency of declaredDependencies(core.manifest)) {
    const isNodeHostDependency =
      coreForbiddenDependencies.includes(dependency) || nodeHostModules.has(dependency);
    const sdk = sdkForSpecifier(dependency);
    if (!isNodeHostDependency && sdk === undefined) continue;
    const label = sdk?.label ?? "Node Host API";
    failures.push(
      `${relativeTo(core.root, coreManifestPath)}: packages/core declares ${dependency} (${label}); ` +
        `remove the host/vendor dependency and keep Core dependent only on Core-owned contracts`,
    );
  }
  const coreFiles = sourceEntries(workspace, sourceFiles).filter(
    ({ owner }) => owner.owner === "core",
  );
  for (const { filePath } of coreFiles) {
    for (const imported of importsFrom(filePath)) {
      const isNodeHostImport =
        imported.specifier.startsWith("node:") ||
        [...nodeHostModules].some(
          (moduleName) =>
            imported.specifier === moduleName || imported.specifier.startsWith(`${moduleName}/`),
        );
      if (isNodeHostImport) {
        failures.push(
          `${relativeTo(core.root, filePath)}:${imported.line}: packages/core imports ${imported.specifier}; ` +
            `keep Node Host APIs out of Core and inject a Core-owned capability instead`,
        );
      }
    }
  }
}

function countLines(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (stat.size > advisoryLimits.maxFileBytes) return null;
  const source = fs.readFileSync(filePath, "utf8");
  return source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
}

function readAdvisoryFile(filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size > advisoryLimits.maxFileBytes) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function isGeneratedPath(relative) {
  return (
    /(^|\/)(generated|gen|__generated__)(?:\/|\.|$)/i.test(relative) ||
    /\.(?:generated|gen)\.(?:ts|tsx|md)$/i.test(relative)
  );
}

function collectDeletedPathRegressions(root) {
  try {
    const output = execFileSync(
      "git",
      [
        "log",
        "--no-renames",
        "--diff-filter=D",
        "--name-only",
        "--format=",
        "471f9177961c06ec8d6d7965a2b79890615523c2..HEAD",
        "--",
        "apps",
        "packages",
        "docs",
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return [...new Set(output.split(/\r?\n/).filter(Boolean))].filter((relative) =>
      fs.existsSync(path.join(root, relative)),
    );
  } catch {
    return null;
  }
}

function collectAdvisory(root, workspace, sourceFiles) {
  const production = sourceFiles.filter(
    (filePath) =>
      !/\.test\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath) &&
      !relativeTo(root, filePath).split("/").includes("test") &&
      !relativeTo(root, filePath).split("/").includes("fixtures") &&
      !isGeneratedPath(relativeTo(root, filePath)),
  );
  const tests = sourceFiles.filter(
    (filePath) =>
      /\.test\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath) &&
      !isGeneratedPath(relativeTo(root, filePath)),
  );
  const documents = collectFiles(path.join(root, "docs"), (filePath) => {
    const relative = relativeTo(root, filePath);
    return /\.md$/.test(filePath) && !isGeneratedPath(relative);
  });
  function ranked(files, threshold) {
    return files
      .map((filePath) => ({ path: relativeTo(root, filePath), lines: countLines(filePath) }))
      .filter((entry) => entry.lines >= threshold)
      .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path))
      .slice(0, 12);
  }

  const baselineComparison = [];
  for (const [category, entries] of Object.entries(baselineHotspots)) {
    for (const [relativePath, baseline] of Object.entries(entries)) {
      const current = countLines(path.join(root, relativePath));
      baselineComparison.push({
        category,
        path: relativePath,
        baseline,
        current,
        delta: current === null ? null : current - baseline,
      });
    }
  }

  const duplicateCandidates = [];
  const blocks = new Map();
  let duplicateScanCapped = false;
  for (const filePath of production) {
    const owner = [...workspace.values()].find((entry) =>
      isWithin(entry.sourceRoot, filePath),
    )?.owner;
    if (owner === undefined) continue;
    const source = readAdvisoryFile(filePath);
    if (source === null) continue;
    const lines = stripComments(source)
      .split("\n")
      .map((line) => line.trim());
    for (let index = 0; index + 2 < lines.length; index += 1) {
      const window = lines.slice(index, index + 3);
      if (
        window.some(
          (line) => line.length < 24 || line.startsWith("import ") || line.startsWith("export "),
        )
      ) {
        continue;
      }
      const block = window.join(" ");
      if (/^[{}()[\],.;:+\-*/]+$/.test(block)) continue;
      const key = block;
      const existing = blocks.get(key) ?? [];
      if (!existing.some((entry) => entry.path === relativeTo(root, filePath))) {
        if (blocks.size >= advisoryLimits.maxDuplicateBlocks) {
          duplicateScanCapped = true;
          break;
        }
        existing.push({ path: relativeTo(root, filePath), owner });
        blocks.set(key, existing);
      }
    }
  }
  for (const [block, entries] of blocks) {
    const owners = new Set(entries.map((entry) => entry.owner));
    if (owners.size > 1) duplicateCandidates.push({ block, entries });
  }

  let changedSinceBaseline = null;
  try {
    const output = execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        "471f9177961c06ec8d6d7965a2b79890615523c2..HEAD",
        "--",
        "apps",
        "packages",
        "docs",
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    changedSinceBaseline = output.split(/\r?\n/).filter(Boolean);
  } catch {
    // Advisory only: shallow clones and source archives do not have the baseline revision.
  }

  const changeSurface =
    changedSinceBaseline === null ? null : summarizeChangeSurface(changedSinceBaseline);

  return {
    productionHotspots: ranked(production, advisoryThresholds.productionLines),
    testHotspots: ranked(tests, advisoryThresholds.testLines),
    documentHotspots: ranked(documents, advisoryThresholds.documentLines),
    baselineComparison,
    duplicateCandidates: duplicateCandidates.slice(0, 10),
    duplicateScanCapped,
    changedSinceBaseline,
    changeSurface,
    deletedPathRegressions: collectDeletedPathRegressions(root),
  };
}

function summarizeChangeSurface(relativePaths) {
  const summary = {
    files: relativePaths.length,
    production: 0,
    tests: 0,
    documents: 0,
    manifests: 0,
    owners: new Set(),
  };
  for (const relativePath of relativePaths) {
    const normalized = normalize(relativePath);
    const ownerMatch = normalized.match(/^(?:apps|packages)\/([^/]+)\//);
    if (ownerMatch !== null) summary.owners.add(ownerMatch[1]);
    if (/^docs\//.test(normalized)) summary.documents += 1;
    else if (/(?:^|\/)package\.json$/.test(normalized)) summary.manifests += 1;
    else if (/\.test\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(normalized)) summary.tests += 1;
    else if (/^(?:apps|packages)\//.test(normalized)) summary.production += 1;
  }
  return { ...summary, owners: [...summary.owners].sort() };
}

export function analyzeArchitecture(root = process.cwd()) {
  const failures = [];
  const workspace = loadWorkspace(root, failures);
  const sourceFiles = sourceFilesFor(workspace);
  const { edges, actualImports } = packageEdges(root, workspace, sourceFiles, failures);
  for (const cycle of findCycles(edges)) {
    failures.push(
      `workspace dependency cycle ${cycle.join(" -> ")}; remove the edge or restore the documented package direction`,
    );
  }
  checkSdkBoundaries(workspace, sourceFiles, failures);
  checkCoreHostIsolation(workspace, sourceFiles, failures);
  return {
    failures: [...new Set(failures)],
    workspace,
    edges,
    actualImports,
    advisory: collectAdvisory(root, workspace, sourceFiles),
  };
}

function formatAdvisory(advisory) {
  const lines = ["Advisory architecture signals (review-only; never a CI hard fail):"];
  for (const [label, entries] of [
    ["production hotspots", advisory.productionHotspots],
    ["test hotspots", advisory.testHotspots],
    ["document hotspots", advisory.documentHotspots],
  ]) {
    lines.push(
      `- ${label}: ${entries.length === 0 ? "none above the baseline threshold" : entries.map((entry) => `${entry.path} (${entry.lines} lines)`).join(", ")}`,
    );
  }
  const regressions = advisory.baselineComparison.filter(
    (entry) =>
      entry.current !== null && entry.delta > Math.max(32, Math.ceil(entry.baseline * 0.1)),
  );
  lines.push(
    `- hotspot regressions: ${regressions.length === 0 ? "none" : regressions.map((entry) => `${entry.path} (+${entry.delta})`).join(", ")}`,
  );
  lines.push(
    `- representative change surface: ${advisory.changeSurface === null ? "unavailable in this checkout" : `${advisory.changeSurface.files} paths; production=${advisory.changeSurface.production}, tests=${advisory.changeSurface.tests}, docs=${advisory.changeSurface.documents}, manifests=${advisory.changeSurface.manifests}, owners=${advisory.changeSurface.owners.length} (${advisory.changeSurface.owners.join(", ") || "none"})`}`,
  );
  lines.push(
    `- deleted-path regressions: ${advisory.deletedPathRegressions === null ? "unavailable in this checkout" : advisory.deletedPathRegressions.length === 0 ? "none" : advisory.deletedPathRegressions.join(", ")}`,
  );
  lines.push(
    `- conservative cross-owner duplicate candidates: ${advisory.duplicateCandidates.length === 0 ? "none" : `${advisory.duplicateCandidates.length} (inspect ownership before acting)`}${advisory.duplicateScanCapped ? "; scan capped at the advisory resource limit" : ""}`,
  );
  return lines.join("\n");
}

export function formatReport(result) {
  const hardGate = result.failures.length === 0 ? "PASSED" : "FAILED";
  const lines = [`Architecture hard gates: ${hardGate}`];
  if (result.failures.length > 0) {
    for (const failure of result.failures) lines.push(`- ${failure}`);
  }
  lines.push(formatAdvisory(result.advisory));
  return lines.join("\n");
}

const invokedPath =
  process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  const result = analyzeArchitecture(process.cwd());
  console.log(formatReport(result));
  if (result.failures.length > 0) process.exitCode = 1;
}
