import { hasOnlyKeys, isRecord, isSafeForwardSlashPath } from "./boundary-validation.js";

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

export const runCommandInputSchema = {
  type: "object",
  properties: {
    command: {
      type: "string",
      description:
        "Executable name or path passed directly to spawn; shell syntax is not interpreted.",
      minLength: 1,
      maxLength: maxRunCommandCharacters,
      pattern: noControlCharactersPattern,
    },
    args: {
      type: "array",
      description: "Ordered arguments passed directly to the executable.",
      minItems: 0,
      maxItems: maxRunCommandArguments,
      items: {
        type: "string",
        maxLength: maxRunCommandArgumentCharacters,
        pattern: "^[^\\u0000-\\u001f\\u007f]*$",
      },
    },
    cwd: {
      type: "string",
      description:
        'Workspace-relative directory using forward slashes; "." selects the workspace root.',
      minLength: 1,
      maxLength: maxRunCommandCwdCharacters,
      pattern: safeCommandCwdPattern,
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
} as const;

export interface RunCommandInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}

export function parseRunCommandInput(value: unknown): RunCommandInput {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["command", "args", "cwd", "timeoutMs"])) ||
    !isBoundedDisplayText(value.command, maxRunCommandCharacters, false) ||
    value.command.trim() !== value.command ||
    !Array.isArray(value.args) ||
    value.args.length > maxRunCommandArguments ||
    !value.args.every((argument) =>
      isBoundedDisplayText(argument, maxRunCommandArgumentCharacters, true),
    ) ||
    !isSafeCommandCwd(value.cwd) ||
    typeof value.timeoutMs !== "number" ||
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < minRunCommandTimeoutMs ||
    value.timeoutMs > maxRunCommandTimeoutMs
  ) {
    throw new TypeError("Invalid run_command input.");
  }

  return {
    command: value.command,
    args: [...value.args],
    cwd: value.cwd,
    timeoutMs: value.timeoutMs,
  };
}

function isBoundedDisplayText(
  value: unknown,
  maxLength: number,
  allowEmpty: boolean,
): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= maxLength &&
    !hasControlCharacters(value)
  );
}

function isSafeCommandCwd(value: unknown): value is string {
  if (value === ".") {
    return true;
  }

  return (
    isSafeForwardSlashPath(value, {
      maxLength: maxRunCommandCwdCharacters,
      allowLeadingSlash: false,
      rejectCurrentSegments: true,
    }) &&
    !value.includes(":") &&
    !value.includes("//") &&
    !value.endsWith("/") &&
    !hasControlCharacters(value)
  );
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}
