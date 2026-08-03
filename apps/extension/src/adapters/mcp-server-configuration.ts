export const mcpServerSettingSection = "ctrlZebra.mcp";
export const mcpServerSettingName = "server";
export const mcpServerConfigurationVersion = 1 as const;

const maxServerIdCharacters = 64;
const maxDisplayNameCodePoints = 128;
const maxDisplayNameBytes = 512;
const maxCommandBytes = 4_096;
const maxArguments = 64;
const maxArgumentBytes = 4_096;
const maxSerializedArgumentsBytes = 32_768;

export interface McpServerConfiguration {
  readonly version: typeof mcpServerConfigurationVersion;
  readonly serverId: string;
  readonly displayName: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface InspectedConfiguration<T> {
  readonly globalValue?: T;
  readonly globalLanguageValue?: T;
  readonly workspaceValue?: T;
  readonly workspaceLanguageValue?: T;
  readonly workspaceFolderValue?: T;
  readonly workspaceFolderLanguageValue?: T;
}

export interface McpServerConfigurationInspector {
  inspect(setting: string): InspectedConfiguration<unknown> | undefined;
}

export type McpServerConfigurationErrorCode =
  | "configuration-missing"
  | "configuration-scope-invalid"
  | "configuration-invalid";

export class McpServerConfigurationError extends Error {
  constructor(readonly code: McpServerConfigurationErrorCode) {
    super(configurationErrorMessages[code]);
    this.name = "McpServerConfigurationError";
  }
}

const configurationErrorMessages = {
  "configuration-missing": "Configure one MCP Server in your user settings before connecting.",
  "configuration-scope-invalid":
    "The MCP Server must be configured only in user settings; workspace and language overrides are not allowed.",
  "configuration-invalid": "The MCP Server configuration is invalid.",
} as const satisfies Record<McpServerConfigurationErrorCode, string>;

export function readMcpServerConfiguration(
  inspector: McpServerConfigurationInspector,
): McpServerConfiguration {
  const inspected = inspector.inspect(mcpServerSettingName);
  if (inspected === undefined || inspected.globalValue === undefined) {
    throw new McpServerConfigurationError("configuration-missing");
  }

  if (
    inspected.globalLanguageValue !== undefined ||
    inspected.workspaceValue !== undefined ||
    inspected.workspaceLanguageValue !== undefined ||
    inspected.workspaceFolderValue !== undefined ||
    inspected.workspaceFolderLanguageValue !== undefined
  ) {
    throw new McpServerConfigurationError("configuration-scope-invalid");
  }

  return parseMcpServerConfiguration(inspected.globalValue);
}

export function parseMcpServerConfiguration(value: unknown): McpServerConfiguration {
  const source = readStrictObject(value, ["version", "serverId", "displayName", "command", "args"]);
  if (source === undefined || source.version !== mcpServerConfigurationVersion) {
    throw invalidConfiguration();
  }

  const serverId = source.serverId;
  const displayName = source.displayName;
  const command = source.command;
  const args = source.args;
  if (
    typeof serverId !== "string" ||
    serverId.length > maxServerIdCharacters ||
    !/^[a-z][a-z0-9_]*$/u.test(serverId) ||
    typeof displayName !== "string" ||
    !isWellFormedUnicode(displayName) ||
    displayName.length === 0 ||
    containsDisplayControl(displayName) ||
    [...displayName].length > maxDisplayNameCodePoints ||
    utf8Bytes(displayName) > maxDisplayNameBytes ||
    containsCredentialMaterial(displayName) ||
    typeof command !== "string" ||
    command.length === 0 ||
    containsLineBreakOrNull(command) ||
    utf8Bytes(command) > maxCommandBytes ||
    containsCredentialMaterial(command) ||
    !Array.isArray(args) ||
    args.length > maxArguments
  ) {
    throw invalidConfiguration();
  }

  const validatedArguments: string[] = [];
  for (const argument of args) {
    if (
      typeof argument !== "string" ||
      !isWellFormedUnicode(argument) ||
      argument.includes("\0") ||
      utf8Bytes(argument) > maxArgumentBytes ||
      containsCredentialMaterial(argument)
    ) {
      throw invalidConfiguration();
    }
    validatedArguments.push(argument);
  }

  if (utf8Bytes(JSON.stringify(validatedArguments)) > maxSerializedArgumentsBytes) {
    throw invalidConfiguration();
  }

  return Object.freeze({
    version: mcpServerConfigurationVersion,
    serverId,
    displayName,
    command,
    args: Object.freeze(validatedArguments),
  });
}

function readStrictObject(
  value: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (
      keys.length !== allowedKeys.length ||
      keys.some((key) => !allowedKeys.includes(key)) ||
      Object.values(descriptors).some((descriptor) => !("value" in descriptor))
    ) {
      return undefined;
    }

    return Object.fromEntries(
      keys.map((key) => [key, (descriptors[key] as PropertyDescriptor & { value: unknown }).value]),
    );
  } catch {
    return undefined;
  }
}

function containsLineBreakOrNull(value: string): boolean {
  return /[\0\r\n\u2028\u2029]/u.test(value);
}

function containsDisplayControl(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    );
  });
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function containsCredentialMaterial(value: string): boolean {
  return /(?:^|[^a-z0-9])(?:api[_-]?key|authorization|bearer|cookie|password|proxy[_-]?authorization|secret|token)(?:[^a-z0-9]|$)/iu.test(
    value,
  );
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function invalidConfiguration(): McpServerConfigurationError {
  return new McpServerConfigurationError("configuration-invalid");
}
