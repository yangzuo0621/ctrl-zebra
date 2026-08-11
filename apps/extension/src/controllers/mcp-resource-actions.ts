import { randomUUID } from "node:crypto";

import {
  allocateTokenBudget,
  maxModelContextWindowTokens,
  projectExternalResourceContext,
} from "@ctrl-zebra/core";
import { McpResourceError } from "@ctrl-zebra/mcp-client";
import {
  type McpResourceAttachment,
  type McpResourceSelectionDto,
  type McpResourceSnapshotDto,
  mcpResourceAttachmentSchema,
  mcpResourceSnapshotSchema,
} from "@ctrl-zebra/protocol";

import type { McpConnectionController } from "./mcp-connection-controller.js";

interface McpResourceActionsDependencies {
  readonly connection: Pick<McpConnectionController, "getState" | "readResource">;
  readonly createId?: () => string;
}

interface ResourcePreview {
  readonly snapshotId: string;
  readonly snapshot: McpResourceSnapshotDto;
}

export class McpResourceActions {
  readonly #connection: McpResourceActionsDependencies["connection"];
  readonly #createId: () => string;
  readonly #previews = new Map<string, McpResourceSnapshotDto>();
  readonly #attachments = new Map<string, McpResourceAttachment>();
  readonly #reads = new Set<AbortController>();
  #disposed = false;

  constructor({ connection, createId = randomUUID }: McpResourceActionsDependencies) {
    this.#connection = connection;
    this.#createId = createId;
  }

  async read(
    serverId: string,
    generation: number,
    selection: McpResourceSelectionDto,
    signal?: AbortSignal,
  ): Promise<ResourcePreview> {
    if (this.#disposed) throw new McpResourceError("resource-unavailable");
    const controller = new AbortController();
    this.#reads.add(controller);
    const combinedSignal =
      signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    try {
      const snapshot = mcpResourceSnapshotSchema.parse(
        await this.#connection.readResource(serverId, generation, selection, combinedSignal),
      );
      combinedSignal.throwIfAborted();
      const current = this.#connection.getState();
      if (
        current.status !== "connected" ||
        current.server?.serverId !== serverId ||
        current.generation !== generation
      ) {
        throw new McpResourceError("resource-unavailable");
      }
      const snapshotId = this.#createId();
      this.#previews.clear();
      this.#previews.set(snapshotId, snapshot);
      return { snapshotId, snapshot };
    } catch (error) {
      const current = this.#connection.getState();
      if (
        combinedSignal.aborted ||
        current.status !== "connected" ||
        current.server?.serverId !== serverId ||
        current.generation !== generation
      ) {
        throw new McpResourceReadCancelledError();
      }
      throw error;
    } finally {
      this.#reads.delete(controller);
    }
  }

  attach(serverId: string, generation: number, snapshotId: string): McpResourceAttachment {
    const snapshot = this.#previews.get(snapshotId);
    const current = this.#connection.getState();
    if (
      snapshot === undefined ||
      current.status !== "connected" ||
      current.server?.serverId !== serverId ||
      current.generation !== generation ||
      snapshot.server.serverId !== serverId ||
      snapshot.generation !== generation
    ) {
      throw new McpResourceError("resource-unavailable");
    }
    const provenance =
      current.connection?.configuredMode !== undefined &&
      current.connection.negotiated !== undefined
        ? {
            configuredMode: current.connection.configuredMode,
            negotiatedEra: current.connection.negotiated.era,
            negotiatedVersion: current.connection.negotiated.version,
          }
        : undefined;
    const attachment = mcpResourceAttachmentSchema.parse({
      snapshotId,
      serverId,
      uri: snapshot.uri,
      mimeType: snapshot.mimeType,
      text: snapshot.items.map(({ text }) => text).join(""),
      truncated: snapshot.truncated,
      ...(provenance === undefined ? {} : { provenance }),
    });
    const proposed = [...this.#attachments.values(), attachment];
    projectExternalResourceContext(
      proposed,
      allocateTokenBudget(maxModelContextWindowTokens).filesTokens,
    );
    this.#previews.delete(snapshotId);
    this.#attachments.set(snapshotId, attachment);
    return attachment;
  }

  takeAttachments(): readonly McpResourceAttachment[] {
    const attachments = [...this.#attachments.values()];
    this.#attachments.clear();
    return attachments;
  }

  clearInput(): void {
    this.#attachments.clear();
    this.invalidateLiveState();
  }

  detach(snapshotId: string): boolean {
    return this.#attachments.delete(snapshotId);
  }

  invalidateLiveState(): void {
    for (const controller of this.#reads) {
      controller.abort(new Error("MCP Resource state invalidated."));
    }
    this.#reads.clear();
    this.#previews.clear();
  }

  dispose(): void {
    this.#disposed = true;
    this.clearInput();
  }
}

export class McpResourceReadCancelledError extends Error {
  constructor() {
    super("MCP Resource read no longer belongs to an active connection.");
    this.name = "McpResourceReadCancelledError";
  }
}
