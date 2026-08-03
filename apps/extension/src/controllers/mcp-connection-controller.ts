import type {
  ControlledMcpClient,
  McpClientErrorCode,
  McpConnectedState,
  McpDisconnectOutcome,
  McpStdioPort,
} from "@ctrl-zebra/mcp-client";

import {
  type McpServerConfiguration,
  McpServerConfigurationError,
} from "../adapters/mcp-server-configuration.js";
import type { McpHostProcessFailure, McpProcessOperation } from "../adapters/mcp-stdio-port.js";
import {
  type McpServerStartOperation,
  type McpStartupApprovalOutcome,
  sameMcpStartOperation,
} from "./mcp-startup-approval.js";
import type { WorkspaceTrustPolicy } from "./workspace-trust-policy.js";

export type McpHostErrorCode =
  | "configuration-invalid"
  | "workspace-untrusted"
  | "approval-denied"
  | "approval-expired"
  | "approval-invalidated"
  | "spawn-failed"
  | McpClientErrorCode;

export interface McpHostError {
  readonly code: McpHostErrorCode;
  readonly message: string;
}

export interface McpConnectionSnapshot {
  readonly generation: number;
  readonly status: "disconnected" | "connecting" | "connected" | "disconnecting" | "failed";
  readonly server?: { readonly serverId: string; readonly displayName: string };
  readonly configurationStale: boolean;
  readonly connection?: McpConnectedState;
  readonly error?: McpHostError;
}

interface ControlledMcpClientPort {
  getState(): ReturnType<ControlledMcpClient["getState"]>;
  connect(signal?: AbortSignal): ReturnType<ControlledMcpClient["connect"]>;
  disconnect(): Promise<McpDisconnectOutcome>;
  dispose(): Promise<McpDisconnectOutcome>;
}

interface HostMcpStdioPort extends McpStdioPort {
  readonly hostFailure?: McpHostProcessFailure;
}

export interface McpWorkspaceBinding {
  readonly cwdUri: string;
  readonly cwdPath: string;
}

interface McpConnectionControllerDependencies {
  readonly readConfiguration: () => McpServerConfiguration;
  readonly bindWorkspace: (signal: AbortSignal) => Promise<McpWorkspaceBinding>;
  readonly workspaceTrust: WorkspaceTrustPolicy;
  readonly environment: Readonly<Record<string, string>>;
  readonly requestStartupApproval: (
    operation: McpServerStartOperation,
    signal: AbortSignal,
  ) => Promise<McpStartupApprovalOutcome>;
  readonly createPort: (
    operation: McpProcessOperation,
    onFailure: (failure: McpHostProcessFailure) => void,
  ) => HostMcpStdioPort;
  readonly createClient: (port: McpStdioPort) => ControlledMcpClientPort;
  readonly notifyInformation: (message: string) => void;
  readonly notifyError: (message: string) => void;
  readonly log: (entry: Readonly<Record<string, unknown>>) => void;
}

const emptySnapshot: McpConnectionSnapshot = {
  generation: 0,
  status: "disconnected",
  configurationStale: false,
};

export class McpConnectionController {
  readonly #dependencies: McpConnectionControllerDependencies;
  #snapshot: McpConnectionSnapshot = emptySnapshot;
  #operation: McpServerStartOperation | undefined;
  #client: ControlledMcpClientPort | undefined;
  #port: HostMcpStdioPort | undefined;
  #connectPromise: Promise<McpConnectionSnapshot> | undefined;
  #attemptController: AbortController | undefined;
  #disposed = false;
  #terminationBlocked = false;

  constructor(dependencies: McpConnectionControllerDependencies) {
    this.#dependencies = dependencies;
  }

  getState(): McpConnectionSnapshot {
    return this.#snapshot;
  }

  connect(signal?: AbortSignal): Promise<McpConnectionSnapshot> {
    if (this.#disposed) {
      return Promise.reject(new Error("The MCP connection controller has been disposed."));
    }
    if (this.#connectPromise !== undefined) {
      return this.#connectPromise;
    }
    if (this.#snapshot.status === "connected") {
      this.#dependencies.notifyInformation("The MCP Server is already connected.");
      return Promise.resolve(this.#snapshot);
    }
    if (this.#terminationBlocked) {
      return Promise.resolve(this.#fail("termination-unconfirmed"));
    }

    const attemptController = new AbortController();
    this.#attemptController = attemptController;
    const attemptSignal =
      signal === undefined
        ? attemptController.signal
        : AbortSignal.any([signal, attemptController.signal]);
    const attempt = this.#connectOnce(attemptSignal).finally(() => {
      if (this.#connectPromise === attempt) {
        this.#connectPromise = undefined;
        this.#attemptController = undefined;
      }
    });
    this.#connectPromise = attempt;
    return attempt;
  }

  async disconnect(): Promise<McpConnectionSnapshot> {
    this.#attemptController?.abort(new Error("MCP connection cancelled by disconnect."));
    const client = this.#client;
    if (client === undefined) {
      await this.#connectPromise;
      this.#clearConnection();
      this.#dependencies.notifyInformation("The MCP Server is disconnected.");
      return this.#snapshot;
    }

    this.#snapshot = { ...this.#snapshot, status: "disconnecting", connection: undefined };
    const outcome = await client.disconnect();
    if (outcome.kind === "failed" && outcome.error.code === "termination-unconfirmed") {
      this.#terminationBlocked = true;
      const failed = this.#fail("termination-unconfirmed");
      this.#dependencies.notifyError(failed.error?.message ?? mcpHostErrorMessages.internal);
      return failed;
    }

    this.#clearConnection();
    this.#dependencies.notifyInformation("The MCP Server is disconnected.");
    return this.#snapshot;
  }

  markConfigurationStale(): void {
    if (
      this.#operation === undefined ||
      (this.#snapshot.status !== "connecting" && this.#snapshot.status !== "connected")
    ) {
      return;
    }
    this.#snapshot = { ...this.#snapshot, configurationStale: true };
    this.#dependencies.notifyInformation(
      "The MCP Server configuration changed. Disconnect before reconnecting.",
    );
  }

  handleWorkspaceTrustChange(): void {
    if (this.#dependencies.workspaceTrust.isTrusted()) {
      return;
    }
    this.#attemptController?.abort(
      new Error("MCP connection cancelled after workspace trust loss."),
    );
    void this.disconnect().catch(() => {
      this.#fail("internal");
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#attemptController?.abort(new Error("MCP connection controller disposed."));
    try {
      const outcome = await this.#client?.dispose();
      await this.#connectPromise;
      if (outcome?.kind === "failed" && outcome.error.code === "termination-unconfirmed") {
        this.#terminationBlocked = true;
        this.#fail("termination-unconfirmed", this.#operation?.configuration);
        throw new McpConnectionDisposalError();
      }
    } finally {
      if (!this.#terminationBlocked) {
        this.#clearConnection();
      }
    }
  }

  async #connectOnce(signal: AbortSignal): Promise<McpConnectionSnapshot> {
    try {
      await this.#releaseFailedClient();
      signal.throwIfAborted();
      const operation = await this.#readOperation(signal);
      const approval = await this.#dependencies.requestStartupApproval(operation, signal);
      if (approval !== "approved") {
        return this.#finishApprovalOutcome(approval);
      }

      let currentOperation: McpServerStartOperation;
      try {
        currentOperation = await this.#readOperation(signal);
      } catch {
        if (signal.aborted) {
          throw signal.reason;
        }
        return this.#failAndNotify("approval-invalidated", operation.configuration);
      }
      if (!sameMcpStartOperation(operation, currentOperation)) {
        return this.#failAndNotify("approval-invalidated", operation.configuration);
      }
      signal.throwIfAborted();
      this.#dependencies.workspaceTrust.requireTrusted();

      const generation = this.#snapshot.generation + 1;
      this.#operation = operation;
      this.#snapshot = {
        generation,
        status: "connecting",
        server: identity(operation.configuration),
        configurationStale: false,
      };
      this.#port = this.#dependencies.createPort(operation, (failure) =>
        this.#handleHostFailure(generation, failure),
      );
      this.#client = this.#dependencies.createClient(this.#port);
      const outcome = await this.#client.connect(signal);

      if (outcome.kind === "cancelled") {
        this.#clearConnection();
        return this.#snapshot;
      }
      if (outcome.kind === "failed") {
        const code = this.#mapConnectionFailure(outcome.error.code);
        return this.#failAndNotify(code, operation.configuration);
      }

      if (this.#snapshot.status === "failed") {
        return this.#snapshot;
      }
      this.#snapshot = {
        generation,
        status: "connected",
        server: identity(operation.configuration),
        configurationStale: false,
        connection: outcome.connection,
      };
      this.#dependencies.log({
        event: "mcp_connection_completed",
        component: "mcp",
        outcome: "success",
        serverId: operation.configuration.serverId,
        generation,
      });
      this.#dependencies.notifyInformation(
        `Connected to MCP Server “${operation.configuration.displayName}”.`,
      );
      return this.#snapshot;
    } catch (error) {
      if (signal.aborted) {
        const cleanup = await this.#client?.dispose();
        if (cleanup?.kind === "failed" && cleanup.error.code === "termination-unconfirmed") {
          this.#terminationBlocked = true;
          return this.#failAndNotify("termination-unconfirmed", this.#operation?.configuration);
        }
        this.#clearConnection();
        return this.#snapshot;
      }
      if (error instanceof McpServerConfigurationError) {
        return this.#failAndNotify("configuration-invalid");
      }
      if (!this.#dependencies.workspaceTrust.isTrusted()) {
        return this.#failAndNotify("workspace-untrusted", this.#operation?.configuration);
      }
      return this.#failAndNotify("internal", this.#operation?.configuration);
    }
  }

  async #readOperation(signal: AbortSignal): Promise<McpServerStartOperation> {
    this.#dependencies.workspaceTrust.requireTrusted();
    signal.throwIfAborted();
    const configuration = this.#dependencies.readConfiguration();
    const binding = await this.#dependencies.bindWorkspace(signal);
    signal.throwIfAborted();
    this.#dependencies.workspaceTrust.requireTrusted();
    return {
      configuration,
      command: configuration.command,
      args: configuration.args,
      cwdUri: binding.cwdUri,
      cwdPath: binding.cwdPath,
      environment: this.#dependencies.environment,
    };
  }

  #finishApprovalOutcome(outcome: Exclude<McpStartupApprovalOutcome, "approved">) {
    if (outcome === "cancelled") {
      this.#clearConnection();
      return this.#snapshot;
    }
    return this.#failAndNotify(outcome === "expired" ? "approval-expired" : "approval-denied");
  }

  #mapConnectionFailure(code: McpClientErrorCode): McpHostErrorCode {
    if (this.#port?.hostFailure === "spawn-failed") {
      return "spawn-failed";
    }
    if (this.#port?.hostFailure === "termination-unconfirmed") {
      this.#terminationBlocked = true;
      return "termination-unconfirmed";
    }
    return code;
  }

  #handleHostFailure(generation: number, failure: McpHostProcessFailure): void {
    if (
      generation !== this.#snapshot.generation ||
      this.#snapshot.status === "disconnecting" ||
      this.#snapshot.status === "disconnected"
    ) {
      return;
    }
    if (failure === "termination-unconfirmed") {
      this.#terminationBlocked = true;
    }
    this.#failAndNotify(failure, this.#operation?.configuration);
  }

  async #releaseFailedClient(): Promise<void> {
    if (this.#snapshot.status !== "failed" || this.#client === undefined) {
      return;
    }
    const outcome = await this.#client.dispose();
    if (outcome.kind === "failed" && outcome.error.code === "termination-unconfirmed") {
      this.#terminationBlocked = true;
      throw new Error("MCP Server process termination is unconfirmed.");
    }
    this.#client = undefined;
    this.#port = undefined;
    this.#operation = undefined;
  }

  #failAndNotify(code: McpHostErrorCode, configuration?: McpServerConfiguration) {
    const failed = this.#fail(code, configuration);
    this.#dependencies.notifyError(failed.error?.message ?? mcpHostErrorMessages.internal);
    return failed;
  }

  #fail(code: McpHostErrorCode, configuration?: McpServerConfiguration): McpConnectionSnapshot {
    const server = configuration === undefined ? this.#snapshot.server : identity(configuration);
    this.#snapshot = {
      generation: this.#snapshot.generation,
      status: "failed",
      server,
      configurationStale: this.#snapshot.configurationStale,
      error: { code, message: mcpHostErrorMessages[code] },
    };
    this.#dependencies.log({
      event: "mcp_connection_failed",
      component: "mcp",
      outcome: "failure",
      errorCode: code,
      serverId: server?.serverId,
      generation: this.#snapshot.generation,
    });
    return this.#snapshot;
  }

  #clearConnection(): void {
    this.#client = undefined;
    this.#port = undefined;
    this.#operation = undefined;
    this.#snapshot = {
      generation: this.#snapshot.generation,
      status: "disconnected",
      server: this.#snapshot.server,
      configurationStale: false,
    };
  }
}

const mcpHostErrorMessages = {
  "configuration-invalid": "Configure one valid MCP Server in your user settings.",
  "workspace-untrusted": "Trust this workspace before starting an MCP Server.",
  "approval-denied": "MCP Server startup was not approved.",
  "approval-expired": "MCP Server startup approval expired.",
  "approval-invalidated": "MCP Server startup approval became invalid before the process started.",
  "spawn-failed": "The MCP Server process could not be started.",
  "connect-failed": "Could not connect to the MCP Server.",
  "protocol-incompatible": "The MCP Server does not support the required protocol version.",
  "capability-unsupported": "The MCP Server requested an unsupported capability.",
  "malformed-message": "The MCP Server sent a malformed message.",
  "limit-exceeded": "The MCP Server exceeded a resource limit.",
  "server-exited": "The MCP Server exited unexpectedly.",
  disconnected: "The MCP Server is disconnected.",
  "termination-unconfirmed": "The MCP Server process could not be confirmed as terminated.",
  internal: "The MCP connection failed unexpectedly.",
} as const satisfies Record<McpHostErrorCode, string>;

function identity(configuration: McpServerConfiguration) {
  return { serverId: configuration.serverId, displayName: configuration.displayName };
}

export class McpConnectionDisposalError extends Error {
  constructor() {
    super("The MCP Server process could not be confirmed as terminated during disposal.");
    this.name = "McpConnectionDisposalError";
  }
}
