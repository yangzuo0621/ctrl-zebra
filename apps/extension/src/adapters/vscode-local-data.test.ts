import { describe, expect, it, vi } from "vitest";

import {
  clearConfigurationEntries,
  clearCtrlZebraConfiguration,
  clearMemento,
  clearProviderSecrets,
  ctrlZebraConfigurationEntries,
} from "./vscode-local-data.js";

describe("VS Code local-data adapters", () => {
  it("deletes every owned Provider Secret and reports a SecretStorage failure", async () => {
    const storages = {
      openai: { delete: vi.fn(async () => {}) },
      gemini: {
        delete: vi.fn(async () => {
          throw new Error("secret unavailable");
        }),
      },
      "openai-compatible": { delete: vi.fn(async () => {}) },
    };

    await expect(clearProviderSecrets(storages)).resolves.toEqual({ deleted: 2, failed: 1 });
    expect(storages.openai.delete).toHaveBeenCalledOnce();
    expect(storages.gemini.delete).toHaveBeenCalledOnce();
    expect(storages["openai-compatible"].delete).toHaveBeenCalledOnce();
  });

  it("clears all owned configuration scopes and continues after a partial update failure", async () => {
    const updates: unknown[][] = [];
    const configuration = {
      inspect: vi.fn(() => ({ globalValue: true, workspaceValue: "workspace" })),
      update: vi.fn(async (...args: unknown[]) => {
        updates.push(args);
        if (args[2] === 2) throw new Error("workspace settings unavailable");
      }),
    };
    const reader = {
      getConfiguration: vi.fn(() => configuration),
    };

    await expect(clearCtrlZebraConfiguration(reader)).resolves.toEqual({
      deleted: ctrlZebraConfigurationEntries.length,
      failed: ctrlZebraConfigurationEntries.length,
    });
    expect(updates).toHaveLength(ctrlZebraConfigurationEntries.length * 2);
  });

  it("clears memento keys and retains failures for a retry", async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("memento unavailable"));
    const memento = { keys: () => ["first", "second"] as const, update };

    await expect(clearMemento(memento)).resolves.toEqual({ deleted: 1, failed: 1 });
    expect(update).toHaveBeenNthCalledWith(1, "first", undefined);
    expect(update).toHaveBeenNthCalledWith(2, "second", undefined);
  });

  it("keeps the configuration helper available for a category-scoped retry", async () => {
    const update = vi.fn(async () => {});
    const reader = {
      getConfiguration: () => ({
        inspect: () => ({ globalValue: "owned" }),
        update,
      }),
    };

    await expect(
      clearConfigurationEntries(reader, [{ section: "ctrlZebra.provider", name: "model" }]),
    ).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(update).toHaveBeenCalledWith("model", undefined, 1);
  });

  it("clears language-specific owned configuration values", async () => {
    const update = vi.fn(async () => {});
    const reader = {
      getConfiguration: (_section: string, scope?: { readonly languageId: string }) => ({
        inspect: () =>
          scope === undefined ? { languageIds: ["typescript"] } : { globalLanguageValue: true },
        update,
      }),
    };

    await expect(
      clearConfigurationEntries(reader, [{ section: "ctrlZebra.editorContext", name: "enabled" }]),
    ).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(update).toHaveBeenCalledWith("enabled", undefined, 1, true);
  });
});
