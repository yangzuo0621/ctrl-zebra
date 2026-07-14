import { describe, expect, it } from "vitest";

describe("Vitest workspace configuration", () => {
  it("executes TypeScript tests from workspace packages", () => {
    const packageName: string = "@ctrl-zebra/core";

    expect(packageName).toBe("@ctrl-zebra/core");
  });
});
