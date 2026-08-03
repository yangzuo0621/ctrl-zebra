import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { platform as processPlatform } from "node:process";

import type {
  McpProcessTermination,
  McpStdioPort,
  McpStdioPortHandlers,
} from "@ctrl-zebra/mcp-client";

import {
  type CommandProcessTreeTerminator,
  defaultProcessTreeTerminationTimeoutMs,
  NodeCommandProcessTreeTerminator,
} from "./spawn-command-runner.js";

export interface McpProcessOperation {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwdPath: string;
  readonly environment: Readonly<Record<string, string>>;
}

export type McpHostProcessFailure = "spawn-failed" | "server-exited" | "termination-unconfirmed";

interface McpStdioPortDependencies {
  readonly platform: NodeJS.Platform;
  readonly spawnProcess: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  readonly terminator: CommandProcessTreeTerminator;
  readonly gracefulCloseTimeoutMs: number;
  readonly closeTimeoutMs: number;
  readonly onFailure?: (failure: McpHostProcessFailure) => void;
}

export class NodeMcpStdioPort implements McpStdioPort {
  readonly #operation: McpProcessOperation;
  readonly #dependencies: McpStdioPortDependencies;
  #child: ChildProcess | undefined;
  #handlers: McpStdioPortHandlers | undefined;
  #startPromise: Promise<void> | undefined;
  #terminationPromise: Promise<McpProcessTermination> | undefined;
  #closed = false;
  #spawned = false;
  #hostFailure: McpHostProcessFailure | undefined;
  #resolveClosed: (() => void) | undefined;
  readonly #closedPromise = new Promise<void>((resolve) => {
    this.#resolveClosed = resolve;
  });

  constructor(
    operation: McpProcessOperation,
    dependencies: Partial<McpStdioPortDependencies> = {},
  ) {
    const platform = dependencies.platform ?? processPlatform;
    this.#operation = operation;
    this.#dependencies = {
      platform,
      spawnProcess: dependencies.spawnProcess ?? spawn,
      terminator: dependencies.terminator ?? new NodeCommandProcessTreeTerminator({ platform }),
      gracefulCloseTimeoutMs: dependencies.gracefulCloseTimeoutMs ?? 500,
      closeTimeoutMs: dependencies.closeTimeoutMs ?? defaultProcessTreeTerminationTimeoutMs,
      onFailure: dependencies.onFailure,
    };
  }

  get hostFailure(): McpHostProcessFailure | undefined {
    return this.#hostFailure;
  }

  start(handlers: McpStdioPortHandlers): Promise<void> {
    if (this.#startPromise !== undefined) {
      return Promise.reject(new McpProcessPortError("The MCP process port has already started."));
    }
    this.#handlers = handlers;
    this.#startPromise = this.#startOnce();
    return this.#startPromise;
  }

  async write(bytes: Uint8Array): Promise<void> {
    const input = this.#child?.stdin;
    if (
      !this.#spawned ||
      this.#closed ||
      input === undefined ||
      input === null ||
      input.destroyed
    ) {
      throw new McpProcessPortError("The MCP Server input is unavailable.");
    }

    const copy = Buffer.from(bytes);
    await new Promise<void>((resolve, reject) => {
      input.write(copy, (error) => {
        if (error === null || error === undefined) {
          resolve();
        } else {
          reject(new McpProcessPortError("The MCP Server input write failed."));
        }
      });
    });
  }

  async closeInput(): Promise<void> {
    const input = this.#child?.stdin;
    if (input === undefined || input === null || input.destroyed || input.writableEnded) {
      return;
    }
    input.end();
  }

  terminate(): Promise<McpProcessTermination> {
    this.#terminationPromise ??= this.#terminateOnce();
    return this.#terminationPromise;
  }

  async #startOnce(): Promise<void> {
    let child: ChildProcess;
    try {
      child = this.#dependencies.spawnProcess(this.#operation.command, [...this.#operation.args], {
        cwd: this.#operation.cwdPath,
        detached: this.#dependencies.platform !== "win32",
        env: { ...this.#operation.environment },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      this.#recordFailure("spawn-failed");
      throw new McpProcessPortError("The MCP Server process could not be started.");
    }

    this.#child = child;
    child.stdout?.on("data", (chunk: Buffer) => this.#handlers?.stdout(Uint8Array.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => this.#handlers?.stderr(Uint8Array.from(chunk)));
    child.once("close", () => {
      this.#closed = true;
      this.#resolveClosed?.();
      this.#resolveClosed = undefined;
      this.#handlers?.exited();
      this.#handlers = undefined;
      if (this.#terminationPromise === undefined) {
        this.#recordFailure("server-exited");
      }
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      child.once("spawn", () => {
        if (settled) {
          return;
        }
        settled = true;
        this.#spawned = true;
        resolve();
      });
      child.once("error", () => {
        this.#handlers?.error(undefined);
        if (!settled) {
          settled = true;
          this.#recordFailure("spawn-failed");
          reject(new McpProcessPortError("The MCP Server process could not be started."));
          return;
        }
        this.#recordFailure("server-exited");
      });
    });
  }

  async #terminateOnce(): Promise<McpProcessTermination> {
    const child = this.#child;
    if (child === undefined || this.#closed) {
      return "terminated";
    }

    // stdin close gives a cooperative Server one bounded chance to exit before tree termination.
    try {
      await this.#waitForClose(this.#dependencies.gracefulCloseTimeoutMs);
      return "terminated";
    } catch {
      // The host-owned tree terminator below is the required escalation path.
    }
    if (child.pid === undefined) {
      try {
        await this.#waitForClose(this.#dependencies.closeTimeoutMs);
        return "terminated";
      } catch {
        return this.#terminationUnconfirmed();
      }
    }

    try {
      await this.#dependencies.terminator.terminate({
        pid: child.pid,
        isClosed: () => this.#closed || child.exitCode !== null || child.signalCode !== null,
      });
      await this.#waitForClose(this.#dependencies.closeTimeoutMs);
      return "terminated";
    } catch {
      return this.#terminationUnconfirmed();
    }
  }

  async #waitForClose(timeoutMilliseconds: number): Promise<void> {
    if (this.#closed) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new McpProcessPortError("MCP process termination was not confirmed.")),
        timeoutMilliseconds,
      );
      void this.#closedPromise.then(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  #terminationUnconfirmed(): McpProcessTermination {
    this.#recordFailure("termination-unconfirmed");
    return "unconfirmed";
  }

  #recordFailure(failure: McpHostProcessFailure): void {
    if (this.#hostFailure === "termination-unconfirmed") {
      return;
    }
    if (this.#hostFailure !== undefined && failure !== "termination-unconfirmed") {
      return;
    }
    this.#hostFailure = failure;
    this.#dependencies.onFailure?.(failure);
  }
}

export class McpProcessPortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpProcessPortError";
  }
}

export function selectMcpServerEnvironment(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Readonly<Record<string, string>> {
  const allowed =
    platform === "win32"
      ? new Set(["path", "pathext", "systemroot", "windir", "temp", "tmp"])
      : new Set(["PATH", "TMPDIR"]);
  const selected: Record<string, string> = {};

  for (const [name, value] of Object.entries(source)) {
    const comparable = platform === "win32" ? name.toLocaleLowerCase("en-US") : name;
    if (value !== undefined && allowed.has(comparable)) {
      selected[name] = value;
    }
  }
  return selected;
}
