import { hasExactKeys } from "@ctrl-zebra/core";
import { utf8ByteLength } from "@ctrl-zebra/protocol";

export const mcpServerSettingSection = "ctrlZebra.mcp";
export const mcpServerSettingName = "server";
export const mcpServerConfigurationVersion = 1 as const;
export const mcpServerConfigurationV2Version = 2 as const;
export const mcpProtocolModes = ["modern-only", "dual"] as const;
export type McpProtocolMode = (typeof mcpProtocolModes)[number];

const maxServerIdCharacters = 64;
const maxDisplayNameCodePoints = 128;
const maxDisplayNameBytes = 512;
const maxCommandBytes = 4_096;
const maxArguments = 64;
const maxArgumentBytes = 4_096;
const maxSerializedArgumentsBytes = 32_768;

interface McpServerConfigurationFields {
  readonly serverId: string;
  readonly displayName: string;
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * A version-1 setting has no mode field on disk, but the parser exposes its
 * effective mode so callers cannot accidentally infer a protocol era.
 */
export type McpServerConfiguration =
  | (McpServerConfigurationFields & {
      readonly version: typeof mcpServerConfigurationVersion;
      readonly protocolMode?: "modern-only";
    })
  | (McpServerConfigurationFields & {
      readonly version: typeof mcpServerConfigurationV2Version;
      readonly protocolMode: McpProtocolMode;
    });

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
  const source = readStrictObject(value);
  if (
    source === undefined ||
    (source.version !== mcpServerConfigurationVersion &&
      source.version !== mcpServerConfigurationV2Version)
  ) {
    throw invalidConfiguration();
  }

  const version = source.version;
  const expectedKeys =
    version === mcpServerConfigurationVersion
      ? ["version", "serverId", "displayName", "command", "args"]
      : ["version", "protocolMode", "serverId", "displayName", "command", "args"];
  if (!hasExactKeys(source, expectedKeys)) {
    throw invalidConfiguration();
  }

  const serverId = source.serverId;
  const displayName = source.displayName;
  const command = source.command;
  const args = source.args;
  const protocolMode =
    version === mcpServerConfigurationVersion ? "modern-only" : source.protocolMode;
  if (
    typeof serverId !== "string" ||
    serverId.length > maxServerIdCharacters ||
    !/^[a-z][a-z0-9_]*$/u.test(serverId) ||
    typeof displayName !== "string" ||
    !displayName.isWellFormed() ||
    displayName.length === 0 ||
    containsDisplayControl(displayName) ||
    [...displayName].length > maxDisplayNameCodePoints ||
    utf8ByteLength(displayName) > maxDisplayNameBytes ||
    containsCredentialMaterial(displayName) ||
    typeof command !== "string" ||
    command.length === 0 ||
    containsLineBreakOrNull(command) ||
    utf8ByteLength(command) > maxCommandBytes ||
    containsCredentialMaterial(command) ||
    !Array.isArray(args) ||
    args.length > maxArguments ||
    !isProtocolMode(protocolMode)
  ) {
    throw invalidConfiguration();
  }

  const validatedArguments: string[] = [];
  for (const argument of args) {
    if (
      typeof argument !== "string" ||
      !argument.isWellFormed() ||
      argument.includes("\0") ||
      utf8ByteLength(argument) > maxArgumentBytes ||
      containsCredentialMaterial(argument)
    ) {
      throw invalidConfiguration();
    }
    validatedArguments.push(argument);
  }

  if (utf8ByteLength(JSON.stringify(validatedArguments)) > maxSerializedArgumentsBytes) {
    throw invalidConfiguration();
  }

  const normalized = {
    serverId,
    displayName,
    command,
    args: Object.freeze(validatedArguments),
  } as const;

  if (version === mcpServerConfigurationVersion) {
    return Object.freeze({
      ...normalized,
      version: mcpServerConfigurationVersion,
      protocolMode: "modern-only" as const,
    });
  }

  return Object.freeze({
    ...normalized,
    version: mcpServerConfigurationV2Version,
    protocolMode,
  });
}

function readStrictObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (Object.values(descriptors).some((descriptor) => !("value" in descriptor))) {
      return undefined;
    }

    return Object.fromEntries(
      keys.map((key) => [key, (descriptors[key] as PropertyDescriptor & { value: unknown }).value]),
    );
  } catch {
    return undefined;
  }
}

function isProtocolMode(value: unknown): value is McpProtocolMode {
  return value === "modern-only" || value === "dual";
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

function containsCredentialMaterial(value: string): boolean {
  return /(?:^|[^a-z0-9])(?:api[_-]?key|authorization|bearer|cookie|password|proxy[_-]?authorization|secret|token)(?:[^a-z0-9]|$)/iu.test(
    value,
  );
}

function invalidConfiguration(): McpServerConfigurationError {
  return new McpServerConfigurationError("configuration-invalid");
}
