import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

describe("T2206 release verification integration", () => {
  it("requires version-specific CHANGELOG notes for a detached matching tag", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "ctrl-zebra-release-"));
    const repositoryRoot = resolve(".");
    const realGitPath = execFileSync(
      process.platform === "win32" ? "where.exe" : "which",
      ["git"],
      {
        encoding: "utf8",
      },
    )
      .split(/\r?\n/u)
      .find(Boolean)
      ?.trim();
    if (!realGitPath) {
      throw new Error("Unable to locate the real git executable for the release integration test.");
    }

    const bareRepository = join(temporaryDirectory, "repository.git");
    try {
      const currentCommit = execFileSync(realGitPath, ["rev-parse", "HEAD"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }).trim();
      await execFile(realGitPath, ["clone", "--bare", "--quiet", repositoryRoot, bareRepository], {
        cwd: repositoryRoot,
      });
      execFileSync(realGitPath, [
        "--git-dir",
        bareRepository,
        "tag",
        "--force",
        "v0.1.1",
        currentCommit,
      ]);
      execFileSync(realGitPath, [
        "--git-dir",
        bareRepository,
        "update-ref",
        "--no-deref",
        "HEAD",
        currentCommit,
      ]);

      const environment: NodeJS.ProcessEnv = { ...process.env, GIT_DIR: bareRepository };
      delete environment.GITHUB_ACTIONS;
      delete environment.GITHUB_REF;
      delete environment.GITHUB_REF_TYPE;
      await expect(
        execFile(process.execPath, [resolve("scripts", "verify-release.mjs")], {
          cwd: repositoryRoot,
          env: environment,
          maxBuffer: 1024 * 1024,
        }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringMatching(/CHANGELOG\.md is missing the ## \[0\.1\.1\] release notes/u),
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 30_000);
});
