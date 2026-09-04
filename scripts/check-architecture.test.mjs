import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeArchitecture } from "./check-architecture.mjs";

function fixture({ imports = {}, dependencies = {}, extraFiles = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ctrl-zebra-architecture-"));
  const packages = {
    extension: { name: "ctrl-zebra", deps: [] },
    webview: { name: "@ctrl-zebra/webview", deps: ["@ctrl-zebra/protocol"] },
    core: { name: "@ctrl-zebra/core", deps: ["@ctrl-zebra/protocol"] },
    protocol: { name: "@ctrl-zebra/protocol", deps: [] },
    providers: { name: "@ctrl-zebra/providers", deps: ["@ctrl-zebra/core"] },
    "builtin-tools": {
      name: "@ctrl-zebra/builtin-tools",
      deps: ["@ctrl-zebra/core", "@ctrl-zebra/protocol"],
    },
    "mcp-client": { name: "@ctrl-zebra/mcp-client", deps: ["@ctrl-zebra/core"] },
    testkit: { name: "@ctrl-zebra/testkit", deps: ["@ctrl-zebra/core"] },
  };
  for (const [owner, packageInfo] of Object.entries(packages)) {
    const directory = owner === "extension" || owner === "webview" ? "apps" : "packages";
    const packageRoot = path.join(root, directory, owner);
    fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
    const extra = dependencies[owner] ?? [];
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: packageInfo.name,
        dependencies: Object.fromEntries(
          [...packageInfo.deps, ...extra].map((name) => [name, "workspace:*"]),
        ),
      }),
    );
    fs.writeFileSync(path.join(packageRoot, "src", "index.ts"), imports[owner] ?? "export {};\n");
    for (const [relativePath, content] of Object.entries(extraFiles[owner] ?? {})) {
      const filePath = path.join(packageRoot, "src", relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }
  }
  return root;
}

function failureFor(root, text) {
  return analyzeArchitecture(root).failures.some((failure) => failure.includes(text));
}

function withFixture(options, callback) {
  let root;
  try {
    root = fixture(options);
    return callback(root);
  } finally {
    if (root !== undefined) fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the checked-in workspace is a positive fixture for every hard gate", () => {
  const result = analyzeArchitecture(path.resolve("."));
  assert.deepEqual(result.failures, []);
});

test("rejects a forbidden package direction and an undeclared edge", () => {
  withFixture(
    {
      imports: { core: 'import type { X } from "@ctrl-zebra/providers";\n' },
      dependencies: { core: [] },
    },
    (root) => {
      assert.equal(failureFor(root, "direction is not allowed"), true);
      assert.equal(failureFor(root, "missing from its package.json"), true);
    },
  );
});

test("rejects dependency cycles", () => {
  withFixture({ dependencies: { protocol: ["@ctrl-zebra/core"] } }, (root) => {
    assert.equal(failureFor(root, "workspace dependency cycle"), true);
  });
});

test("rejects deep and relative cross-package imports", () => {
  withFixture(
    { imports: { extension: 'import "@ctrl-zebra/core/src/internal.js";\n' } },
    (root) => {
      assert.equal(failureFor(root, "deep cross-package import"), true);
    },
  );
  withFixture({}, (root) => {
    fs.writeFileSync(
      path.join(root, "apps", "extension", "src", "relative.ts"),
      'import "../../../packages/core/src/index.ts";\n',
    );
    assert.equal(failureFor(root, "relative cross-package import"), true);
  });
});

test("rejects Host APIs and Provider SDKs from Core", () => {
  withFixture(
    {
      imports: {
        core: 'import "vscode";\nimport "node:fs";\nimport "http";\nimport "@ai-sdk/openai";\n',
      },
      dependencies: { core: ["ai"] },
      extraFiles: { core: { "host-api.mjs": 'require("node:fs");\n' } },
    },
    (root) => {
      assert.equal(failureFor(root, "VS Code API import vscode crosses"), true);
      assert.equal(failureFor(root, "packages/core imports node:fs"), true);
      assert.equal(failureFor(root, "packages/core imports http"), true);
      assert.equal(failureFor(root, "Provider SDK import @ai-sdk/openai crosses"), true);
      assert.equal(failureFor(root, "packages/core declares ai"), true);
      assert.equal(failureFor(root, "packages/core imports node:fs"), true);
    },
  );
});

test("ignores import-like text inside string literals", () => {
  withFixture(
    { imports: { core: "const message = 'use import \"@ctrl-zebra/providers\"';\n" } },
    (root) => {
      assert.deepEqual(analyzeArchitecture(root).failures, []);
    },
  );
});

test("rejects Webview dependencies on host-side packages", () => {
  withFixture({ imports: { webview: 'import "@ctrl-zebra/core";\n' } }, (root) => {
    assert.equal(failureFor(root, "webview imports @ctrl-zebra/core"), true);
  });
});

test("rejects SDK imports outside their owner and from public entries", () => {
  withFixture({ imports: { extension: 'import "@modelcontextprotocol/client";\n' } }, (root) => {
    assert.equal(failureFor(root, "MCP SDK import @modelcontextprotocol/client crosses"), true);
    assert.equal(failureFor(root, "public package entry imports MCP SDK"), true);
  });
  withFixture(
    {
      imports: { providers: 'export type { LanguageModel } from "./sdk-types.js";\n' },
      extraFiles: {
        providers: {
          "sdk-types.ts": 'import type { LanguageModel } from "ai";\nexport { LanguageModel };\n',
        },
      },
    },
    (root) => {
      assert.equal(failureFor(root, "public package entry transitively re-exports ai"), true);
    },
  );
  withFixture(
    {
      imports: { providers: 'export { default } from "./sdk-types.js";\n' },
      extraFiles: {
        providers: {
          "sdk-types.ts": 'import sdk from "ai";\nexport default sdk;\n',
        },
      },
    },
    (root) => {
      assert.equal(failureFor(root, "public package entry transitively re-exports ai"), true);
    },
  );
  withFixture(
    {
      imports: { providers: 'export { default } from "./sdk-types.js";\n' },
      extraFiles: {
        providers: {
          "sdk-types.ts":
            'import type { LanguageModel } from "ai";\nexport type PublicModel = LanguageModel;\n',
        },
      },
    },
    (root) => {
      assert.equal(failureFor(root, "public package entry transitively re-exports ai"), true);
    },
  );
  // A default import combined with named imports in one statement, from the same SDK, where
  // only the named binding is later re-exported.
  withFixture(
    {
      imports: { providers: 'export { Named } from "./sdk-types.js";\n' },
      extraFiles: {
        providers: {
          "sdk-types.ts": 'import Default, { Named } from "ai";\nexport { Named };\n',
        },
      },
    },
    (root) => {
      assert.equal(failureFor(root, "public package entry transitively re-exports ai"), true);
    },
  );
});

test("excludes generated source files from advisory hotspots", () => {
  withFixture(
    {
      extraFiles: {
        core: {
          "generated.ts": `${Array.from({ length: 700 }, () => "const generatedLine = 1;").join("\n")}\n`,
        },
      },
    },
    (root) => {
      assert.equal(
        analyzeArchitecture(root).advisory.productionHotspots.some((entry) =>
          entry.path.endsWith("/generated.ts"),
        ),
        false,
      );
    },
  );
});
