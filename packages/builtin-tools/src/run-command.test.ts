import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  createRunCommandTool,
  maxRunCommandArgumentCharacters,
  maxRunCommandArguments,
  maxRunCommandCharacters,
  maxRunCommandCwdCharacters,
  maxRunCommandTimeoutMs,
  minRunCommandTimeoutMs,
  parseRunCommandInput,
  runCommandInputSchema,
  runCommandToolName,
} from "./run-command.js";

// Matches run-command.ts's own controlCharacterEscapeText: literal escape TEXT (the six
// characters backslash, "u", "0", "0", "0", "0", not an actual NUL character), composed via
// String.fromCharCode(0x5c) for the backslash rather than an inline escape sequence, purely to
// keep this source file free of a directly-typed one.
const backslash = String.fromCharCode(0x5c);
const controlCharacterEscapeText = `${backslash}u0000-${backslash}u001f${backslash}u007f`;

describe("run_command input", () => {
  it("advertises the exact model-facing schema this tool has always advertised", () => {
    expect(runCommandInputSchema).toEqual({
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Executable name or path passed directly to spawn; shell syntax is not interpreted.",
          minLength: 1,
          maxLength: maxRunCommandCharacters,
          pattern: `^(?!\\s)(?!.*\\s$)[^${controlCharacterEscapeText}]+$`,
        },
        args: {
          type: "array",
          description: "Ordered arguments passed directly to the executable.",
          minItems: 0,
          maxItems: maxRunCommandArguments,
          items: {
            type: "string",
            description: "One argument passed verbatim to the executable.",
            maxLength: maxRunCommandArgumentCharacters,
            pattern: `^[^${controlCharacterEscapeText}]*$`,
          },
        },
        cwd: {
          type: "string",
          description:
            'Workspace-relative directory using forward slashes; "." selects the workspace root.',
          minLength: 1,
          maxLength: maxRunCommandCwdCharacters,
          pattern:
            "^(?:\\.|(?!\\/)(?!.*:)(?!.*(?:^|\\/)\\.{1,2}(?:\\/|$))(?!.*\\\\)(?!.*\\/\\/)(?!.*[/:]$).+)$",
        },
        timeoutMs: {
          type: "integer",
          description: "Hard timeout in milliseconds.",
          minimum: minRunCommandTimeoutMs,
          maximum: maxRunCommandTimeoutMs,
        },
      },
      required: ["command", "args", "cwd", "timeoutMs"],
      additionalProperties: false,
    });
  });

  it("prepares the exact input and delegates approved execution", async () => {
    const input = validInput() as unknown as {
      command: string;
      args: string[];
      cwd: string;
      timeoutMs: number;
    };
    const executor = {
      run: async () => ({
        output: { stdout: "ok", stderr: "", exitCode: 0, signal: null },
        truncated: false,
      }),
    };
    const tool = createRunCommandTool(executor);
    const signal = new AbortController().signal;

    await expect(tool.prepareApproval?.(input, { signal })).resolves.toEqual({
      output: input,
      truncated: false,
    });
    await expect(tool.execute(input, { signal })).resolves.toEqual({
      output: { stdout: "ok", stderr: "", exitCode: 0, signal: null },
      truncated: false,
    });
  });

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

  it.each(["", "   ", " node", "node ", "node\n--eval"])(
    "rejects invalid command %j",
    (command) => {
      expect(() => parseRunCommandInput(validInput({ command }))).toThrow(ZodError);
    },
  );

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
    expect(() => parseRunCommandInput(validInput({ cwd }))).toThrow(ZodError);
  });

  it("accepts a cwd containing a line-terminator code point, matching the predicate this pattern replaces", () => {
    // Regression guard for the same class of bug tranche 4 found in workspace-path-schema.ts: a
    // trailing `.+` needs the `s` (dotAll) flag, or it silently stops matching a cwd containing a
    // line terminator that the original hand-written isSafeCommandCwd predicate always accepted.
    expect(parseRunCommandInput(validInput({ cwd: "packages/a\ncore" }))).toMatchObject({
      cwd: "packages/a\ncore",
    });
  });

  it.each([
    0,
    minRunCommandTimeoutMs - 1,
    maxRunCommandTimeoutMs + 1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid timeout %s", (timeoutMs) => {
    expect(() => parseRunCommandInput(validInput({ timeoutMs }))).toThrow(ZodError);
  });

  it("rejects dangerous extra fields and invalid arguments", () => {
    expect(() => parseRunCommandInput({ ...validInput(), shell: true })).toThrow(ZodError);
    expect(() => parseRunCommandInput({ ...validInput(), env: { TOKEN: "secret" } })).toThrow(
      ZodError,
    );
    expect(() => parseRunCommandInput(validInput({ args: ["ok", "bad\nargument"] }))).toThrow(
      ZodError,
    );
    expect(() => parseRunCommandInput(null)).toThrow(ZodError);
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
