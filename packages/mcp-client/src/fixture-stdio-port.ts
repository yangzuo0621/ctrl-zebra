import type { McpProcessTermination, McpStdioPort, McpStdioPortHandlers } from "./contracts.js";

type FixtureMessageHandler = (
  message: Readonly<Record<string, unknown>>,
  port: FixtureStdioPort,
) => void | Promise<void>;

interface MessageWaiter {
  readonly predicate: (message: Readonly<Record<string, unknown>>) => boolean;
  readonly resolve: (message: Readonly<Record<string, unknown>>) => void;
}

export class FixtureStdioPort implements McpStdioPort {
  readonly messages: Readonly<Record<string, unknown>>[] = [];
  startCount = 0;
  closeInputCount = 0;
  terminateCount = 0;
  termination: McpProcessTermination = "terminated";
  startFailure = false;
  writeFailure = false;

  private handlers: McpStdioPortHandlers | undefined;
  private readonly waiters: MessageWaiter[] = [];

  constructor(private readonly onMessage?: FixtureMessageHandler) {}

  async start(handlers: McpStdioPortHandlers): Promise<void> {
    this.startCount += 1;
    this.handlers = handlers;
    if (this.startFailure) {
      throw new Error("fixture start failure");
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.writeFailure) {
      throw new Error("fixture write failure");
    }

    const text = new TextDecoder().decode(bytes);
    for (const line of text.split("\n")) {
      if (line.length === 0) {
        continue;
      }

      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) {
        throw new Error("fixture expected a JSON object");
      }

      this.messages.push(parsed);
      this.resolveWaiters(parsed);
      await this.onMessage?.(parsed, this);
    }
  }

  async closeInput(): Promise<void> {
    this.closeInputCount += 1;
  }

  async terminate(): Promise<McpProcessTermination> {
    this.terminateCount += 1;
    return this.termination;
  }

  emitJson(message: Readonly<Record<string, unknown>>): void {
    this.emitRaw(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  }

  emitRaw(bytes: Uint8Array): void {
    this.handlers?.stdout(bytes);
  }

  emitStderr(bytes: Uint8Array): void {
    this.handlers?.stderr(bytes);
  }

  exit(): void {
    this.handlers?.exited();
  }

  fail(): void {
    this.handlers?.error(new Error("fixture port failure"));
  }

  waitForMessage(
    predicate: (message: Readonly<Record<string, unknown>>) => boolean,
  ): Promise<Readonly<Record<string, unknown>>> {
    const existing = this.messages.find(predicate);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve) => {
      this.waiters.push({ predicate, resolve });
    });
  }

  private resolveWaiters(message: Readonly<Record<string, unknown>>): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter?.predicate(message)) {
        this.waiters.splice(index, 1);
        waiter.resolve(message);
      }
    }
  }
}

export function jsonRpcId(message: Readonly<Record<string, unknown>>): string | number {
  const id = message.id;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new Error("fixture expected a JSON-RPC request id");
  }
  return id;
}

export function isMethod(method: string): (message: Readonly<Record<string, unknown>>) => boolean {
  return (message) => message.method === method;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
