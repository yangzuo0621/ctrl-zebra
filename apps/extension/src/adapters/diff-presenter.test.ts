import type { TextEditPlan } from "@ctrl-zebra/core";
import { describe, expect, it, vi } from "vitest";

import {
  DiffPresenter,
  type DiffPresenterDependencies,
  DiffPresenterDisposedError,
  type DiffResource,
  DiffSourceChangedError,
  InvalidDiffEditRangeError,
} from "./diff-presenter.js";

const sourceUri = resource("file:///workspace/example.ts");
const plan = {
  uri: sourceUri.toString(),
  originalRevision: { kind: "document_version", value: 7 },
  edits: [
    {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
      newText: "TWO",
    },
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      newText: "ONE",
    },
  ],
} satisfies TextEditPlan;

describe("DiffPresenter", () => {
  it("opens an immutable before/after diff for the exact source revision", async () => {
    const dependencies = createDependencies();
    const presenter = new DiffPresenter(dependencies.values);
    const signal = new AbortController().signal;

    await presenter.present(plan, signal);

    expect(dependencies.openSourceDocument).toHaveBeenCalledWith(plan.uri, signal);
    expect(dependencies.showDiff).toHaveBeenCalledOnce();
    const [before, after, title] = requireCall(dependencies.showDiff.mock.calls[0]);
    expect(dependencies.provider?.provideTextDocumentContent(before)).toBe("one\r\ntwo\nthree");
    expect(dependencies.provider?.provideTextDocumentContent(after)).toBe("ONE\r\nTWO\nthree");
    expect(title).toBe("CtrlZebra: example.ts (Proposed Changes)");
  });

  it("accepts an exact SHA-256 source revision", async () => {
    const dependencies = createDependencies();
    const presenter = new DiffPresenter(dependencies.values);

    await expect(
      presenter.present(
        {
          ...plan,
          originalRevision: { kind: "content_hash", algorithm: "sha256", value: "hash" },
        },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    expect(dependencies.hashText).toHaveBeenCalledWith("one\r\ntwo\nthree");
  });

  it.each([
    { ...plan, originalRevision: { kind: "document_version", value: 8 } as const },
    {
      ...plan,
      originalRevision: {
        kind: "content_hash",
        algorithm: "sha256",
        value: "a".repeat(64),
      } as const,
    },
    { ...plan, uri: "file:///workspace/other.ts" },
  ])("rejects a changed source without opening a Diff %#", async (changedPlan) => {
    const dependencies = createDependencies();
    const presenter = new DiffPresenter(dependencies.values);

    await expect(
      presenter.present(changedPlan, new AbortController().signal),
    ).rejects.toBeInstanceOf(DiffSourceChangedError);
    expect(dependencies.showDiff).not.toHaveBeenCalled();
  });

  it("rejects a range outside the source snapshot", async () => {
    const dependencies = createDependencies();
    const presenter = new DiffPresenter(dependencies.values);

    await expect(
      presenter.present(
        {
          ...plan,
          edits: [
            {
              range: { start: { line: 1, character: 0 }, end: { line: 9, character: 0 } },
              newText: "outside",
            },
          ],
        },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(InvalidDiffEditRangeError);
    expect(dependencies.showDiff).not.toHaveBeenCalled();
  });

  it("releases virtual content when the Diff command fails or a document closes", async () => {
    const commandError = new Error("vscode.diff failed");
    const dependencies = createDependencies({ showDiffError: commandError });
    const presenter = new DiffPresenter(dependencies.values);

    await expect(presenter.present(plan, new AbortController().signal)).rejects.toBe(commandError);
    const [failedBefore, failedAfter] = requireCall(dependencies.showDiff.mock.calls[0]);
    expect(dependencies.provider?.provideTextDocumentContent(failedBefore)).toBeUndefined();
    expect(dependencies.provider?.provideTextDocumentContent(failedAfter)).toBeUndefined();

    dependencies.showDiff.mockResolvedValue(undefined);
    await presenter.present(plan, new AbortController().signal);
    const [before] = requireCall(dependencies.showDiff.mock.calls[1]);
    dependencies.closeListener?.(before);
    expect(dependencies.provider?.provideTextDocumentContent(before)).toBeUndefined();
  });

  it("forwards cancellation before opening a Diff", async () => {
    const dependencies = createDependencies();
    const presenter = new DiffPresenter(dependencies.values);
    const controller = new AbortController();
    const cancellation = new Error("cancel diff");
    controller.abort(cancellation);

    await expect(presenter.present(plan, controller.signal)).rejects.toBe(cancellation);
    expect(dependencies.openSourceDocument).not.toHaveBeenCalled();
    expect(dependencies.showDiff).not.toHaveBeenCalled();
  });

  it("disposes both registrations and all content exactly once", async () => {
    const dependencies = createDependencies();
    const presenter = new DiffPresenter(dependencies.values);
    await presenter.present(plan, new AbortController().signal);
    const [before] = requireCall(dependencies.showDiff.mock.calls[0]);

    presenter.dispose();
    presenter.dispose();

    expect(dependencies.disposeProvider).toHaveBeenCalledOnce();
    expect(dependencies.disposeCloseListener).toHaveBeenCalledOnce();
    expect(dependencies.provider?.provideTextDocumentContent(before)).toBeUndefined();
    await expect(presenter.present(plan, new AbortController().signal)).rejects.toBeInstanceOf(
      DiffPresenterDisposedError,
    );
  });
});

function createDependencies(options: { readonly showDiffError?: Error } = {}) {
  let provider: Parameters<DiffPresenterDependencies["registerContentProvider"]>[0] | undefined;
  let closeListener: Parameters<DiffPresenterDependencies["onDidCloseDocument"]>[0] | undefined;
  const disposeProvider = vi.fn();
  const disposeCloseListener = vi.fn();
  const openSourceDocument = vi.fn<DiffPresenterDependencies["openSourceDocument"]>(async () => ({
    uri: sourceUri,
    version: 7,
    text: "one\r\ntwo\nthree",
    label: "example.ts",
  }));
  const showDiff = vi.fn<DiffPresenterDependencies["showDiff"]>(async () => {
    if (options.showDiffError !== undefined) {
      throw options.showDiffError;
    }
  });
  const hashText = vi.fn<DiffPresenterDependencies["hashText"]>(() => "hash");

  const result = {
    values: {
      openSourceDocument,
      createVirtualUri: (id, side, label) => resource(`ctrlzebra-diff:/${id}/${side}/${label}`),
      registerContentProvider(value) {
        provider = value;
        return { dispose: disposeProvider };
      },
      onDidCloseDocument(listener) {
        closeListener = listener;
        return { dispose: disposeCloseListener };
      },
      showDiff,
      hashText,
      nextId: vi.fn(() => "diff-1"),
    } satisfies DiffPresenterDependencies,
    openSourceDocument,
    showDiff,
    hashText,
    disposeProvider,
    disposeCloseListener,
    get provider() {
      return provider;
    },
    get closeListener() {
      return closeListener;
    },
  };
  return result;
}

function resource(value: string): DiffResource {
  return { toString: () => value };
}

function requireCall(
  call: readonly [DiffResource, DiffResource, string] | undefined,
): readonly [DiffResource, DiffResource, string] {
  if (call === undefined) {
    throw new Error("Expected the Diff command to be called.");
  }
  return call;
}
