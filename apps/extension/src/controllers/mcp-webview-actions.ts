import { randomUUID } from "node:crypto";

import {
  type ExtensionToWebviewMessage,
  mcpConnectionSchema,
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
  >;
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
      return;
    }
    const connectionScope = catalogScope(snapshot.server.serverId, snapshot.generation);
    if (this.#catalogScope !== connectionScope) {
      this.#catalogScope = connectionScope;
      this.#catalogSequence = 0;
      this.#catalogSequenceBlocked = false;
      this.#toolSignature = undefined;
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
