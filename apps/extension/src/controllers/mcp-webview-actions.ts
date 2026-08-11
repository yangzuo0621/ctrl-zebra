import { randomUUID } from "node:crypto";
import type { McpToolDiagnostic, McpToolSnapshotView } from "@ctrl-zebra/mcp-client";
import {
  type ExtensionToWebviewMessage,
  type McpDiagnosticsProjectionDto,
  mcpConnectionSchema,
  mcpDiagnosticsMessageSchema,
  mcpPromptCatalogSchema,
  mcpResourceCatalogSchema,
  mcpToolCatalogMessageSchema,
  mcpToolCatalogProjectionSchema,
  mcpToolCatalogSchema,
  mcpToolsMessageSchema,
  protocolVersion,
} from "@ctrl-zebra/protocol";

import type {
  McpConnectionController,
  McpConnectionSnapshot,
} from "./mcp-connection-controller.js";

type PostMessage = (message: ExtensionToWebviewMessage) => void;

interface McpWebviewActionsDependencies {
  readonly connection: Pick<
    McpConnectionController,
    | "connect"
    | "disconnect"
    | "getState"
    | "getToolSnapshot"
    | "getResourceCatalog"
    | "getPromptCatalog"
  > & {
    readonly getToolDiagnostic?: () => McpToolDiagnostic | undefined;
    readonly refreshTools?: (serverId: string, generation: number) => Promise<boolean>;
  };
  readonly openSettings: () => void;
}

export class McpWebviewActions {
  readonly #connection: McpWebviewActionsDependencies["connection"];
  readonly #openSettings: () => void;
  #post: PostMessage | undefined;
  #poll: ReturnType<typeof setInterval> | undefined;
  #connectionSignature: string | undefined;
  #toolSignature: string | undefined;
  #catalogScope: string | undefined;
  #catalogSequence: number;
  #catalogSequenceBlocked = false;
  #disconnectPromise: Promise<unknown> | undefined;
  #resourceSignature: string | undefined;
  #promptSignature: string | undefined;
  #diagnosticSignature: string | undefined;
  #diagnosticSequence = 0;
  #diagnosticSequenceBlocked = false;

  constructor(
    { connection, openSettings }: McpWebviewActionsDependencies,
    options: {
      readonly initialCatalogScope?: string;
      readonly initialCatalogSequence?: number;
    } = {},
  ) {
    this.#connection = connection;
    this.#openSettings = openSettings;
    this.#catalogScope = options.initialCatalogScope;
    this.#catalogSequence = options.initialCatalogSequence ?? 0;
  }

  bind(post: PostMessage): void {
    this.#post = post;
    this.#poll = setInterval(() => this.#publish(`mcp-update-${randomUUID()}`, false), 500);
  }

  async connect(requestId: string): Promise<void> {
    await this.#connection.connect();
    this.#publish(requestId, true);
  }

  async disconnect(requestId: string): Promise<void> {
    await this.#requestDisconnect();
    this.#publish(requestId, true);
  }

  openSettings(): void {
    this.#openSettings();
  }

  refresh(requestId: string): void {
    this.#publish(requestId, true);
  }

  async refreshTools(requestId: string, serverId: string, generation: number): Promise<void> {
    const accepted = (await this.#connection.refreshTools?.(serverId, generation)) === true;
    if (!accepted) return;
    this.#publish(requestId, true);
  }

  dispose(): void {
    if (this.#poll !== undefined) clearInterval(this.#poll);
    this.#poll = undefined;
    this.#post = undefined;
  }

  #publish(requestId: string, force: boolean): void {
    const post = this.#post;
    if (post === undefined) return;
    const snapshot = this.#connection.getState();
    const connection = projectConnection(snapshot);
    const connectionSignature = JSON.stringify(connection);
    if (force || connectionSignature !== this.#connectionSignature) {
      this.#connectionSignature = connectionSignature;
      post({ protocolVersion, type: "extension/mcp-connection", requestId, connection });
    }
    if (snapshot.status !== "connected" || snapshot.server === undefined) {
      this.#toolSignature = undefined;
      this.#catalogScope = undefined;
      this.#catalogSequence = 0;
      this.#catalogSequenceBlocked = false;
      this.#resourceSignature = undefined;
      this.#promptSignature = undefined;
      if (snapshot.status === "failed" && snapshot.server !== undefined) {
        this.#publishDiagnostic(requestId, force, snapshot);
      } else {
        this.#resetDiagnostics();
      }
      return;
    }
    const connectionScope = catalogScope(snapshot.server.serverId, snapshot.generation);
    if (this.#catalogScope !== connectionScope) {
      this.#catalogScope = connectionScope;
      this.#catalogSequence = 0;
      this.#catalogSequenceBlocked = false;
      this.#toolSignature = undefined;
      this.#resetDiagnostics();
    }
    if (this.#catalogSequenceBlocked) return;
    const tools = this.#connection.getToolSnapshot();
    if (tools !== undefined) {
      const catalog = mcpToolCatalogSchema.parse({
        server: tools.server,
        generation: tools.generation,
        tools: tools.tools.map(({ registryName, mcpToolName, title, description }) => ({
          server: tools.server,
          generation: tools.generation,
          registryName,
          mcpToolName,
          title,
          description,
        })),
      });
      const projection = mcpToolCatalogProjectionSchema.parse({
        server: tools.server,
        generation: tools.generation,
        tools: catalog.tools,
        rejectedTools: tools.rejectedTools,
        rejectedToolsTruncated: tools.rejectedToolsTruncated,
      });
      const signature = JSON.stringify(projection);
      if (force || signature !== this.#toolSignature) {
        const catalogSequence = this.#nextCatalogSequence();
        if (catalogSequence === undefined) {
          this.#closeOverflowedGeneration(requestId);
          return;
        }
        const combined = mcpToolCatalogMessageSchema.safeParse({
          protocolVersion,
          type: "extension/mcp-tool-catalog",
          requestId,
          catalogSequence,
          catalog: projection,
        });
        if (combined.success) {
          const legacy = mcpToolsMessageSchema.parse({
            protocolVersion,
            type: "extension/mcp-tools",
            requestId,
            catalog,
          });
          this.#toolSignature = signature;
          this.#catalogSequence = catalogSequence;
          post(combined.data);
          post(legacy);
        }
      }
    }
    const resources = this.#connection.getResourceCatalog();
    if (resources !== undefined) {
      const catalog = mcpResourceCatalogSchema.parse(resources);
      const signature = JSON.stringify(catalog);
      if (force || signature !== this.#resourceSignature) {
        this.#resourceSignature = signature;
        post({ protocolVersion, type: "extension/mcp-resources", requestId, catalog });
      }
    }
    const prompts = this.#connection.getPromptCatalog();
    if (prompts !== undefined) {
      const catalog = mcpPromptCatalogSchema.parse(prompts);
      const signature = JSON.stringify(catalog);
      if (force || signature !== this.#promptSignature) {
        this.#promptSignature = signature;
        post({ protocolVersion, type: "extension/mcp-prompts", requestId, catalog });
      }
    }
    this.#publishDiagnostic(requestId, force, snapshot);
  }

  #publishDiagnostic(requestId: string, force: boolean, snapshot: McpConnectionSnapshot): void {
    const post = this.#post;
    if (post === undefined || snapshot.server === undefined) return;
    const projection = projectDiagnostic(
      snapshot,
      this.#connection.getToolSnapshot(),
      this.#connection.getToolDiagnostic?.(),
    );
    if (projection === undefined) return;
    if (this.#diagnosticSequenceBlocked) return;
    const diagnosticSequence = nextMcpDiagnosticSequence(this.#diagnosticSequence);
    if (diagnosticSequence === undefined) {
      this.#diagnosticSequenceBlocked = true;
      this.#closeOverflowedGeneration(requestId);
      return;
    }
    const parsed = fitDiagnosticEnvelope(requestId, diagnosticSequence, projection);
    if (!parsed.success) return;
    const signature = JSON.stringify(parsed.data.diagnostic);
    if (!force && signature === this.#diagnosticSignature) return;
    this.#diagnosticSequence = diagnosticSequence;
    this.#diagnosticSignature = signature;
    post(parsed.data);
  }

  #resetDiagnostics(): void {
    this.#diagnosticSignature = undefined;
    this.#diagnosticSequence = 0;
    this.#diagnosticSequenceBlocked = false;
  }

  #nextCatalogSequence(): number | undefined {
    const next = nextMcpCatalogSequence(this.#catalogSequence);
    if (this.#catalogSequenceBlocked || next === undefined) {
      this.#catalogSequenceBlocked = true;
      return undefined;
    }
    return next;
  }

  #closeOverflowedGeneration(requestId: string): void {
    const disconnect = this.#requestDisconnect();
    void disconnect.then(
      () => this.#publish(requestId, true),
      () => this.#publish(requestId, true),
    );
  }

  #requestDisconnect(): Promise<unknown> {
    if (this.#disconnectPromise !== undefined) return this.#disconnectPromise;
    const disconnect = this.#connection.disconnect();
    this.#disconnectPromise = disconnect;
    void disconnect.then(
      () => {
        if (this.#disconnectPromise === disconnect) this.#disconnectPromise = undefined;
      },
      () => {
        if (this.#disconnectPromise === disconnect) this.#disconnectPromise = undefined;
      },
    );
    return disconnect;
  }
}

export function nextMcpCatalogSequence(current: number): number | undefined {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    return undefined;
  }
  return current + 1;
}

export function nextMcpDiagnosticSequence(current: number): number | undefined {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    return undefined;
  }
  return current + 1;
}

function catalogScope(serverId: string, generation: number): string {
  return `${serverId}\u0000${generation}`;
}

function projectConnection(snapshot: McpConnectionSnapshot) {
  const base = {
    generation: snapshot.generation,
    server: snapshot.server,
    configurationStale: snapshot.configurationStale,
  };
  if (snapshot.status === "connected" && snapshot.connection !== undefined) {
    return mcpConnectionSchema.parse({
      ...base,
      status: "connected",
      protocolVersion: snapshot.connection.protocolVersion,
      capabilities: snapshot.connection.capabilities,
    });
  }
  if (snapshot.status === "failed" && snapshot.error !== undefined) {
    return mcpConnectionSchema.parse({ ...base, status: "failed", error: snapshot.error });
  }
  return mcpConnectionSchema.parse({ ...base, status: snapshot.status });
}

function projectDiagnostic(
  snapshot: McpConnectionSnapshot,
  tools: McpToolSnapshotView | undefined,
  retained: McpToolDiagnostic | undefined,
): McpDiagnosticsProjectionDto | undefined {
  if (snapshot.server === undefined) return undefined;
  const source = { server: snapshot.server, generation: snapshot.generation };
  if (snapshot.status === "failed" && snapshot.error?.code === "protocol-incompatible") {
    return {
      kind: "protocol-incompatible",
      ...source,
      connectionStatus: "failed",
      configuredMode: "modern-only",
      supportedVersions: ["2026-07-28"],
      connectionEstablished: false,
      nextStep: "open-settings",
    };
  }
  if (snapshot.status === "failed") {
    const diagnostic = retained;
    if (diagnostic?.kind === "rejections") {
      return {
        kind: "tool-rejections",
        outcome: "all-rejected",
        ...source,
        connectionStatus: "failed",
        ...boundedDiagnosticEntries(diagnostic.rejectedTools, diagnostic.rejectedToolsTruncated),
        recoveryAction: "reconnect",
      };
    }
    if (diagnostic?.kind === "failure") {
      return {
        kind: "tool-discovery-failure",
        outcome: "initial",
        ...source,
        connectionStatus: "failed",
        code: diagnostic.code,
        recoveryAction: "reconnect",
      };
    }
    return undefined;
  }
  if (snapshot.status !== "connected") return undefined;
  const diagnostic = retained;
  if (diagnostic?.kind === "failure") {
    return {
      kind: "tool-discovery-failure",
      outcome: "refresh",
      ...source,
      connectionStatus: "connected",
      code: diagnostic.code,
      recoveryAction: "refresh-tools",
    };
  }
  if (diagnostic?.kind === "rejections") {
    return {
      kind: "tool-rejections",
      outcome: "refresh-all-rejected",
      ...source,
      connectionStatus: "connected",
      ...boundedDiagnosticEntries(diagnostic.rejectedTools, diagnostic.rejectedToolsTruncated),
      recoveryAction: "refresh-tools",
    };
  }
  if (tools === undefined) return undefined;
  const skipped = tools.rejectedTools;
  if (skipped.length === 0) {
    return { kind: "clear", ...source };
  }
  return {
    kind: "tool-rejections",
    outcome: "degraded",
    ...source,
    connectionStatus: "connected",
    ...boundedDiagnosticEntries(skipped, tools.rejectedToolsTruncated),
    recoveryAction: "refresh-tools",
  };
}

function boundedDiagnosticEntries(
  entries: readonly {
    readonly mcpToolName: string;
    readonly reason:
      | "forbidden-keyword"
      | "unknown-keyword"
      | "invalid-reference"
      | "non-object-root"
      | "schema-invalid"
      | "limit-exceeded";
  }[],
  alreadyTruncated = false,
) {
  const unique = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) unique.set(`${entry.mcpToolName}\u0000${entry.reason}`, entry);
  const sorted = [...unique.values()].sort((left, right) => {
    const byName = compareUnicodeScalars(left.mcpToolName, right.mcpToolName);
    return byName === 0 ? compareUnicodeScalars(left.reason, right.reason) : byName;
  });
  const skippedTools = sorted.slice(0, 256);
  return {
    skippedTools,
    skippedToolsTruncated: alreadyTruncated || sorted.length > skippedTools.length,
  };
}

function fitDiagnosticEnvelope(
  requestId: string,
  diagnosticSequence: number,
  projection: McpDiagnosticsProjectionDto,
) {
  let candidate = projection;
  while (true) {
    const parsed = mcpDiagnosticsMessageSchema.safeParse({
      protocolVersion,
      type: "extension/mcp-diagnostics",
      requestId,
      diagnosticSequence,
      diagnostic: candidate,
    });
    if (parsed.success) return parsed;
    if (candidate.kind !== "tool-rejections" || candidate.skippedTools.length === 0) return parsed;
    candidate = {
      ...candidate,
      skippedTools: candidate.skippedTools.slice(0, -1),
      skippedToolsTruncated: true,
    };
  }
}

function compareUnicodeScalars(left: string, right: string): number {
  const leftScalars = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightScalars = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftScalars.length, rightScalars.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftScalars[index] ?? 0) - (rightScalars[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftScalars.length - rightScalars.length;
}
