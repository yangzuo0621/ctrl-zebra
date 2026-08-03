import { randomUUID } from "node:crypto";

import {
  type ExtensionToWebviewMessage,
  mcpConnectionSchema,
  mcpPromptCatalogSchema,
  mcpResourceCatalogSchema,
  mcpToolCatalogSchema,
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
  #resourceSignature: string | undefined;
  #promptSignature: string | undefined;

  constructor({ connection, openSettings }: McpWebviewActionsDependencies) {
    this.#connection = connection;
    this.#openSettings = openSettings;
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
    await this.#connection.disconnect();
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
    if (snapshot.status !== "connected") {
      this.#toolSignature = undefined;
      this.#resourceSignature = undefined;
      this.#promptSignature = undefined;
      return;
    }
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
      const signature = JSON.stringify(catalog);
      if (force || signature !== this.#toolSignature) {
        this.#toolSignature = signature;
        post({ protocolVersion, type: "extension/mcp-tools", requestId, catalog });
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
