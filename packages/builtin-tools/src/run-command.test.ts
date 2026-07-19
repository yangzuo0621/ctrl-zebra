import { describe, expect, it } from "vitest";

import {
  maxRunCommandTimeoutMs,
  minRunCommandTimeoutMs,
  parseRunCommandInput,
  runCommandInputSchema,
  runCommandToolName,
} from "./run-command.js";

describe("run_command input", () => {
  it("defines and parses a direct-spawn command", () => {
    const input = {
      command: "node",
      args: ["scripts/check.mjs", "--mode", "safe value"],
      cwd: "packages/core",
      timeoutMs: 30_000,
    };

    expect(runCommandToolName).toBe("run_command");
    expect(runCommandInputSchema).toMatchObject({
      required: ["command", "args", "cwd", "timeoutMs"],
      additionalProperties: false,
      properties: {
        timeoutMs: {
          minimum: minRunCommandTimeoutMs,
          maximum: maxRunCommandTimeoutMs,
        },
      },
    });
    expect(parseRunCommandInput(input)).toEqual(input);
    expect(parseRunCommandInput({ ...input, cwd: ".", args: [] })).toEqual({
      ...input,
      cwd: ".",
      args: [],
    });
    expect(parseRunCommandInput(validInput({ timeoutMs: minRunCommandTimeoutMs }))).toMatchObject({
      timeoutMs: minRunCommandTimeoutMs,
    });
    expect(parseRunCommandInput(validInput({ timeoutMs: maxRunCommandTimeoutMs }))).toMatchObject({
      timeoutMs: maxRunCommandTimeoutMs,
    });
  });

  it.each([
    "",
    "   ",
    " node",
    "node ",
    "node\n--eval",
  ])("rejects invalid command %j", (command) => {
    expect(() => parseRunCommandInput(validInput({ command }))).toThrow(TypeError);
  });

  it.each([
    "../outside",
    "packages/../outside",
    "packages/./core",
    "/absolute",
    "C:/outside",
    "file:outside",
    "packages\\core",
    "packages//core",
    "packages/core/",
  ])("rejects cwd outside the normalized workspace-relative form: %s", (cwd) => {
    expect(() => parseRunCommandInput(validInput({ cwd }))).toThrow(TypeError);
  });

  it.each([
    0,
    minRunCommandTimeoutMs - 1,
    maxRunCommandTimeoutMs + 1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid timeout %s", (timeoutMs) => {
    expect(() => parseRunCommandInput(validInput({ timeoutMs }))).toThrow(TypeError);
  });

  it("rejects dangerous extra fields and invalid arguments", () => {
    expect(() => parseRunCommandInput({ ...validInput(), shell: true })).toThrow(TypeError);
    expect(() => parseRunCommandInput({ ...validInput(), env: { TOKEN: "secret" } })).toThrow(
      TypeError,
    );
    expect(() => parseRunCommandInput(validInput({ args: ["ok", "bad\nargument"] }))).toThrow(
      TypeError,
    );
    expect(() => parseRunCommandInput(null)).toThrow(TypeError);
  });
});

function validInput(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    command: "node",
    args: ["scripts/check.mjs"],
    cwd: ".",
    timeoutMs: 30_000,
    ...overrides,
  };
}
