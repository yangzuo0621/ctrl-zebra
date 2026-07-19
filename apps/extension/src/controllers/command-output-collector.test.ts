import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { type SpawnCommandRequest, SpawnCommandRunner } from "../adapters/spawn-command-runner.js";
import {
  CommandOutputCollector,
  CommandOutputLogError,
  type CommandOutputLogSink,
  InvalidCommandOutputLimitError,
  InvalidCommandOutputSequenceError,
  maxCommandContextOutputBytes,
  maxCommandDisplayOutputBytes,
  runCommandWithCollectedOutput,
} from "./command-output-collector.js";

const fixturePath = fileURLToPath(
  new URL("../test/fixtures/command-runner-fixture.mjs", import.meta.url),
);

describe("CommandOutputCollector", () => {
  it("keeps exact output and exit metadata below every limit", async () => {
    const collector = new CommandOutputCollector();
    collector.record({ type: "stdout", text: "hello" });
    collector.record({ type: "stderr", text: "warning" });
    collector.record({ type: "exit", code: 0, signal: null });

    await expect(collector.complete()).resolves.toEqual({
      display: { stdout: "hello", stderr: "warning", truncated: false },
      context: { stdout: "hello", stderr: "warning", truncated: false },
      exit: { type: "exit", code: 0, signal: null },
    });
  });

  it("cuts only at a UTF-8 boundary and stops retaining later output", async () => {
    const collector = new CommandOutputCollector(undefined, {
      displayBytes: 5,
      contextBytes: 3,
      logBytes: 0,
    });
    collector.record({ type: "stdout", text: "a界b" });
    collector.record({ type: "stderr", text: "later" });
    collector.record({ type: "exit", code: 7, signal: null });

    const result = await collector.complete();

    expect(new TextEncoder().encode(result.display.stdout).byteLength).toBe(5);
    expect(result.display).toEqual({ stdout: "a界b", stderr: "", truncated: true });
    expect(result.context).toEqual({ stdout: "a", stderr: "", truncated: true });
    expect(result.exit.code).toBe(7);
  });

  it("keeps huge output within the display and context memory ceilings", async () => {
    const collector = new CommandOutputCollector();
    const chunk = "z".repeat(1_000_000);
    for (let index = 0; index < 20; index += 1) {
      collector.record({ type: index % 2 === 0 ? "stdout" : "stderr", text: chunk });
    }
    collector.record({ type: "exit", code: 0, signal: null });

    const result = await collector.complete();
    const displayBytes = byteLength(result.display.stdout) + byteLength(result.display.stderr);
    const contextBytes = byteLength(result.context.stdout) + byteLength(result.context.stderr);

    expect(displayBytes).toBe(maxCommandDisplayOutputBytes);
    expect(contextBytes).toBe(maxCommandContextOutputBytes);
    expect(result.display.truncated).toBe(true);
    expect(result.context.truncated).toBe(true);
  });

  it("streams a larger bounded prefix to an optional log sink", async () => {
    const log = createLogSink();
    const collector = new CommandOutputCollector(log.values, {
      displayBytes: 4,
      contextBytes: 2,
      logBytes: 10,
    });
    collector.record({ type: "stdout", text: "abcdef" });
    collector.record({ type: "stderr", text: "ghijkl" });
    collector.record({ type: "exit", code: 0, signal: null });

    const result = await collector.complete();

    expect(log.append.mock.calls).toEqual([
      ["stdout", "abcdef"],
      ["stderr", "ghij"],
    ]);
    expect(result.display).toEqual({ stdout: "abcd", stderr: "", truncated: true });
    expect(result.context).toEqual({ stdout: "ab", stderr: "", truncated: true });
    expect(result.log).toEqual({ uri: "file:///logs/command-1.log", truncated: true });
  });

  it("reports a safe optional-log failure and still closes the sink", async () => {
    const close = vi.fn(async () => "file:///logs/command-1.log");
    const collector = new CommandOutputCollector({
      append: vi.fn(async () => {
        throw new Error("sensitive backend detail");
      }),
      close,
    });
    collector.record({ type: "stdout", text: "output" });
    collector.record({ type: "exit", code: 0, signal: null });

    await expect(collector.complete()).rejects.toEqual(
      new CommandOutputLogError({ cause: expect.any(Error) }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects missing, duplicate, or post-exit events", async () => {
    const missing = new CommandOutputCollector();
    await expect(missing.complete()).rejects.toBeInstanceOf(InvalidCommandOutputSequenceError);

    const complete = new CommandOutputCollector();
    complete.record({ type: "exit", code: 0, signal: null });
    expect(() => complete.record({ type: "stdout", text: "late" })).toThrow(
      InvalidCommandOutputSequenceError,
    );
    await complete.complete();
    await expect(complete.complete()).rejects.toBeInstanceOf(InvalidCommandOutputSequenceError);
  });

  it("rejects negative, fractional, or context-over-display limits", () => {
    expect(() => new CommandOutputCollector(undefined, { displayBytes: -1 })).toThrow(
      InvalidCommandOutputLimitError,
    );
    expect(() => new CommandOutputCollector(undefined, { logBytes: 1.5 })).toThrow(
      InvalidCommandOutputLimitError,
    );
    expect(
      () => new CommandOutputCollector(undefined, { displayBytes: 2, contextBytes: 3 }),
    ).toThrow(InvalidCommandOutputLimitError);
  });
});

describe("runCommandWithCollectedOutput", () => {
  it("collects the real runner fixture without changing stream content", async () => {
    const result = await runCommandWithCollectedOutput(
      new SpawnCommandRunner(),
      fixtureRequest("stream"),
      new AbortController().signal,
    );

    expect(result.display).toEqual({
      stdout: "stdout-one\nstdout-two\n",
      stderr: "stderr-one\n",
      truncated: false,
    });
    expect(result.context).toEqual(result.display);
    expect(result.exit).toEqual({ type: "exit", code: 0, signal: null });
  });

  it("closes an optional log when the runner fails", async () => {
    const log = createLogSink();
    const failure = new Error("runner failed");
    const runner = {
      run: vi.fn(async () => {
        throw failure;
      }),
    };

    await expect(
      runCommandWithCollectedOutput(
        runner,
        fixtureRequest("stream"),
        new AbortController().signal,
        log.values,
      ),
    ).rejects.toBe(failure);
    expect(log.close).toHaveBeenCalledOnce();
  });
});

function createLogSink() {
  const append = vi.fn(async () => {});
  const close = vi.fn(async () => "file:///logs/command-1.log");
  return {
    values: { append, close } satisfies CommandOutputLogSink,
    append,
    close,
  };
}

function fixtureRequest(mode: string): SpawnCommandRequest {
  return {
    command: process.execPath,
    args: [fixturePath, mode],
    cwd: process.cwd(),
    timeoutMs: 5_000,
    environment: {},
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
