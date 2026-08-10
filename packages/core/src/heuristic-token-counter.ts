import type { JsonValue } from "@ctrl-zebra/protocol";

import type { ModelMessageTokenCounter } from "./history-pruner.js";
import type { ModelMessage } from "./model-gateway.js";
import { maxModelContextWindowTokens } from "./token-budget.js";

/** The conservative byte-to-token ratio used when no vendor tokenizer is injected. */
export const heuristicBytesPerToken = 4;

/** A small framing allowance for the role and message envelope. */
export const heuristicMessageOverheadTokens = 4;

/**
 * The counter never serializes more than one model context window. A value at the
 * limit is reported as the maximum valid estimate so callers can reject or prune
 * it without retaining an unbounded serialized representation.
 */
export const maxHeuristicSerializedBytes =
  (maxModelContextWindowTokens - heuristicMessageOverheadTokens) * heuristicBytesPerToken;

export class HeuristicModelMessageTokenCounter implements ModelMessageTokenCounter {
  count(message: ModelMessage): number {
    const measurement = measureModelMessage(message, maxHeuristicSerializedBytes);
    if (measurement.truncated) {
      return maxModelContextWindowTokens;
    }

    return Math.ceil(measurement.bytes / heuristicBytesPerToken) + heuristicMessageOverheadTokens;
  }
}

export const defaultModelMessageTokenCounter: ModelMessageTokenCounter =
  new HeuristicModelMessageTokenCounter();

interface ByteMeasurement {
  readonly bytes: number;
  readonly truncated: boolean;
}

/**
 * Count the stable JSON representation without building an unbounded string.
 * Object keys are sorted so equivalent Tool JSON has one estimate regardless of
 * insertion order. Model messages are validated before they reach this counter,
 * but the cycle and depth guards keep the public counter bounded for injected data.
 */
function measureModelMessage(message: ModelMessage, maximumBytes: number): ByteMeasurement {
  const writer = new BoundedUtf8Counter(maximumBytes);
  const ancestors = new Set<object>();

  writer.append("{");
  writer.appendJsonString("role");
  writer.append(":");
  writer.appendJsonString(message.role);

  if ("content" in message) {
    writer.append(",");
    writer.appendJsonString("content");
    writer.append(":");
    writeJsonValue(message.content, writer, ancestors, 0);
  } else if ("toolCall" in message) {
    writer.append(",");
    writer.appendJsonString("toolCall");
    writer.append(":");
    writeJsonValue(message.toolCall, writer, ancestors, 0);
  } else {
    writer.append(",");
    writer.appendJsonString("result");
    writer.append(":");
    writeJsonValue(message.result, writer, ancestors, 0);
  }

  writer.append("}");
  return writer.measurement;
}

const maxSerializationDepth = 128;

function writeJsonValue(
  value: JsonValue,
  writer: BoundedUtf8Counter,
  ancestors: Set<object>,
  depth: number,
): void {
  if (writer.truncated) {
    return;
  }
  if (depth > maxSerializationDepth) {
    writer.truncate();
    return;
  }

  if (value === null) {
    writer.append("null");
    return;
  }
  if (typeof value === "string") {
    writer.appendJsonString(value);
    return;
  }
  if (typeof value === "boolean") {
    writer.append(value ? "true" : "false");
    return;
  }
  if (typeof value === "number") {
    writer.append(JSON.stringify(value) ?? "null");
    return;
  }

  if (ancestors.has(value)) {
    writer.truncate();
    return;
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      writer.append("[");
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) {
          writer.append(",");
        }
        const item = value[index];
        if (item === undefined) {
          writer.truncate();
          return;
        }
        writeJsonValue(item, writer, ancestors, depth + 1);
        if (writer.truncated) {
          return;
        }
      }
      writer.append("]");
      return;
    }

    writer.append("{");
    const objectValue = value as { readonly [key: string]: JsonValue };
    const keys = Object.keys(objectValue).sort();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === undefined) {
        writer.truncate();
        return;
      }
      if (index > 0) {
        writer.append(",");
      }
      writer.appendJsonString(key);
      writer.append(":");
      const property = objectValue[key];
      if (property === undefined) {
        writer.truncate();
        return;
      }
      writeJsonValue(property, writer, ancestors, depth + 1);
      if (writer.truncated) {
        return;
      }
    }
    writer.append("}");
  } finally {
    ancestors.delete(value);
  }
}

class BoundedUtf8Counter {
  #bytes = 0;
  #truncated = false;

  constructor(readonly maximumBytes: number) {}

  get truncated(): boolean {
    return this.#truncated;
  }

  get measurement(): ByteMeasurement {
    return { bytes: this.#bytes, truncated: this.#truncated };
  }

  append(value: string): void {
    if (this.#truncated) {
      return;
    }
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0;
      const bytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
      this.#add(bytes);
      if (this.#truncated) {
        return;
      }
    }
  }

  appendJsonString(value: string): void {
    if (this.#truncated) {
      return;
    }
    this.append('"');
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit === 0x22) {
        this.append('\\"');
      } else if (codeUnit === 0x5c) {
        this.append("\\\\");
      } else if (codeUnit === 0x08) {
        this.append("\\b");
      } else if (codeUnit === 0x0c) {
        this.append("\\f");
      } else if (codeUnit === 0x0a) {
        this.append("\\n");
      } else if (codeUnit === 0x0d) {
        this.append("\\r");
      } else if (codeUnit === 0x09) {
        this.append("\\t");
      } else if (codeUnit < 0x20 || isLoneSurrogate(value, index)) {
        this.append(`\\u${codeUnit.toString(16).padStart(4, "0")}`);
      } else {
        const codePoint = value.codePointAt(index) ?? 0;
        const character = String.fromCodePoint(codePoint);
        this.append(character);
        if (codePoint > 0xffff) {
          index += 1;
        }
      }
      if (this.#truncated) {
        return;
      }
    }
    this.append('"');
  }

  truncate(): void {
    this.#truncated = true;
    this.#bytes = this.maximumBytes;
  }

  #add(bytes: number): void {
    if (this.#bytes > this.maximumBytes - bytes) {
      this.truncate();
      return;
    }
    this.#bytes += bytes;
  }
}

function isLoneSurrogate(value: string, index: number): boolean {
  const codeUnit = value.charCodeAt(index);
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    return !(next >= 0xdc00 && next <= 0xdfff);
  }
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
