import {
  Client,
  SdkError,
  SdkErrorCode,
  type ServerCapabilities,
  UnsupportedProtocolVersionError,
} from "@modelcontextprotocol/client";

import {
  type ControlledMcpClientOptions,
  type McpClientError,
  type McpClientErrorCode,
  type McpConnectedState,
  type McpConnectionState,
  type McpConnectOutcome,
  type McpDisconnectOutcome,
  type McpServerCapabilities,
  type McpStderrSnapshot,
  type McpStdioPort,
  mcpProtocolVersion,
} from "./contracts.js";
import { createMcpClientError } from "./errors.js";
import { controlledSdkClientOptions } from "./sdk-options.js";
import { SdkStdioTransport } from "./sdk-stdio-transport.js";

const emptyCapabilities: McpServerCapabilities = {
  tools: false,
  toolsListChanged: false,
  resources: false,
  resourceTemplates: false,
  resourcesListChanged: false,
  prompts: false,
  promptsListChanged: false,
};

export class ControlledMcpClient {
  private readonly sdkClient: Client;
  private readonly transport: SdkStdioTransport;
  private status: McpConnectionState["status"] = "disconnected";
  private connectedState: McpConnectedState | undefined;
  private failure: McpClientError | undefined;
  private connectPromise: Promise<McpConnectOutcome> | undefined;
  private consumed = false;

  constructor(port: McpStdioPort, options: ControlledMcpClientOptions = {}) {
    this.sdkClient = new Client(
      {
        name: options.clientName ?? "ctrl-zebra",
        version: options.clientVersion ?? "0.0.0",
      },
      controlledSdkClientOptions,
    );
    this.transport = new SdkStdioTransport(port, (code) => this.handleTransportFailure(code));
  }

  getState(): McpConnectionState {
    if (this.status === "connected" && this.connectedState !== undefined) {
      return this.connectedState;
    }

    if (this.status === "failed" && this.failure !== undefined) {
      return { status: "failed", capabilities: emptyCapabilities, error: this.failure };
    }

    return {
      status: this.status as "disconnected" | "connecting" | "disconnecting",
      capabilities: emptyCapabilities,
    };
  }

  getStderr(): McpStderrSnapshot {
    return this.transport.getStderr();
  }

  connect(signal?: AbortSignal): Promise<McpConnectOutcome> {
    if (this.status === "connected" && this.connectedState !== undefined) {
      return Promise.resolve({ kind: "connected", connection: this.connectedState });
    }

    if (this.connectPromise !== undefined) {
      return this.connectPromise;
    }

    if (this.consumed) {
      return Promise.resolve({ kind: "failed", error: createMcpClientError("disconnected") });
    }

    this.consumed = true;
    this.status = "connecting";
    this.connectPromise = this.connectOnce(signal).finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  async disconnect(): Promise<McpDisconnectOutcome> {
    if (this.status === "disconnected" && !this.consumed) {
      return { kind: "disconnected" };
    }

    if (this.status === "failed") {
      await this.transport.waitForCleanup();
      return { kind: "failed", error: this.failure ?? createMcpClientError("internal") };
    }

    this.status = "disconnecting";
    this.connectedState = undefined;
    this.transport.closeDeliveryGate();

    try {
      await this.sdkClient.close();
      await this.connectPromise;
    } catch {
      // The stable cleanup result below owns disconnect classification.
    }

    await this.transport.waitForCleanup();
    if (this.transport.failure === "termination-unconfirmed") {
      return { kind: "failed", error: this.setFailure("termination-unconfirmed") };
    }

    this.status = "disconnected";
    this.failure = undefined;
    return { kind: "disconnected" };
  }

  dispose(): Promise<McpDisconnectOutcome> {
    return this.disconnect();
  }

  private async connectOnce(signal?: AbortSignal): Promise<McpConnectOutcome> {
    if (signal?.aborted) {
      this.status = "disconnected";
      return { kind: "cancelled" };
    }

    const abortConnection = (): void => this.transport.closeDeliveryGate();
    signal?.addEventListener("abort", abortConnection, { once: true });

    try {
      await this.sdkClient.connect(this.transport, { signal });

      if (signal?.aborted || this.status === "disconnecting") {
        await this.transport.close();
        return { kind: "cancelled" };
      }

      if (this.transport.protocolVersion !== mcpProtocolVersion) {
        const failure = this.setFailure("protocol-incompatible");
        await this.transport.close();
        return { kind: "failed", error: failure };
      }

      const connection: McpConnectedState = {
        status: "connected",
        protocolVersion: mcpProtocolVersion,
        capabilities: projectCapabilities(this.sdkClient.getServerCapabilities()),
      };
      this.connectedState = connection;
      this.failure = undefined;
      this.status = "connected";
      return { kind: "connected", connection };
    } catch (error) {
      const cancelled = signal?.aborted === true || this.status === "disconnecting";
      this.transport.closeDeliveryGate();
      try {
        await this.sdkClient.close();
      } catch {
        // Transport cleanup and termination confirmation below remain authoritative.
      }
      await this.transport.waitForCleanup();

      if (this.transport.failure === "termination-unconfirmed") {
        return { kind: "failed", error: this.setFailure("termination-unconfirmed") };
      }

      if (cancelled) {
        if (this.status !== "disconnecting") {
          this.status = "disconnected";
        }
        return { kind: "cancelled" };
      }

      return {
        kind: "failed",
        error: this.setFailure(classifySdkFailure(error, this.transport.failure)),
      };
    } finally {
      signal?.removeEventListener("abort", abortConnection);
    }
  }

  private handleTransportFailure(code: McpClientErrorCode): void {
    if (this.status === "disconnecting" && code !== "termination-unconfirmed") {
      return;
    }

    this.setFailure(code);
  }

  private setFailure(code: McpClientErrorCode): McpClientError {
    this.connectedState = undefined;
    const failure = createMcpClientError(code);
    this.failure = failure;
    this.status = "failed";
    return failure;
  }
}

function projectCapabilities(capabilities: ServerCapabilities | undefined): McpServerCapabilities {
  return {
    tools: capabilities?.tools !== undefined,
    toolsListChanged: capabilities?.tools?.listChanged === true,
    resources: capabilities?.resources !== undefined,
    resourceTemplates: capabilities?.resources !== undefined,
    resourcesListChanged: capabilities?.resources?.listChanged === true,
    prompts: capabilities?.prompts !== undefined,
    promptsListChanged: capabilities?.prompts?.listChanged === true,
  };
}

function classifySdkFailure(
  error: unknown,
  transportFailure: McpClientErrorCode | undefined,
): McpClientErrorCode {
  if (transportFailure !== undefined) {
    return transportFailure;
  }

  if (error instanceof UnsupportedProtocolVersionError) {
    return "protocol-incompatible";
  }

  if (error instanceof SdkError) {
    if (
      error.code === SdkErrorCode.EraNegotiationFailed ||
      error.code === SdkErrorCode.MethodNotSupportedByProtocolVersion
    ) {
      return "protocol-incompatible";
    }

    if (
      error.code === SdkErrorCode.CapabilityNotSupported ||
      error.code === SdkErrorCode.UnsupportedResultType
    ) {
      return "capability-unsupported";
    }

    if (error.code === SdkErrorCode.InvalidResult) {
      return "malformed-message";
    }

    if (error.code === SdkErrorCode.ConnectionClosed) {
      return "server-exited";
    }
  }

  return "connect-failed";
}
