import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  type CommandOutputEvent,
  CommandSpawnError,
  CommandTerminationError,
  CommandTimeoutError,
  NodeCommandProcessTreeTerminator,
  type SpawnCommandRequest,
  SpawnCommandRunner,
} from "./spawn-command-runner.js";

const fixturePath = fileURLToPath(
  new URL("../test/fixtures/command-runner-fixture.mjs", import.meta.url),
);

describe("SpawnCommandRunner", () => {
  it("streams stdout and stderr and returns a zero exit", async () => {
    const events: CommandOutputEvent[] = [];
    const result = await new SpawnCommandRunner().run(
      fixtureRequest("stream"),
      new AbortController().signal,
      (event) => events.push(event),
    );

    expect(result).toEqual({ type: "exit", code: 0, signal: null });
    expect(events.at(-1)).toEqual(result);
    expect(outputFor(events, "stdout")).toBe("stdout-one\nstdout-two\n");
    expect(outputFor(events, "stderr")).toBe("stderr-one\n");
  });

  it("returns a non-zero exit without converting it to a spawn failure", async () => {
    const events: CommandOutputEvent[] = [];
    const result = await new SpawnCommandRunner().run(
      fixtureRequest("nonzero"),
      new AbortController().signal,
      (event) => events.push(event),
    );

    expect(result).toEqual({ type: "exit", code: 7, signal: null });
    expect(outputFor(events, "stderr")).toBe("expected failure\n");
  });

  it("terminates the process tree on cancellation and emits nothing afterward", async () => {
    const runner = new SpawnCommandRunner();
    const controller = new AbortController();
    const cancellation = new Error("cancel fixture");
    const events: CommandOutputEvent[] = [];
    const result = runner.run(fixtureRequest("wait"), controller.signal, (event) => {
      events.push(event);
      if (event.type === "stdout" && event.text.includes("ready")) {
        controller.abort(cancellation);
      }
    });

    await expect(result).rejects.toBe(cancellation);
    expect(events.some((event) => event.type === "exit")).toBe(false);
    expect(outputFor(events, "stdout")).toBe("ready\n");
  });

  it("distinguishes a hard timeout from cancellation", async () => {
    const events: CommandOutputEvent[] = [];
    const result = new SpawnCommandRunner().run(
      { ...fixtureRequest("wait"), timeoutMs: 100 },
      new AbortController().signal,
      (event) => events.push(event),
    );

    await expect(result).rejects.toEqual(new CommandTimeoutError(100));
    expect(events.some((event) => event.type === "exit")).toBe(false);
  });

  it("maps an executable start failure without emitting output", async () => {
    const emit = vi.fn();
    const request = {
      ...fixtureRequest("stream"),
      command: fileURLToPath(new URL("./definitely-missing-command.exe", import.meta.url)),
      args: [],
    };

    await expect(
      new SpawnCommandRunner().run(request, new AbortController().signal, emit),
    ).rejects.toBeInstanceOf(CommandSpawnError);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("NodeCommandProcessTreeTerminator", () => {
  it.each([
    "linux",
    "darwin",
  ] as const)("kills the detached %s process group by negative pid", async (platform) => {
    const killProcess = vi.fn();
    const startTaskkill = vi.fn(() => createHelper(0));
    const terminator = new NodeCommandProcessTreeTerminator({
      platform,
      killProcess,
      startTaskkill,
    });

    await terminator.terminate({ pid: 42, isClosed: () => false });

    expect(killProcess).toHaveBeenCalledWith(-42, "SIGKILL");
    expect(startTaskkill).not.toHaveBeenCalled();
  });

  it("uses taskkill directly with the Windows tree and force flags", async () => {
    const startTaskkill = vi.fn(() => createHelper(0));
    const terminator = new NodeCommandProcessTreeTerminator({
      platform: "win32",
      killProcess: vi.fn(),
      startTaskkill,
    });

    await terminator.terminate({ pid: 73, isClosed: () => false });

    expect(startTaskkill).toHaveBeenCalledWith(["/pid", "73", "/t", "/f"]);
  });

  it("reports an unconfirmed Windows tree termination", async () => {
    const terminator = new NodeCommandProcessTreeTerminator({
      platform: "win32",
      killProcess: vi.fn(),
      startTaskkill: () => createHelper(1),
    });

    await expect(terminator.terminate({ pid: 73, isClosed: () => false })).rejects.toBeInstanceOf(
      CommandTerminationError,
    );
  });

  it("bounds a stuck taskkill helper", async () => {
    vi.useFakeTimers();
    try {
      const helper = new EventEmitter();
      const kill = vi.fn(() => true);
      const terminator = new NodeCommandProcessTreeTerminator({
        platform: "win32",
        killProcess: vi.fn(),
        startTaskkill: () => Object.assign(helper, { kill }),
        helperTimeoutMs: 25,
      });
      const termination = terminator.terminate({ pid: 73, isClosed: () => false });
      const expectedTermination =
        expect(termination).rejects.toBeInstanceOf(CommandTerminationError);

      await vi.advanceTimersByTimeAsync(25);

      await expectedTermination;
      expect(kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});

function fixtureRequest(mode: string): SpawnCommandRequest {
  return {
    command: process.execPath,
    args: [fixturePath, mode],
    cwd: process.cwd(),
    timeoutMs: 5_000,
    environment: {},
  };
}

function outputFor(events: readonly CommandOutputEvent[], type: "stdout" | "stderr"): string {
  return events
    .filter(
      (event): event is Extract<CommandOutputEvent, { readonly type: typeof type }> =>
        event.type === type,
    )
    .map((event) => event.text)
    .join("");
}

function createHelper(code: number): EventEmitter & { kill(signal?: NodeJS.Signals): boolean } {
  const helper = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
  queueMicrotask(() => helper.emit("close", code));
  return helper;
}
