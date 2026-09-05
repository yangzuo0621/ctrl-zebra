import type { AgentTool, ToolExecutionOutput } from "@ctrl-zebra/core";
import { type RunCommandOutput, runCommandOutputSchema } from "@ctrl-zebra/protocol";
import { z } from "zod";

import { toToolInputSchema } from "./zod-tool-schema.js";

export const runCommandToolName = "run_command" as const;
export const runCommandToolDescription =
  "Run one directly spawned executable in the selected workspace after explicit approval.";
export const maxRunCommandCharacters = 1_024;
export const maxRunCommandArguments = 256;
export const maxRunCommandArgumentCharacters = 8_192;
export const maxRunCommandCwdCharacters = 4_096;
export const minRunCommandTimeoutMs = 1_000;
export const maxRunCommandTimeoutMs = 600_000;

const noControlCharactersPattern = "^(?!\\s)(?!.*\\s$)[^\\u0000-\\u001f\\u007f]+$";
const safeCommandCwdPattern =
  "^(?:\\.|(?!/)(?!.*:)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*\\\\)(?!.*//)(?!.*[/:]$).+)$";

// Composed from the same literal escape-text form noControlCharactersPattern above already
// uses (built via String.fromCharCode(0x5c) for the backslash, purely to keep this source
// file free of a directly-typed escape sequence -- the resulting pattern text is
// byte-for-byte what a hand-written string literal escape would read as, not a raw control
// byte). argumentPattern excludes the same ASCII control-character range
// noControlCharactersPattern does, but allows an empty string and carries no
// leading/trailing-whitespace lookaheads, matching what isBoundedDisplayText(argument, ...,
// true) (allowEmpty: true) enforced for each argument versus (allowEmpty: false) for command.
const backslash = String.fromCharCode(0x5c);
const controlCharacterEscapeText = `${backslash}u0000-${backslash}u001f${backslash}u007f`;
const argumentPattern = new RegExp(`^[^${controlCharacterEscapeText}]*$`, "u");

// `s` (dotAll) so the trailing `.+` also matches a cwd containing a line-terminator code point --
// see workspace-path-schema.ts's workspaceRelativePathPattern for the same fix and rationale.
const safeCommandCwdRegex = new RegExp(safeCommandCwdPattern, "su");
const noControlCharactersRegex = new RegExp(noControlCharactersPattern, "u");

const runCommandInputZodSchema = z.strictObject({
  command: z
    .string()
    .min(1)
    .max(maxRunCommandCharacters)
    .regex(noControlCharactersRegex)
    .describe("Executable name or path passed directly to spawn; shell syntax is not interpreted."),
  // `.min(0)` is explicit (rather than omitted) so the generated schema keeps advertising
  // `minItems: 0`, exactly as the hand-written literal this replaces always did -- z.array()
  // without any `.min()` call omits `minItems` entirely instead of defaulting it to 0.
  args: z
    .array(
      z
        .string()
        .max(maxRunCommandArgumentCharacters)
        .regex(argumentPattern)
        .describe("One argument passed verbatim to the executable."),
    )
    .min(0)
    .max(maxRunCommandArguments)
    .describe("Ordered arguments passed directly to the executable."),
  cwd: z
    .string()
    .min(1)
    .max(maxRunCommandCwdCharacters)
    .regex(safeCommandCwdRegex)
    .describe(
      'Workspace-relative directory using forward slashes; "." selects the workspace root.',
    ),
  timeoutMs: z
    .number()
    .int()
    .min(minRunCommandTimeoutMs)
    .max(maxRunCommandTimeoutMs)
    .describe("Hard timeout in milliseconds."),
});
export const runCommandInputSchema = toToolInputSchema(runCommandInputZodSchema);

export interface RunCommandInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}

export interface RunCommandExecutor {
  run(input: RunCommandInput, signal: AbortSignal): Promise<ToolExecutionOutput<RunCommandOutput>>;
}

export function createRunCommandTool(
  executor: RunCommandExecutor,
): AgentTool<RunCommandInput, RunCommandOutput> {
  return {
    name: runCommandToolName,
    description: runCommandToolDescription,
    inputSchema: runCommandInputSchema,
    risk: "execute",
    parseInput: parseRunCommandInput,
    prepareApproval: async (input, { signal }) => {
      signal.throwIfAborted();
      return { output: input, truncated: false };
    },
    async execute(input, { signal }) {
      signal.throwIfAborted();
      const execution = await executor.run(input, signal);
      signal.throwIfAborted();
      return {
        output: runCommandOutputSchema.parse(execution.output),
        truncated: execution.truncated,
      };
    },
  };
}

export function parseRunCommandInput(value: unknown): RunCommandInput {
  const parsed = runCommandInputZodSchema.parse(value);

  // Redundant with noControlCharactersPattern's own leading/trailing-whitespace lookaheads --
  // kept as a second, independent guard exactly as the hand-written parser did, rather than
  // relying solely on the regex to prove it covers every JS `trim()`-recognized whitespace code
  // point.
  if (parsed.command.trim() !== parsed.command) {
    throw new TypeError("Invalid run_command input.");
  }

  return { ...parsed, args: [...parsed.args] };
}
