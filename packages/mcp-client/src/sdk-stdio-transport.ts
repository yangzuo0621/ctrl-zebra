import {
  deserializeMessage,
  type JSONRPCMessage,
  serializeMessage,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/client";

import {
  type McpClientErrorCode,
  type McpStderrSnapshot,
  type McpStdioPort,
  maxMcpMessageBytes,
} from "./contracts.js";
import { McpTransportFailure } from "./errors.js";
import { McpStderrCollector } from "./stderr-collector.js";

const newline = 0x0a;
const carriageReturn = 0x0d;

export class SdkStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly stderr = new McpStderrCollector();
  private readonly frameBytes: number[] = [];
  private acceptingMessages = false;
  private started = false;
  private closeNotified = false;
  private cleanupPromise: Promise<void> | undefined;
  private failureCode: McpClientErrorCode | undefined;
  private selectedProtocolVersion: string | undefined;
  private readonly ignoredResponseIds = new Set<string | number>();

  constructor(
    private readonly port: McpStdioPort,
    private readonly reportFailure: (code: McpClientErrorCode) => void,
  ) {}

  get failure(): McpClientErrorCode | undefined {
    return this.failureCode;
  }

  get protocolVersion(): string | undefined {
    return this.selectedProtocolVersion;
  }

  getStderr(): McpStderrSnapshot {
    return this.stderr.snapshot();
  }

  setProtocolVersion = (version: string): void => {
    this.selectedProtocolVersion = version;
  };

  setSupportedProtocolVersions = (_versions: string[]): void => {};

  /**
   * A probe may time out immediately before SDK handoff. Keep its correlation
   * id fenced so a late response cannot be interpreted by the new SDK request
   * registry or mutate a later generation.
   */
  ignoreResponseId(id: string | number): void {
    this.ignoredResponseIds.add(id);
  }

  async start(): Promise<void> {
    if (this.started) {
      if (this.acceptingMessages && this.failureCode === undefined) {
        return;
      }
      throw new McpTransportFailure(this.failureCode ?? "disconnected");
    }

    this.started = true;
    this.acceptingMessages = true;

    try {
      await this.port.start({
        stdout: (chunk) => this.receiveStdout(chunk),
        stderr: (chunk) => this.receiveStderr(chunk),
        exited: () => this.fail("server-exited"),
        error: () => this.fail("server-exited"),
      });
    } catch {
      this.fail("connect-failed");
      await this.waitForCleanup();
      throw new McpTransportFailure(this.failureCode ?? "connect-failed");
    }

    if (this.failureCode !== undefined) {
      throw new McpTransportFailure(this.failureCode);
    }
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (!this.acceptingMessages) {
      throw new McpTransportFailure("disconnected");
    }

    let bytes: Uint8Array;
    try {
      bytes = new TextEncoder().encode(serializeMessage(message));
    } catch {
      throw new McpTransportFailure("internal");
    }

    const messageBytes = bytes.at(-1) === newline ? bytes.byteLength - 1 : bytes.byteLength;
    if (messageBytes > maxMcpMessageBytes) {
      this.fail("limit-exceeded");
      throw new McpTransportFailure("limit-exceeded");
    }

    try {
      await this.port.write(bytes);
    } catch {
      this.fail("server-exited");
      throw new McpTransportFailure("server-exited");
    }
  }

  async close(): Promise<void> {
    this.closeDeliveryGate();
    await this.waitForCleanup();
  }

  closeDeliveryGate(): void {
    this.acceptingMessages = false;
    this.frameBytes.length = 0;
    this.notifyClosed();
    this.startCleanup();
  }

  async waitForCleanup(): Promise<void> {
    this.startCleanup();
    await this.cleanupPromise;
  }

  private receiveStdout(chunk: Uint8Array): void {
    if (!this.acceptingMessages) {
      return;
    }

    for (const byte of chunk) {
      if (!this.acceptingMessages) {
        return;
      }

      if (byte === newline) {
        this.deliverFrame();
        continue;
      }

      if (this.frameBytes.length >= maxMcpMessageBytes) {
        this.fail("limit-exceeded");
        return;
      }

      this.frameBytes.push(byte);
    }
  }

  private deliverFrame(): void {
    const end =
      this.frameBytes.at(-1) === carriageReturn
        ? this.frameBytes.length - 1
        : this.frameBytes.length;
    const bytes = Uint8Array.from(this.frameBytes.slice(0, end));
    this.frameBytes.length = 0;

    try {
      const line = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const message = deserializeMessage(line);
      if (isIgnoredResponse(message, this.ignoredResponseIds)) {
        return;
      }
      this.onmessage?.(message);
    } catch {
      this.fail("malformed-message");
    }
  }

  private receiveStderr(chunk: Uint8Array): void {
    if (this.acceptingMessages) {
      this.stderr.append(chunk);
    }
  }

  private fail(code: McpClientErrorCode): void {
    if (!this.acceptingMessages && this.failureCode !== undefined) {
      return;
    }

    this.acceptingMessages = false;
    this.frameBytes.length = 0;
    this.recordFailure(code);
    this.onerror?.(new McpTransportFailure(code));
    this.notifyClosed();
    this.startCleanup();
  }

  private recordFailure(code: McpClientErrorCode): void {
    if (this.failureCode === "termination-unconfirmed") {
      return;
    }

    this.failureCode = code;
    this.reportFailure(code);
  }

  private notifyClosed(): void {
    if (this.closeNotified) {
      return;
    }

    this.closeNotified = true;
    this.onclose?.();
  }

  private startCleanup(): void {
    this.cleanupPromise ??= this.cleanup();
  }

  private async cleanup(): Promise<void> {
    try {
      await this.port.closeInput();
    } catch {
      // Termination confirmation below is authoritative for cleanup success.
    }

    let termination: "terminated" | "unconfirmed" = "unconfirmed";
    try {
      termination = await this.port.terminate();
    } catch {
      termination = "unconfirmed";
    }

    if (termination === "unconfirmed") {
      this.recordFailure("termination-unconfirmed");
    }
  }
}

function isIgnoredResponse(message: JSONRPCMessage, ignoredIds: Set<string | number>): boolean {
  if (typeof message !== "object" || message === null || !("id" in message)) {
    return false;
  }
  if ("method" in message) {
    return false;
  }
  const id = message.id;
  if (typeof id !== "string" && typeof id !== "number") {
    return false;
  }
  return ignoredIds.delete(id);
}
