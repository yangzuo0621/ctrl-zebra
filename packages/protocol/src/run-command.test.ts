import { describe, expect, it } from "vitest";

import { maxCommandDisplayOutputBytes, runCommandOutputSchema } from "./run-command.js";

describe("run_command output", () => {
  it("round-trips bounded stdout, stderr, and exit information", () => {
    const output = {
      stdout: "checked\n",
      stderr: "warning\n",
      exitCode: 2,
      signal: null,
    };

    expect(runCommandOutputSchema.parse(JSON.parse(JSON.stringify(output)) as unknown)).toEqual(
      output,
    );
  });

  it("accepts a signal exit without an exit code", () => {
    expect(
      runCommandOutputSchema.parse({ stdout: "", stderr: "", exitCode: null, signal: "SIGTERM" }),
    ).toEqual({ stdout: "", stderr: "", exitCode: null, signal: "SIGTERM" });
  });

  it("rejects output over the shared UTF-8 byte limit", () => {
    expect(
      runCommandOutputSchema.safeParse({
        stdout: "z".repeat(maxCommandDisplayOutputBytes - 1),
        stderr: "斑马",
        exitCode: 0,
        signal: null,
      }).success,
    ).toBe(false);
  });

  it.each([
    { stdout: "", stderr: "", exitCode: -1, signal: null },
    { stdout: "", stderr: "", exitCode: 1.5, signal: null },
    { stdout: "", stderr: "", exitCode: null, signal: "sigterm" },
    { stdout: "", stderr: "", exitCode: 0, signal: null, environment: {} },
  ])("rejects an invalid command output %#", (output) => {
    expect(runCommandOutputSchema.safeParse(output).success).toBe(false);
  });
});
