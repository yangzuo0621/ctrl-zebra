import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const checker = fileURLToPath(new URL("./check-governance-docs.mjs", import.meta.url));

test("checks tracked Markdown throughout the repository without scanning ignored artifacts", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ctrl-zebra-docs-"));
  const write = (relativePath, content) => {
    const destination = path.join(fixture, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  };
  const check = () => spawnSync(process.execPath, [checker], { cwd: fixture, encoding: "utf8" });
  try {
    // Copy tracked inputs only; the fixture never mutates the user's index or copies ignored state.
    const files = execFileSync("git", ["ls-files", "-z"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean);
    for (const file of files) {
      const source = path.join(repositoryRoot, file);
      if (fs.existsSync(source)) write(file, fs.readFileSync(source));
    }
    execFileSync("git", ["init", "--quiet"], { cwd: fixture });
    execFileSync("git", ["add", "--all"], { cwd: fixture });
    let result = check();
    assert.equal(result.status, 0, result.stderr);

    for (const file of [
      "docs/nested/审计 notes.md",
      ".agents/skills/fixture/SKILL.md",
      ".codex/audit.md",
    ]) {
      write(file, "[Missing target](missing.md)\n");
      execFileSync("git", ["add", "--", file], { cwd: fixture });
      result = check();
      assert.equal(result.status, 1, `Expected missing target in ${file} to fail`);
      assert.match(result.stderr, /missing\.md: file is missing/);

      write(file, "# Available\n\n[Missing anchor](#absent)\n");
      result = check();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /missing link target #absent/);

      write(file, "# Available\n\n[Valid anchor](#available)\n");
      result = check();
      assert.equal(result.status, 0, result.stderr);
    }

    write(".gitignore", "ignored/\n");
    write("ignored/broken.md", "[Missing](missing.md)\n");
    result = check();
    assert.equal(result.status, 0, result.stderr);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith("ctrl-zebra-docs-"));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
