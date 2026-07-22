import { maxCommandDisplayOutputBytes } from "@ctrl-zebra/protocol";

import type {
  CommandExit,
  CommandOutputEvent,
  CommandOutputSink,
  SpawnCommandRequest,
} from "../adapters/spawn-command-runner.js";

export { maxCommandDisplayOutputBytes };
export const maxCommandContextOutputBytes = 32_768;
export const maxCommandLogOutputBytes = 16_777_216;

type CommandStream = "stdout" | "stderr";
type CommandStreamEvent = Extract<CommandOutputEvent, { readonly type: CommandStream }>;

export interface CommandOutputSnapshot {
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}

export interface CommandOutputLogReference {
  readonly uri: string;
  readonly truncated: boolean;
}

export interface CollectedCommandOutput {
  readonly display: CommandOutputSnapshot;
  readonly context: CommandOutputSnapshot;
  readonly exit: CommandExit;
  readonly log?: CommandOutputLogReference;
}

export interface CommandOutputLogSink {
  /** The host owns the destination, retention, permissions, and cleanup; model input cannot select it. */
  append(stream: CommandStream, text: string): Promise<void>;
  close(): Promise<string>;
}

export interface CommandOutputRunner {
  run(
    request: SpawnCommandRequest,
    signal: AbortSignal,
    emit: CommandOutputSink,
  ): Promise<CommandExit>;
}

interface CommandOutputLimits {
  readonly displayBytes: number;
  readonly contextBytes: number;
  readonly logBytes: number;
}

export class CommandOutputCollector {
  readonly #display: BoundedCommandStreams;
  readonly #context: BoundedCommandStreams;
  readonly #logSink: CommandOutputLogSink | undefined;
  readonly #logLimit: number;
  #logBytes = 0;
  #logTruncated = false;
  #logQueue: Promise<void> = Promise.resolve();
  #logError: unknown;
  #exit: CommandExit | undefined;
  #closed = false;

  constructor(logSink?: CommandOutputLogSink, limits: Partial<CommandOutputLimits> = {}) {
    const selected = {
      displayBytes: limits.displayBytes ?? maxCommandDisplayOutputBytes,
      contextBytes: limits.contextBytes ?? maxCommandContextOutputBytes,
      logBytes: limits.logBytes ?? maxCommandLogOutputBytes,
    };
    if (
      !isByteLimit(selected.displayBytes) ||
      !isByteLimit(selected.contextBytes) ||
      !isByteLimit(selected.logBytes) ||
      selected.contextBytes > selected.displayBytes
    ) {
      throw new InvalidCommandOutputLimitError();
    }

    this.#display = new BoundedCommandStreams(selected.displayBytes);
    this.#context = new BoundedCommandStreams(selected.contextBytes);
    this.#logSink = logSink;
    this.#logLimit = selected.logBytes;
  }

  record(event: CommandOutputEvent): void {
    if (this.#closed || this.#exit !== undefined) {
      throw new InvalidCommandOutputSequenceError();
    }
    if (event.type === "exit") {
      this.#exit = event;
      return;
    }

    this.#display.append(event.type, event.text);
    this.#context.append(event.type, event.text);
    this.#appendLog(event);
  }

  async complete(): Promise<CollectedCommandOutput> {
    if (this.#closed || this.#exit === undefined) {
      throw new InvalidCommandOutputSequenceError();
    }
    this.#closed = true;
    await this.#logQueue;
    if (this.#logError !== undefined) {
      await this.#closeLogIgnoringErrors();
      throw new CommandOutputLogError({ cause: this.#logError });
    }

    let log: CommandOutputLogReference | undefined;
    if (this.#logSink !== undefined) {
      try {
        const uri = await this.#logSink.close();
        if (uri.length === 0) {
          throw new Error("Command log URI is empty.");
        }
        log = { uri, truncated: this.#logTruncated };
      } catch (error) {
        throw new CommandOutputLogError({ cause: error });
      }
    }

    return {
      display: this.#display.snapshot(),
      context: this.#context.snapshot(),
      exit: this.#exit,
      ...(log === undefined ? {} : { log }),
    };
  }

  async dispose(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#logQueue;
    await this.#closeLogIgnoringErrors();
  }

  #appendLog(event: CommandStreamEvent): void {
    if (this.#logSink === undefined || this.#logTruncated || event.text.length === 0) {
      return;
    }
    const remaining = this.#logLimit - this.#logBytes;
    const prefix = takeUtf8Prefix(event.text, remaining);
    this.#logBytes += prefix.bytes;
    this.#logTruncated ||= prefix.truncated;
    if (prefix.text.length === 0) {
      return;
    }

    this.#logQueue = this.#logQueue.then(async () => {
      if (this.#logError !== undefined) {
        return;
      }
      try {
        await this.#logSink?.append(event.type, prefix.text);
      } catch (error) {
        this.#logError = error;
      }
    });
  }

  async #closeLogIgnoringErrors(): Promise<void> {
    if (this.#logSink === undefined) {
      return;
    }
    try {
      await this.#logSink.close();
    } catch {
      // Cleanup cannot replace the command or primary log failure.
    }
  }
}

export async function runCommandWithCollectedOutput(
  runner: CommandOutputRunner,
  request: SpawnCommandRequest,
  signal: AbortSignal,
  logSink?: CommandOutputLogSink,
): Promise<CollectedCommandOutput> {
  const collector = new CommandOutputCollector(logSink);
  try {
    await runner.run(request, signal, (event) => collector.record(event));
    return await collector.complete();
  } catch (error) {
    await collector.dispose();
    throw error;
  }
}

class BoundedCommandStreams {
  readonly #stdout: string[] = [];
  readonly #stderr: string[] = [];
  #remaining: number;
  #truncated = false;

  constructor(maxBytes: number) {
    this.#remaining = maxBytes;
  }

  append(stream: CommandStream, text: string): void {
    if (this.#truncated || text.length === 0) {
      return;
    }
    const prefix = takeUtf8Prefix(text, this.#remaining);
    this.#remaining -= prefix.bytes;
    this.#truncated ||= prefix.truncated;
    if (prefix.text.length > 0) {
      (stream === "stdout" ? this.#stdout : this.#stderr).push(prefix.text);
    }
  }

  snapshot(): CommandOutputSnapshot {
    return {
      stdout: this.#stdout.join(""),
      stderr: this.#stderr.join(""),
      truncated: this.#truncated,
    };
  }
}

interface Utf8Prefix {
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

function takeUtf8Prefix(text: string, maxBytes: number): Utf8Prefix {
  if (text.length === 0) {
    return { text: "", bytes: 0, truncated: false };
  }

  const characters: string[] = [];
  let bytes = 0;
  let consumedCodeUnits = 0;
  for (const character of text) {
    const characterBytes = utf8CodePointBytes(character.codePointAt(0));
    if (bytes + characterBytes > maxBytes) {
      break;
    }
    characters.push(character);
    bytes += characterBytes;
    consumedCodeUnits += character.length;
  }
  return {
    text: characters.join(""),
    bytes,
    truncated: consumedCodeUnits < text.length,
  };
}

function utf8CodePointBytes(codePoint: number | undefined): number {
  if (codePoint === undefined || codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  return codePoint <= 0xffff ? 3 : 4;
}

function isByteLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export class InvalidCommandOutputLimitError extends Error {
  constructor() {
    super("Command output limits must be nonnegative safe integers with context within display.");
    this.name = "InvalidCommandOutputLimitError";
  }
}

export class InvalidCommandOutputSequenceError extends Error {
  constructor() {
    super("Command output must contain exactly one final exit event.");
    this.name = "InvalidCommandOutputSequenceError";
  }
}

export class CommandOutputLogError extends Error {
  constructor(options?: ErrorOptions) {
    super("The optional command output log could not be written.", options);
    this.name = "CommandOutputLogError";
  }
}
