import type { JsonValue } from "@ctrl-zebra/protocol";

export const maxToolOutputCharacters = 65_536;
export const maxToolOutputLines = 2_000;
export const maxToolOutputEntries = 500;

export interface LimitedToolOutput {
  readonly output: JsonValue;
  readonly truncated: boolean;
}

export function limitToolOutput(output: JsonValue): LimitedToolOutput {
  if (typeof output === "string") {
    return limitString(output);
  }

  if (isJsonArray(output)) {
    return limitArray(output);
  }

  if (typeof output === "object" && output !== null) {
    return limitObject(output);
  }

  return { output, truncated: false };
}

function isJsonArray(output: JsonValue): output is readonly JsonValue[] {
  return Array.isArray(output);
}

function limitString(output: string): LimitedToolOutput {
  let characters = 0;
  let lines = 1;
  let previousWasCarriageReturn = false;
  let end = 0;

  while (end < output.length && characters < maxToolOutputCharacters) {
    const codePoint = output.codePointAt(end);
    if (codePoint === undefined) {
      break;
    }

    const width = codePoint > 0xffff ? 2 : 1;
    const character = output.slice(end, end + width);
    const beginsNewLine = character === "\r" || (character === "\n" && !previousWasCarriageReturn);
    if (beginsNewLine && lines >= maxToolOutputLines) {
      break;
    }

    characters += 1;
    if (beginsNewLine) {
      lines += 1;
    }
    previousWasCarriageReturn = character === "\r";
    end += width;
  }

  return end === output.length
    ? { output, truncated: false }
    : { output: output.slice(0, end), truncated: true };
}

function limitArray(output: readonly JsonValue[]): LimitedToolOutput {
  const values = output.slice(0, maxToolOutputEntries);
  let truncated = output.length > values.length;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      continue;
    }

    const limited = limitToolOutput(value);
    values[index] = limited.output;
    truncated ||= limited.truncated;
  }

  return truncated ? { output: values, truncated: true } : { output, truncated: false };
}

function limitObject(output: Readonly<Record<string, JsonValue>>): LimitedToolOutput {
  const entries = Object.entries(output);
  const values = entries.slice(0, maxToolOutputEntries);
  let truncated = entries.length > values.length;

  for (let index = 0; index < values.length; index += 1) {
    const entry = values[index];
    if (entry === undefined) {
      continue;
    }

    const limited = limitToolOutput(entry[1]);
    values[index] = [entry[0], limited.output];
    truncated ||= limited.truncated;
  }

  return truncated
    ? { output: Object.fromEntries(values), truncated: true }
    : { output, truncated: false };
}
