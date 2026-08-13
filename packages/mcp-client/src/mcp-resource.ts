import { UriTemplate } from "@modelcontextprotocol/client";

import {
  type McpResourceDiscoveryContext,
  type McpServerIdentity,
  maxMcpDescriptorBytes,
  maxMcpListEntries,
  maxMcpListSnapshotBytes,
  maxMcpResourceCodePoints,
  maxMcpResourceItems,
  maxMcpResourceTextBytes,
  maxMcpResourceUriBytes,
  maxMcpResourceUriCodePoints,
} from "./contracts.js";
import { createMcpClientError } from "./errors.js";

const resourceKeys = new Set([
  "_meta",
  "annotations",
  "description",
  "icons",
  "mimeType",
  "name",
  "size",
  "title",
  "uri",
]);
const templateKeys = new Set([
  "_meta",
  "annotations",
  "description",
  "icons",
  "mimeType",
  "name",
  "title",
  "uriTemplate",
]);
const contentKeys = new Set(["_meta", "blob", "mimeType", "text", "uri"]);
const supportedApplicationMimeTypes = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
]);

export interface McpResourceDescriptor {
  readonly server: McpServerIdentity;
  readonly generation: number;
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpResourceTemplateArgument {
  readonly name: string;
  readonly required: true;
}

export interface McpResourceTemplateDescriptor {
  readonly server: McpServerIdentity;
  readonly generation: number;
  readonly uriTemplate: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly arguments: readonly McpResourceTemplateArgument[];
}

export interface McpResourceCatalogView {
  readonly server: McpServerIdentity;
  readonly generation: number;
  readonly resources: readonly McpResourceDescriptor[];
  readonly templates: readonly McpResourceTemplateDescriptor[];
}

export interface McpResourceSnapshotView {
  readonly server: McpServerIdentity;
  readonly generation: number;
  readonly uri: string;
  readonly mimeType: string;
  readonly items: readonly { readonly text: string }[];
  readonly truncated: boolean;
}

export type McpResourceSelection =
  | { readonly kind: "resource"; readonly uri: string }
  | {
      readonly kind: "template";
      readonly uriTemplate: string;
      readonly arguments: Readonly<Record<string, string>>;
    };

export class McpResourceError extends Error {
  constructor(
    readonly code:
      | "malformed-message"
      | "limit-exceeded"
      | "resource-unavailable"
      | "resource-unsupported",
  ) {
    super(createMcpClientError(code).message);
    this.name = "McpResourceError";
  }
}

export function createMcpResourceCatalog(
  context: McpResourceDiscoveryContext,
  resourceValues: readonly unknown[],
  templateValues: readonly unknown[],
): McpResourceCatalogView {
  if (resourceValues.length + templateValues.length > maxMcpListEntries) {
    throw new McpResourceError("limit-exceeded");
  }
  const resources: McpResourceDescriptor[] = [];
  const templates: McpResourceTemplateDescriptor[] = [];
  const identities = new Set<string>();
  let snapshotBytes = 2;

  for (const value of resourceValues) {
    snapshotBytes = addDescriptorBytes(snapshotBytes, value, resources.length + templates.length);
    const record = readStrictRecord(value, resourceKeys);
    const uri = readUri(record.uri);
    if (identities.has(uri)) throw new McpResourceError("malformed-message");
    identities.add(uri);
    resources.push({
      server: context.server,
      generation: context.generation,
      uri,
      name: readText(record.name, false),
      ...optionalDescriptorFields(record),
    });
  }

  for (const value of templateValues) {
    snapshotBytes = addDescriptorBytes(snapshotBytes, value, resources.length + templates.length);
    const record = readStrictRecord(value, templateKeys);
    const uriTemplate = readBoundedText(record.uriTemplate, false);
    let parsed: UriTemplate;
    try {
      parsed = new UriTemplate(uriTemplate);
    } catch {
      throw new McpResourceError("malformed-message");
    }
    if (!UriTemplate.isTemplate(uriTemplate) || parsed.variableNames.length === 0) {
      throw new McpResourceError("malformed-message");
    }
    const argumentNames = [...new Set(parsed.variableNames)];
    if (argumentNames.length !== parsed.variableNames.length || argumentNames.length > 32) {
      throw new McpResourceError("malformed-message");
    }
    const identity = `template\0${uriTemplate}`;
    if (identities.has(identity)) throw new McpResourceError("malformed-message");
    identities.add(identity);
    templates.push({
      server: context.server,
      generation: context.generation,
      uriTemplate,
      name: readText(record.name, false),
      ...optionalDescriptorFields(record),
      arguments: argumentNames.map((name) => ({ name, required: true })),
    });
  }

  if (snapshotBytes > maxMcpListSnapshotBytes) {
    throw new McpResourceError("limit-exceeded");
  }
  return { ...context, resources, templates };
}

export function resolveMcpResourceSelection(
  catalog: McpResourceCatalogView,
  selection: McpResourceSelection,
): string {
  if (selection.kind === "resource") {
    if (!catalog.resources.some(({ uri }) => uri === selection.uri)) {
      throw new McpResourceError("resource-unavailable");
    }
    return selection.uri;
  }
  const descriptor = catalog.templates.find(
    ({ uriTemplate }) => uriTemplate === selection.uriTemplate,
  );
  if (descriptor === undefined) throw new McpResourceError("resource-unavailable");
  const expected = descriptor.arguments.map(({ name }) => name).sort();
  const actual = Object.keys(selection.arguments).sort();
  const argumentValues = Object.values(selection.arguments);
  if (
    expected.length !== actual.length ||
    expected.some((name, index) => name !== actual[index]) ||
    argumentValues.some(
      (value) =>
        typeof value !== "string" ||
        value.length === 0 ||
        !value.isWellFormed() ||
        [...value].length > 4_096,
    ) ||
    argumentValues.reduce((bytes, value) => bytes + utf8Bytes(value), 0) > 65_536
  ) {
    throw new McpResourceError("malformed-message");
  }
  try {
    return readUri(new UriTemplate(descriptor.uriTemplate).expand(selection.arguments));
  } catch (error) {
    if (error instanceof McpResourceError) throw error;
    throw new McpResourceError("malformed-message");
  }
}

export function normalizeMcpResourceResult(
  context: McpResourceDiscoveryContext,
  requestedUri: string,
  value: unknown,
): McpResourceSnapshotView {
  const result = readRecord(value);
  if (
    Object.keys(result).some(
      (key) => key !== "_meta" && key !== "ttlMs" && key !== "cacheScope" && key !== "contents",
    ) ||
    (result.ttlMs !== undefined &&
      (!Number.isSafeInteger(result.ttlMs) || (result.ttlMs as number) < 0)) ||
    (result.cacheScope !== undefined &&
      result.cacheScope !== "public" &&
      result.cacheScope !== "private")
  ) {
    throw new McpResourceError("malformed-message");
  }
  if (!Array.isArray(result.contents) || result.contents.length === 0) {
    throw new McpResourceError("malformed-message");
  }
  if (result.contents.length > maxMcpResourceItems) {
    throw new McpResourceError("limit-exceeded");
  }

  const items: { text: string }[] = [];
  let remainingCodePoints = maxMcpResourceCodePoints;
  let remainingBytes = maxMcpResourceTextBytes;
  let truncated = false;
  let mimeType: string | undefined;
  for (const valueItem of result.contents) {
    const item = readStrictRecord(valueItem, contentKeys);
    if (item.blob !== undefined || typeof item.text !== "string") {
      throw new McpResourceError("resource-unsupported");
    }
    if (readUri(item.uri) !== requestedUri || !item.text.isWellFormed()) {
      throw new McpResourceError("malformed-message");
    }
    const itemMime = normalizeMimeType(item.mimeType);
    if (mimeType !== undefined && mimeType !== itemMime) {
      throw new McpResourceError("resource-unsupported");
    }
    mimeType = itemMime;
    const limited = takeTextPrefix(item.text, remainingCodePoints, remainingBytes);
    items.push({ text: limited.text });
    remainingCodePoints -= limited.codePoints;
    remainingBytes -= limited.bytes;
    truncated ||= limited.truncated;
  }
  return {
    ...context,
    uri: requestedUri,
    mimeType: mimeType ?? "text/plain",
    items,
    truncated,
  };
}

function optionalDescriptorFields(record: Readonly<Record<string, unknown>>) {
  return {
    ...(record.title === undefined ? {} : { title: readText(record.title, true) }),
    ...(record.description === undefined
      ? {}
      : { description: readText(record.description, true) }),
    ...(record.mimeType === undefined ? {} : { mimeType: normalizeMimeType(record.mimeType) }),
  };
}

function normalizeMimeType(value: unknown): string {
  if (value === undefined) return "text/plain";
  if (typeof value !== "string" || !value.isWellFormed()) {
    throw new McpResourceError("malformed-message");
  }
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase();
  if (
    mimeType === undefined ||
    (!mimeType.startsWith("text/") && !supportedApplicationMimeTypes.has(mimeType))
  ) {
    throw new McpResourceError("resource-unsupported");
  }
  return mimeType;
}

function readUri(value: unknown): string {
  const uri = readBoundedText(value, false);
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new McpResourceError("malformed-message");
  }
  if (["data:", "javascript:", "vbscript:"].includes(parsed.protocol.toLowerCase())) {
    throw new McpResourceError("resource-unsupported");
  }
  return uri;
}

function readBoundedText(value: unknown, allowEmpty: boolean): string {
  const text = readText(value, allowEmpty);
  if (
    [...text].length > maxMcpResourceUriCodePoints ||
    new TextEncoder().encode(text).byteLength > maxMcpResourceUriBytes
  ) {
    throw new McpResourceError("limit-exceeded");
  }
  return text;
}

function readText(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || !value.isWellFormed()) {
    throw new McpResourceError("malformed-message");
  }
  return value;
}

function readStrictRecord(value: unknown, keys: ReadonlySet<string>) {
  const record = readRecord(value);
  if (Object.keys(record).some((key) => !keys.has(key))) {
    throw new McpResourceError("malformed-message");
  }
  return record;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new McpResourceError("malformed-message");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new McpResourceError("malformed-message");
  }
  return value as Readonly<Record<string, unknown>>;
}

function addDescriptorBytes(current: number, value: unknown, index: number): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new McpResourceError("malformed-message");
  }
  if (serialized === undefined) throw new McpResourceError("malformed-message");
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > maxMcpDescriptorBytes) throw new McpResourceError("limit-exceeded");
  return current + bytes + (index === 0 ? 0 : 1);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function takeTextPrefix(text: string, maxCodePoints: number, maxBytes: number) {
  let result = "";
  let codePoints = 0;
  let bytes = 0;
  for (const character of text) {
    const characterBytes = new TextEncoder().encode(character).byteLength;
    if (codePoints >= maxCodePoints || bytes + characterBytes > maxBytes) {
      return { text: result, codePoints, bytes, truncated: true };
    }
    result += character;
    codePoints += 1;
    bytes += characterBytes;
  }
  return { text: result, codePoints, bytes, truncated: false };
}
