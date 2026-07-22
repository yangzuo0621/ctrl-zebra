import type { RunCommandExecutor, RunCommandInput } from "@ctrl-zebra/builtin-tools";
import type { Uri } from "vscode";
import type { CommandCwdBinding } from "./command-approval-workflow.js";
import type { CommandOutputRunner } from "./command-output-collector.js";
import { runCommandWithCollectedOutput } from "./command-output-collector.js";
import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

interface WorkspaceScopeValidator {
  validate(target: Uri, signal: AbortSignal): Promise<Uri>;
}

interface WorkspaceCommandExecutorDependencies {
  readonly getSelectedRoot: () => Uri;
  readonly createScope: (root: Uri) => WorkspaceScopeValidator;
  readonly joinPath: (root: Uri, path: string) => Uri;
  readonly stat: (uri: Uri) => Promise<{ readonly type: number }>;
  readonly runner: CommandOutputRunner;
  readonly workspaceTrust: WorkspaceTrustPolicy;
  readonly environment: Readonly<Record<string, string>>;
}

interface WorkspaceCommandCwdBinding extends CommandCwdBinding {
  readonly cwdPath: string;
}

const directoryFileType = 2;

export class WorkspaceCommandExecutor implements RunCommandExecutor {
  constructor(private readonly dependencies: WorkspaceCommandExecutorDependencies) {}

  async bindCwd(cwd: string, signal: AbortSignal): Promise<WorkspaceCommandCwdBinding> {
    this.dependencies.workspaceTrust.requireTrusted();
    signal.throwIfAborted();
    const selectedRoot = this.dependencies.getSelectedRoot();
    const scope = this.dependencies.createScope(selectedRoot);
    const target = cwd === "." ? selectedRoot : this.dependencies.joinPath(selectedRoot, cwd);
    const canonicalRoot = await scope.validate(selectedRoot, signal);
    const canonicalCwd = await scope.validate(target, signal);
    signal.throwIfAborted();
    const stat = await this.dependencies.stat(canonicalCwd);
    signal.throwIfAborted();
    if ((stat.type & directoryFileType) === 0 || canonicalCwd.scheme !== "file") {
      throw new InvalidCommandCwdError();
    }

    return {
      workspaceRootUri: canonicalRoot.toString(),
      cwdUri: canonicalCwd.toString(),
      cwdPath: canonicalCwd.fsPath,
    };
  }

  async run(input: RunCommandInput, signal: AbortSignal) {
    const binding = await this.bindCwd(input.cwd, signal);
    signal.throwIfAborted();
    this.dependencies.workspaceTrust.requireTrusted();
    const collected = await runCommandWithCollectedOutput(
      this.dependencies.runner,
      {
        command: input.command,
        args: input.args,
        cwd: binding.cwdPath,
        timeoutMs: input.timeoutMs,
        environment: this.dependencies.environment,
      },
      signal,
    );

    return {
      output: {
        stdout: collected.display.stdout,
        stderr: collected.display.stderr,
        exitCode: collected.exit.code,
        signal: collected.exit.signal,
      },
      truncated: collected.display.truncated,
    };
  }
}

export class InvalidCommandCwdError extends Error {
  constructor() {
    super("The command working directory is not a canonical local workspace directory.");
    this.name = "InvalidCommandCwdError";
  }
}

export function selectCommandEnvironment(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Readonly<Record<string, string>> {
  const allowed =
    platform === "win32"
      ? new Set(["path", "pathext", "systemroot", "windir", "temp", "tmp"])
      : new Set(["PATH", "LANG", "LC_ALL", "TMPDIR"]);
  const selected: Record<string, string> = {};

  for (const [name, value] of Object.entries(source)) {
    const comparable = platform === "win32" ? name.toLocaleLowerCase("en-US") : name;
    if (value !== undefined && allowed.has(comparable)) {
      selected[name] = value;
    }
  }

  return selected;
}
