import type { JsonValue } from "@ctrl-zebra/protocol";

export function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => {
      const other = right[index];
      return other !== undefined && jsonValuesEqual(value, other);
    });
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftObject = left as { readonly [key: string]: JsonValue };
    const rightObject = right as { readonly [key: string]: JsonValue };
    const leftKeys = Object.keys(leftObject).sort();
    const rightKeys = Object.keys(rightObject).sort();
    if (
      leftKeys.length !== rightKeys.length ||
      leftKeys.some((key, index) => key !== rightKeys[index])
    ) {
      return false;
    }
    return leftKeys.every((key) => jsonValuesEqual(leftObject[key], rightObject[key]));
  }
  return false;
}
