import { describe, expect, it } from "vitest";

import {
  limitToolOutput,
  maxToolOutputCharacters,
  maxToolOutputEntries,
  maxToolOutputLines,
} from "./tool-output-limiter.js";

describe("Tool Output Limiter", () => {
  it("counts Unicode code points without splitting a surrogate pair", () => {
    const exact = "😀".repeat(maxToolOutputCharacters);

    expect(limitToolOutput(exact)).toEqual({ output: exact, truncated: false });
    expect(limitToolOutput(`${exact}x`)).toEqual({ output: exact, truncated: true });
  });

  it.each(["\n", "\r", "\r\n"])("limits lines separated by %j", (separator) => {
    const exact = Array.from({ length: maxToolOutputLines }, () => "line").join(separator);

    expect(limitToolOutput(exact)).toEqual({ output: exact, truncated: false });
    expect(limitToolOutput(`${exact}${separator}extra`)).toEqual({
      output: exact,
      truncated: true,
    });
  });

  it("limits array entries to a deterministic prefix", () => {
    const output = Array.from({ length: maxToolOutputEntries + 1 }, (_, index) => index);

    expect(limitToolOutput(output)).toEqual({
      output: output.slice(0, maxToolOutputEntries),
      truncated: true,
    });
  });

  it("limits object entries to insertion order", () => {
    const output = Object.fromEntries(
      Array.from({ length: maxToolOutputEntries + 1 }, (_, index) => [`key-${index}`, index]),
    );
    const limited = limitToolOutput(output);

    expect(limited).toEqual({
      output: Object.fromEntries(Object.entries(output).slice(0, maxToolOutputEntries)),
      truncated: true,
    });
  });

  it("propagates nested string and collection truncation", () => {
    const limited = limitToolOutput({
      content: `${"x".repeat(maxToolOutputCharacters)}tail`,
      entries: Array.from({ length: maxToolOutputEntries + 1 }, () => null),
    });

    expect(limited).toEqual({
      output: {
        content: "x".repeat(maxToolOutputCharacters),
        entries: Array.from({ length: maxToolOutputEntries }, () => null),
      },
      truncated: true,
    });
  });

  it.each([null, true, false, 0, 12.5])("preserves an unlimited scalar: %s", (output) => {
    expect(limitToolOutput(output)).toEqual({ output, truncated: false });
  });
});
