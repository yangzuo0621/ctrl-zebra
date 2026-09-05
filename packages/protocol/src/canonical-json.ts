import type { JsonValue } from "./tool.js";

export class CircularJsonValueError extends Error {
  constructor() {
    super("Cannot canonicalize a circular JSON value.");
    this.name = "CircularJsonValueError";
  }
}

/**
 * Serializes a JSON value with object keys sorted at every level, so two values with the same
 * shape produce the same string regardless of key insertion order. Array order is preserved
 * (arrays are ordered by definition). Matches `JSON.stringify`'s own handling of `undefined` --
 * dropped from an object's own keys, encoded as `null` inside an array -- so this only diverges
 * from `JSON.stringify` in key ordering, not in what values it can represent. Cyclic input throws
 * `CircularJsonValueError` rather than recursing until the call stack overflows.
 */
export function canonicalizeJson(value: JsonValue): string {
  return canonicalizeJsonValue(value, new Set());
}

function canonicalizeJsonValue(value: JsonValue, ancestors: Set<object>): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (ancestors.has(value)) {
    throw new CircularJsonValueError();
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => (item === undefined ? "null" : canonicalizeJsonValue(item, ancestors))).join(",")}]`;
    }

    const objectValue = value as { readonly [key: string]: JsonValue };
    const entries = Object.keys(objectValue)
      .filter((key) => objectValue[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJsonValue(objectValue[key], ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
