import type { RunCommandInput } from "@ctrl-zebra/builtin-tools";
import { describe, expect, it, vi } from "vitest";
import type { Uri } from "vscode";

import {
  InvalidCommandCwdError,
  selectCommandEnvironment,
  WorkspaceCommandExecutor,
} from "./workspace-command-executor.js";

const input: RunCommandInput = {
  command: "node",
  args: ["check.mjs"],
  cwd: "packages/core",
  timeoutMs: 30_000,
};

describe("WorkspaceCommandExecutor", () => {
  it("canonicalizes and rechecks trust immediately before direct execution", async () => {
    const dependencies = createDependencies();
    const executor = new WorkspaceCommandExecutor(dependencies.values);

    await expect(executor.run(input, new AbortController().signal)).resolves.toEqual({
      output: { stdout: "ok", stderr: "", exitCode: 0, signal: null },
      truncated: false,
    });
    expect(dependencies.validate).toHaveBeenCalledTimes(2);
    expect(dependencies.runCommand).toHaveBeenCalledWith(
      {
        command: "node",
        args: ["check.mjs"],
        cwd: expect.stringMatching(/packages[\\/]core$/u),
        timeoutMs: 30_000,
        environment: { PATH: "safe-path" },
      },
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it("rejects trust loss after canonical validation without spawning", async () => {
    const dependencies = createDependencies();
    dependencies.validate.mockImplementation(async (target) => {
      dependencies.setTrusted(false);
      return target;
    });
    const executor = new WorkspaceCommandExecutor(dependencies.values);

    await expect(executor.run(input, new AbortController().signal)).rejects.toThrow(
      "Trust this workspace",
    );
    expect(dependencies.runCommand).not.toHaveBeenCalled();
  });

  it("rejects a canonical cwd that is not a directory", async () => {
    const dependencies = createDependencies();
    dependencies.stat.mockResolvedValue({ type: 1 });
    const executor = new WorkspaceCommandExecutor(dependencies.values);

    await expect(executor.bindCwd(input.cwd, new AbortController().signal)).rejects.toBeInstanceOf(
      InvalidCommandCwdError,
    );
  });
});

describe("selectCommandEnvironment", () => {
  it("keeps only the explicit platform allowlist", () => {
    expect(
      selectCommandEnvironment(
        {
          PATH: "/bin",
          LANG: "en_US.UTF-8",
          HOME: "/secret-home",
          API_TOKEN: "secret",
        },
        "linux",
      ),
    ).toEqual({ PATH: "/bin", LANG: "en_US.UTF-8" });
    expect(
      selectCommandEnvironment(
        { Path: "safe-path", PATHEXT: ".EXE", USERPROFILE: "C:/secret", TOKEN: "secret" },
        "win32",
      ),
    ).toEqual({ Path: "safe-path", PATHEXT: ".EXE" });
  });
});

function createDependencies() {
  let trusted = true;
  const root = uri("/workspace");
  const validate = vi.fn(async (target: Uri) => target);
  const stat = vi.fn(async () => ({ type: 2 }));
  const runCommand = vi.fn(async (_request, _signal, emit) => {
    emit({ type: "stdout", text: "ok" });
    const exit = { type: "exit", code: 0, signal: null } as const;
    emit(exit);
    return exit;
  });
  return {
    values: {
      getSelectedRoot: () => root,
      createScope: () => ({ validate }),
      joinPath: (_root: Uri, path: string) => uri(`/workspace/${path}`),
      stat,
      runner: { run: runCommand },
      workspaceTrust: {
        isTrusted: () => trusted,
        requireTrusted() {
          if (!trusted) {
            throw new Error("Trust this workspace before using file writes or command execution.");
          }
        },
      },
      environment: { PATH: "safe-path" },
    },
    validate,
    stat,
    runCommand,
    setTrusted(value: boolean) {
      trusted = value;
    },
  };
}

function uri(path: string): Uri {
  return {
    scheme: "file",
    authority: "",
    path,
    query: "",
    fragment: "",
    fsPath: path.replaceAll("/", "\\"),
    with: (change) => uri(change.path ?? path),
    toString: () => `file://${path}`,
    toJSON: () => ({ scheme: "file", path }),
  };
}
