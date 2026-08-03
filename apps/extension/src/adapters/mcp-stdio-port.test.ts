import { type SpawnOptions, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { NodeMcpStdioPort, selectMcpServerEnvironment } from "./mcp-stdio-port.js";

const fixturePath = fileURLToPath(
  new URL("../test/fixtures/mcp-stdio-port-fixture.mjs", import.meta.url),
);

describe("Node MCP stdio port", () => {
  it("spawns without a shell, streams bytes, and confirms complete tree termination", async () => {
    const spawnProcess = vi.fn((command: string, args: string[], options: SpawnOptions) =>
      spawn(command, [...args], options),
    );
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const exited = vi.fn();
    const port = new NodeMcpStdioPort(fixtureOperation(), { spawnProcess });

    await port.start({
      stdout: (chunk) => stdout.push(chunk),
      stderr: (chunk) => stderr.push(chunk),
      exited,
      error: vi.fn(),
    });
    await port.write(new TextEncoder().encode('{"jsonrpc":"2.0"}\n'));
    await vi.waitFor(() => expect(decode(stdout)).toContain('{"jsonrpc":"2.0"}\n'));
    await vi.waitFor(() => expect(decode(stderr)).toContain("fixture stderr\n"));

    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      [fixturePath],
      expect.objectContaining({
        cwd: process.cwd(),
        env: { PATH: "fixture-path" },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }),
    );
    await port.closeInput();
    await expect(port.terminate()).resolves.toBe("terminated");
    await expect(port.terminate()).resolves.toBe("terminated");
    expect(exited).toHaveBeenCalledOnce();
  });

  it("maps an executable start failure without exposing the raw cause", async () => {
    const failures: string[] = [];
    const port = new NodeMcpStdioPort(
      { ...fixtureOperation(), command: `${fixturePath}.missing` },
      { onFailure: (failure) => failures.push(failure) },
    );

    await expect(
      port.start({ stdout: vi.fn(), stderr: vi.fn(), exited: vi.fn(), error: vi.fn() }),
    ).rejects.toThrow("The MCP Server process could not be started.");
    expect(port.hostFailure).toBe("spawn-failed");
    expect(failures).toContain("spawn-failed");
    await expect(port.terminate()).resolves.toBe("terminated");
  });

  it("returns unconfirmed when complete process-tree cleanup cannot be established", async () => {
    const port = new NodeMcpStdioPort(fixtureOperation(), {
      gracefulCloseTimeoutMs: 1,
      terminator: {
        async terminate(target) {
          process.kill(target.pid, "SIGKILL");
          throw new Error("synthetic termination failure");
        },
      },
    });
    await port.start({ stdout: vi.fn(), stderr: vi.fn(), exited: vi.fn(), error: vi.fn() });

    await expect(port.terminate()).resolves.toBe("unconfirmed");
    expect(port.hostFailure).toBe("termination-unconfirmed");
  });
});

describe("MCP Server environment", () => {
  it("selects only the documented Windows allowlist without normalizing names", () => {
    expect(
      selectMcpServerEnvironment(
        {
          Path: "path",
          PATHEXT: ".EXE",
          SystemRoot: "C:\\Windows",
          WINDIR: "C:\\Windows",
          TEMP: "temp",
          TMP: "tmp",
          HOME: "forbidden",
          API_KEY: "forbidden-secret",
        },
        "win32",
      ),
    ).toEqual({
      Path: "path",
      PATHEXT: ".EXE",
      SystemRoot: "C:\\Windows",
      WINDIR: "C:\\Windows",
      TEMP: "temp",
      TMP: "tmp",
    });
  });

  it("selects only PATH and TMPDIR on POSIX", () => {
    expect(
      selectMcpServerEnvironment(
        { PATH: "/bin", TMPDIR: "/tmp", HOME: "/home/test", LANG: "en_US" },
        "linux",
      ),
    ).toEqual({ PATH: "/bin", TMPDIR: "/tmp" });
  });
});

function fixtureOperation() {
  return {
    command: process.execPath,
    args: [fixturePath],
    cwdPath: process.cwd(),
    environment: { PATH: "fixture-path" },
  };
}

function decode(chunks: readonly Uint8Array[]): string {
  return chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
}
