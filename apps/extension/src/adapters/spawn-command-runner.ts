import { type ChildProcess, spawn } from "node:child_process";
import { kill as killProcess, platform as processPlatform } from "node:process";

export const defaultProcessTreeTerminationTimeoutMs = 5_000;

export interface SpawnCommandRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly environment: Readonly<Record<string, string>>;
}

export type CommandOutputEvent =
  | { readonly type: "stdout"; readonly text: string }
  | { readonly type: "stderr"; readonly text: string }
  | CommandExit;

export interface CommandExit {
  readonly type: "exit";
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export type CommandOutputSink = (event: CommandOutputEvent) => void;

interface ProcessTreeTarget {
  readonly pid: number;
  isClosed(): boolean;
}

interface TerminationHelper {
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

interface ProcessTreeTerminatorDependencies {
  readonly platform: NodeJS.Platform;
  readonly killProcess: (pid: number, signal: NodeJS.Signals) => void;
  readonly startTaskkill: (args: readonly string[]) => TerminationHelper;
  readonly helperTimeoutMs: number;
}

export interface CommandProcessTreeTerminator {
  terminate(target: ProcessTreeTarget): Promise<void>;
}

export class NodeCommandProcessTreeTerminator implements CommandProcessTreeTerminator {
  readonly #dependencies: ProcessTreeTerminatorDependencies;

  constructor(dependencies: Partial<ProcessTreeTerminatorDependencies> = {}) {
    this.#dependencies = {
      platform: dependencies.platform ?? processPlatform,
      killProcess: dependencies.killProcess ?? killProcess,
      startTaskkill:
        dependencies.startTaskkill ??
        ((args) =>
          spawn("taskkill", [...args], {
            shell: false,
            windowsHide: true,
            stdio: "ignore",
          })),
      helperTimeoutMs: dependencies.helperTimeoutMs ?? defaultProcessTreeTerminationTimeoutMs,
    };
  }

  async terminate(target: ProcessTreeTarget): Promise<void> {
    if (target.isClosed()) {
      return;
    }

    if (this.#dependencies.platform === "win32") {
      await this.#terminateWindowsTree(target);
      return;
    }

    try {
      this.#dependencies.killProcess(-target.pid, "SIGKILL");
    } catch (error) {
      if (!target.isClosed()) {
        throw new CommandTerminationError({ cause: error });
      }
    }
  }

  async #terminateWindowsTree(target: ProcessTreeTarget): Promise<void> {
    const helper = this.#dependencies.startTaskkill(["/pid", String(target.pid), "/t", "/f"]);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        helper.kill("SIGKILL");
        reject(new CommandTerminationError());
      }, this.#dependencies.helperTimeoutMs);

      helper.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(new CommandTerminationError({ cause: error }));
      });
      helper.once("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (code === 0 || target.isClosed()) {
          resolve();
          return;
        }
        reject(new CommandTerminationError());
      });
    });
  }
}

interface SpawnCommandRunnerDependencies {
  readonly platform: NodeJS.Platform;
  readonly spawnProcess: typeof spawn;
  readonly terminator: CommandProcessTreeTerminator;
  readonly closeTimeoutMs: number;
}

export class SpawnCommandRunner {
  readonly #dependencies: SpawnCommandRunnerDependencies;

  constructor(dependencies: Partial<SpawnCommandRunnerDependencies> = {}) {
    const platform = dependencies.platform ?? processPlatform;
    this.#dependencies = {
      platform,
      spawnProcess: dependencies.spawnProcess ?? spawn,
      terminator: dependencies.terminator ?? new NodeCommandProcessTreeTerminator({ platform }),
      closeTimeoutMs: dependencies.closeTimeoutMs ?? defaultProcessTreeTerminationTimeoutMs,
    };
  }

  run(
    request: SpawnCommandRequest,
    signal: AbortSignal,
    emit: CommandOutputSink,
  ): Promise<CommandExit> {
    if (
      request.command.length === 0 ||
      !Number.isSafeInteger(request.timeoutMs) ||
      request.timeoutMs <= 0
    ) {
      return Promise.reject(new InvalidCommandRunRequestError());
    }
    if (signal.aborted) {
      return Promise.reject(signal.reason);
    }

    let child: ChildProcess;
    try {
      child = this.#dependencies.spawnProcess(request.command, [...request.args], {
        cwd: request.cwd,
        env: { ...request.environment },
        detached: this.#dependencies.platform !== "win32",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      return Promise.reject(new CommandSpawnError({ cause: error }));
    }

    return new Promise<CommandExit>((resolve, reject) => {
      let settled = false;
      let stopping = false;
      let closed = false;
      let resolveClosed: (() => void) | undefined;
      const closedPromise = new Promise<void>((closedResolve) => {
        resolveClosed = closedResolve;
      });

      const cleanup = () => {
        clearTimeout(commandTimeout);
        signal.removeEventListener("abort", onAbort);
      };
      const finishResolve = (result: CommandExit) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      };
      const finishReject = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };
      const waitForClose = async () => {
        if (closed) {
          return;
        }
        await new Promise<void>((closeResolve, closeReject) => {
          const closeTimeout = setTimeout(
            () => closeReject(new CommandTerminationError()),
            this.#dependencies.closeTimeoutMs,
          );
          void closedPromise.then(() => {
            clearTimeout(closeTimeout);
            closeResolve();
          });
        });
      };
      const stop = async (reason: unknown) => {
        if (stopping || settled) {
          return;
        }
        stopping = true;
        try {
          if (child.pid === undefined) {
            throw new CommandTerminationError();
          }
          await this.#dependencies.terminator.terminate({
            pid: child.pid,
            isClosed: () => closed || child.exitCode !== null || child.signalCode !== null,
          });
          await waitForClose();
          finishReject(reason);
        } catch (error) {
          finishReject(
            error instanceof CommandTerminationError ? error : new CommandTerminationError(),
          );
        }
      };
      const emitOutput = (event: CommandOutputEvent) => {
        if (stopping || settled) {
          return;
        }
        try {
          emit(event);
        } catch (error) {
          void stop(error);
        }
      };
      const onAbort = () => {
        void stop(signal.reason);
      };
      const commandTimeout = setTimeout(() => {
        void stop(new CommandTimeoutError(request.timeoutMs));
      }, request.timeoutMs);

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (text: string) => emitOutput({ type: "stdout", text }));
      child.stderr?.on("data", (text: string) => emitOutput({ type: "stderr", text }));
      child.once("error", (error) => {
        if (!stopping) {
          finishReject(new CommandSpawnError({ cause: error }));
        }
      });
      child.once("close", (code, closeSignal) => {
        closed = true;
        const closeResult: CommandExit = { type: "exit", code, signal: closeSignal };
        resolveClosed?.();
        if (stopping || settled) {
          return;
        }
        emitOutput(closeResult);
        if (!stopping && !settled) {
          finishResolve(closeResult);
        }
      });
      signal.addEventListener("abort", onAbort, { once: true });

      if (signal.aborted) {
        onAbort();
      }
    });
  }
}

export class InvalidCommandRunRequestError extends Error {
  constructor() {
    super("The command run request is invalid.");
    this.name = "InvalidCommandRunRequestError";
  }
}

export class CommandSpawnError extends Error {
  constructor(options?: ErrorOptions) {
    super("The command process could not be started.", options);
    this.name = "CommandSpawnError";
  }
}

export class CommandTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The command exceeded its ${timeoutMs} ms timeout.`);
    this.name = "CommandTimeoutError";
  }
}

export class CommandTerminationError extends Error {
  constructor(options?: ErrorOptions) {
    super("The command process tree could not be confirmed terminated.", options);
    this.name = "CommandTerminationError";
  }
}
