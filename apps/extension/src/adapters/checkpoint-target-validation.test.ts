import { describe, expect, it, vi } from "vitest";

import { createTestUri } from "../test/support/test-uri.js";
import { validateCheckpointTarget } from "./checkpoint-target-validation.js";
import { WorkspaceScopeError } from "./workspace-scope.js";

describe("validateCheckpointTarget", () => {
  it("rejects an out-of-scope persisted URI before probing the host", async () => {
    const requested = createTestUri({ path: "/workspace-other/secret.txt" });
    const validateNewFile = vi.fn(async () => {
      throw new WorkspaceScopeError("outside-workspace");
    });
    const validate = vi.fn(async () => requested);
    const stat = vi.fn(async () => undefined);

    await expect(
      validateCheckpointTarget(
        { validate, validateNewFile },
        requested,
        new AbortController().signal,
        stat,
        () => false,
      ),
    ).rejects.toEqual(new WorkspaceScopeError("outside-workspace"));
    expect(validateNewFile).toHaveBeenCalledOnce();
    expect(validate).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });

  it("returns the canonical existing target only after scoped validation", async () => {
    const requested = createTestUri({ path: "/workspace/new.txt" });
    const canonical = createTestUri({ path: "/workspace/new.txt" });
    const validateNewFile = vi.fn(async () => canonical);
    const validate = vi.fn(async () => canonical);
    const stat = vi.fn(async () => ({ type: 1 }));

    await expect(
      validateCheckpointTarget(
        { validate, validateNewFile },
        requested,
        new AbortController().signal,
        stat,
        () => false,
      ),
    ).resolves.toBe(canonical);
    expect(stat).toHaveBeenCalledWith(canonical);
    expect(validate).toHaveBeenCalledWith(requested, expect.any(AbortSignal));
  });

  it("returns the scoped candidate for an absent target", async () => {
    const requested = createTestUri({ path: "/workspace/new.txt" });
    const canonical = createTestUri({ path: "/workspace/new.txt" });
    const validateNewFile = vi.fn(async () => canonical);
    const validate = vi.fn(async () => canonical);
    const missing = new Error("missing target");
    const stat = vi.fn(async () => {
      throw missing;
    });

    await expect(
      validateCheckpointTarget(
        { validate, validateNewFile },
        requested,
        new AbortController().signal,
        stat,
        (error) => error === missing,
      ),
    ).resolves.toBe(canonical);
    expect(validate).not.toHaveBeenCalled();
  });
});
