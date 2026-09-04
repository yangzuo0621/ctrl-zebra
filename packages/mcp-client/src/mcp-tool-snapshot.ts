import { createHash } from "node:crypto";

import {
  type AgentTool,
  type ExternalToolInputSchema,
  hasOnlyKeys,
  isPlainRecord,
  type JsonValue,
  type ToolName,
  ToolRegistry,
  ToolUnavailableError,
} from "@ctrl-zebra/core";

import {
  type McpServerIdentity,
  type McpToolRejectionReason,
  maxMcpDescriptorBytes,
  maxMcpListEntries,
  maxMcpListSnapshotBytes,
  maxMcpRejectedToolProjectionBytes,
  maxMcpRejectedTools,
  maxMcpToolSnapshotSchemaBytes,
} from "./contracts.js";
import { createMcpClientError } from "./errors.js";
import {
  type McpToolApprovalPreparation,
  normalizeMcpToolResult,
  parseMcpToolArguments,
} from "./mcp-tool-call.js";
import { createMcpRegistryName } from "./mcp-tool-name.js";
import {
  type CompiledExternalJsonSchema,
  type ExternalJsonSchemaValidator,
  McpToolSchemaError,
  validateMcpToolSchema,
} from "./mcp-tool-schema.js";
import { utf8ByteLength } from "./text-primitives.js";

const descriptorKeys = new Set([
  "_meta",
  "annotations",
  "description",
  "execution",
  "icons",
  "inputSchema",
  "name",
  "outputSchema",
  "title",
]);

export interface McpToolDescriptor {
  readonly registryName: ToolName;
  readonly mcpToolName: string;
  readonly title?: string;
  readonly description?: string;
  readonly schemaId: string;
}

export interface McpRejectedTool {
  readonly mcpToolName: string;
  readonly reason: McpToolRejectionReason;
}

type McpToolEvaluation =
  | {
      readonly kind: "accepted";
      readonly descriptor: McpToolDescriptor;
      readonly compiledInput: CompiledExternalJsonSchema;
      readonly compiledOutput?: CompiledExternalJsonSchema;
    }
  | {
      readonly kind: "rejected";
      readonly rejection: McpRejectedTool;
    };

export interface McpToolSnapshotView {
  readonly server: McpServerIdentity;
  readonly generation: number;
  readonly tools: readonly McpToolDescriptor[];
  readonly rejectedTools: readonly McpRejectedTool[];
  readonly rejectedToolsTruncated: boolean;
  readonly registry: ToolRegistry;
}

export class McpToolSnapshot {
  readonly view: McpToolSnapshotView;
  readonly #outputValidators: ReadonlyMap<ToolName, CompiledExternalJsonSchema>;
  #active = true;

  constructor(
    view: Omit<McpToolSnapshotView, "registry">,
    tools: readonly AgentTool[],
    outputValidators: ReadonlyMap<ToolName, CompiledExternalJsonSchema>,
  ) {
    const registry = new ToolRegistry();
    for (const tool of tools) {
      registry.register(tool);
    }
    this.view = { ...view, registry };
    this.#outputValidators = outputValidators;
  }

  revoke(): void {
    this.#active = false;
  }

  isActive(): boolean {
    return this.#active;
  }

  validateOutput(name: ToolName, value: unknown): boolean | undefined {
    if (!this.#active) {
      return false;
    }
    return this.#outputValidators.get(name)?.validate(value);
  }
}

export class McpToolSnapshotError extends Error {
  constructor(
    readonly code: "invalid-schema" | "limit-exceeded" | "malformed-message",
    readonly rejectedTools: readonly McpRejectedTool[] = [],
    readonly rejectedToolsTruncated = false,
  ) {
    super(createMcpClientError(code).message);
    this.name = "McpToolSnapshotError";
  }
}

export function createMcpToolSnapshot(
  server: McpServerIdentity,
  generation: number,
  values: readonly unknown[],
  reservedToolNames: ReadonlySet<string>,
  validator: ExternalJsonSchemaValidator,
  callTool?: (
    mcpToolName: string,
    argumentsValue: Readonly<Record<string, JsonValue>>,
    signal: AbortSignal,
  ) => Promise<unknown>,
): McpToolSnapshot {
  if (values.length > maxMcpListEntries) {
    throw new McpToolSnapshotError("limit-exceeded");
  }

  const descriptors: McpToolDescriptor[] = [];
  const tools: AgentTool[] = [];
  const rejectedTools: McpRejectedTool[] = [];
  const identities = new Set<string>();
  const registryNames = new Set<string>();
  const outputValidators = new Map<ToolName, CompiledExternalJsonSchema>();
  let schemaBytes = 0;
  let snapshotBytes = 2;
  let snapshot: McpToolSnapshot | undefined;

  for (const [index, value] of values.entries()) {
    const serialized = serializeBounded(value, maxMcpDescriptorBytes);
    snapshotBytes += utf8ByteLength(serialized) + (index === 0 ? 0 : 1);
    if (snapshotBytes > maxMcpListSnapshotBytes) {
      throw new McpToolSnapshotError("limit-exceeded");
    }
    const record = readDescriptor(value);
    const name = readText(record.name, false);
    if (identities.has(name)) {
      throw new McpToolSnapshotError("malformed-message");
    }
    identities.add(name);

    const registryName = createMcpRegistryName(server.serverId, name);
    if (registryNames.has(registryName) || reservedToolNames.has(registryName)) {
      throw new McpToolSnapshotError("malformed-message");
    }
    registryNames.add(registryName);

    let evaluation: McpToolEvaluation;
    try {
      const inputSchema = validateMcpToolSchema(record.inputSchema);
      const outputSchema =
        record.outputSchema === undefined ? undefined : validateMcpToolSchema(record.outputSchema);
      schemaBytes += utf8ByteLength(JSON.stringify(inputSchema));
      if (outputSchema !== undefined) {
        schemaBytes += utf8ByteLength(JSON.stringify(outputSchema));
      }
      if (schemaBytes > maxMcpToolSnapshotSchemaBytes) {
        throw new McpToolSnapshotError("limit-exceeded");
      }

      const compiledInput = compile(validator, inputSchema);
      const compiledOutput =
        outputSchema === undefined ? undefined : compile(validator, outputSchema);
      const schemaId = createHash("sha256")
        .update(JSON.stringify({ inputSchema, outputSchema }), "utf8")
        .digest("hex");
      const descriptor: McpToolDescriptor = {
        registryName,
        mcpToolName: name,
        ...(record.title === undefined ? {} : { title: readText(record.title, true) }),
        ...(record.description === undefined
          ? {}
          : { description: readText(record.description, true) }),
        schemaId,
      };
      evaluation = { kind: "accepted", descriptor, compiledInput, compiledOutput };
    } catch (error) {
      if (error instanceof McpToolSchemaError) {
        evaluation = {
          kind: "rejected",
          rejection: { mcpToolName: name, reason: error.reason },
        };
      } else {
        throw error;
      }
    }
    if (evaluation.kind === "rejected") {
      rejectedTools.push(evaluation.rejection);
      continue;
    }
    descriptors.push(evaluation.descriptor);
    if (evaluation.compiledOutput !== undefined) {
      outputValidators.set(registryName, evaluation.compiledOutput);
    }
    tools.push(
      createExternalTool(
        evaluation.descriptor,
        server,
        generation,
        evaluation.compiledInput,
        evaluation.compiledOutput,
        () => snapshot?.isActive() === true,
        callTool,
      ),
    );
  }

  const { rejectedTools: boundedRejectedTools, truncated: rejectedToolsTruncated } =
    boundRejectedTools(rejectedTools);
  if (values.length > 0 && descriptors.length === 0) {
    throw new McpToolSnapshotError("invalid-schema", boundedRejectedTools, rejectedToolsTruncated);
  }

  snapshot = new McpToolSnapshot(
    {
      server,
      generation,
      tools: descriptors,
      rejectedTools: boundedRejectedTools,
      rejectedToolsTruncated,
    },
    tools,
    outputValidators,
  );
  return snapshot;
}

function boundRejectedTools(rejectedTools: readonly McpRejectedTool[]): {
  readonly rejectedTools: McpRejectedTool[];
  readonly truncated: boolean;
} {
  const sortedRejectedTools = [...rejectedTools].sort((left, right) =>
    compareUnicodeScalars(left.mcpToolName, right.mcpToolName),
  );
  const boundedRejectedTools: McpRejectedTool[] = [];
  let truncated = sortedRejectedTools.length > maxMcpRejectedTools;
  for (const rejection of sortedRejectedTools) {
    if (boundedRejectedTools.length >= maxMcpRejectedTools) {
      truncated = true;
      break;
    }
    const candidate = [...boundedRejectedTools, rejection];
    if (utf8ByteLength(JSON.stringify(candidate)) > maxMcpRejectedToolProjectionBytes) {
      truncated = true;
      break;
    }
    boundedRejectedTools.push(rejection);
  }
  return { rejectedTools: boundedRejectedTools, truncated };
}

function createExternalTool(
  descriptor: McpToolDescriptor,
  server: McpServerIdentity,
  generation: number,
  compiledInput: CompiledExternalJsonSchema,
  compiledOutput: CompiledExternalJsonSchema | undefined,
  isActive: () => boolean,
  callTool?: (
    mcpToolName: string,
    argumentsValue: Readonly<Record<string, JsonValue>>,
    signal: AbortSignal,
  ) => Promise<unknown>,
): AgentTool<
  Readonly<Record<string, JsonValue>>,
  import("./mcp-tool-call.js").NormalizedMcpToolResult
> {
  const inputSchema: ExternalToolInputSchema = {
    kind: "external_json_schema_2020_12",
    jsonSchema: compiledInput.schema,
  };
  return {
    name: descriptor.registryName,
    description:
      descriptor.description ??
      `External MCP Tool “${descriptor.mcpToolName}” from “${server.displayName}”.`,
    inputSchema,
    risk: "execute",
    parseInput(value) {
      if (!isActive()) {
        throw new McpToolUnavailableError();
      }
      const argumentsValue = parseMcpToolArguments(value);
      if (!compiledInput.validate(argumentsValue)) {
        throw new Error("MCP Tool arguments do not match the current input schema.");
      }
      return argumentsValue;
    },
    async prepareApproval(argumentsValue) {
      if (!isActive() || !compiledInput.validate(argumentsValue)) {
        throw new McpToolUnavailableError();
      }
      const preparation: McpToolApprovalPreparation = {
        kind: "mcp-tool-call",
        server,
        generation,
        registryName: descriptor.registryName,
        mcpToolName: descriptor.mcpToolName,
        schemaId: descriptor.schemaId,
        arguments: argumentsValue,
      };
      return { output: preparation, truncated: false };
    },
    async execute(argumentsValue, { signal }) {
      if (!isActive() || !compiledInput.validate(argumentsValue)) {
        throw new McpToolUnavailableError();
      }
      if (callTool === undefined) {
        throw new McpToolExecutionUnavailableError();
      }
      signal.throwIfAborted();
      const result = await callTool(descriptor.mcpToolName, argumentsValue, signal);
      signal.throwIfAborted();
      if (!isActive()) {
        throw new ToolUnavailableError();
      }
      return {
        output: normalizeMcpToolResult(result, compiledOutput),
        truncated: false,
      };
    },
  };
}

export class McpToolExecutionUnavailableError extends Error {
  constructor() {
    super("MCP Tool execution is not enabled by T1404.");
    this.name = "McpToolExecutionUnavailableError";
  }
}

export class McpToolUnavailableError extends ToolUnavailableError {
  constructor() {
    super();
    this.name = "McpToolUnavailableError";
  }
}

function compile(
  validator: ExternalJsonSchemaValidator,
  schema: Readonly<Record<string, JsonValue>>,
): CompiledExternalJsonSchema {
  try {
    return validator.compile(schema);
  } catch {
    throw new McpToolSchemaError("schema-invalid");
  }
}

function compareUnicodeScalars(left: string, right: string): number {
  const leftScalars = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightScalars = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftScalars.length, rightScalars.length);
  for (let index = 0; index < length; index += 1) {
    const leftScalar = leftScalars[index] ?? 0;
    const rightScalar = rightScalars[index] ?? 0;
    if (leftScalar !== rightScalar) return leftScalar - rightScalar;
  }
  return leftScalars.length - rightScalars.length;
}

function readDescriptor(value: unknown): Readonly<Record<string, unknown>> {
  const record = readRecord(value);
  if (!hasOnlyKeys(record, descriptorKeys)) {
    throw new McpToolSnapshotError("malformed-message");
  }
  if (record.execution !== undefined) {
    throw new McpToolSnapshotError("malformed-message");
  }
  return record;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    throw new McpToolSnapshotError("malformed-message");
  }
  return value as Readonly<Record<string, unknown>>;
}

function readText(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || !value.isWellFormed()) {
    throw new McpToolSnapshotError("malformed-message");
  }
  return value;
}

function serializeBounded(value: unknown, maximumBytes: number): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new McpToolSnapshotError("malformed-message");
  }
  if (serialized === undefined || utf8ByteLength(serialized) > maximumBytes) {
    throw new McpToolSnapshotError("limit-exceeded");
  }
  return serialized;
}
