import {
  maxWorkspaceEditTextBytes,
  maxWorkspaceEditTextCharacters,
  maxWorkspaceEditTextLines,
} from "@ctrl-zebra/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const vscode = vi.hoisted(() => ({
  fs: {
    stat: vi.fn(),
  },
}));
const localRead = vi.hoisted(() => ({ readLocalFilePrefix: vi.fn() }));

vi.mock("vscode", () => ({
  FileType: { File: 1 },
  Uri: { parse: vi.fn() },
  workspace: { fs: vscode.fs },
}));
vi.mock("./read-local-file-prefix.js", () => localRead);

import {
  assertSupportedWorkspaceDocument,
  assertSupportedWorkspaceText,
  readSupportedWorkspaceText,
  UnsupportedWorkspaceTextError,
} from "./vscode-propose-file-edit-workspace.js";

const fileUri = { scheme: "file", fsPath: "C:/workspace/file.ts" } as never;

describe("supported workspace text validation", () => {
  beforeEach(() => {
    vscode.fs.stat.mockReset();
    localRead.readLocalFilePrefix.mockReset();
  });

  it("accepts bounded valid UTF-8 bytes and the opened document", async () => {
    const bytes = new TextEncoder().encode("zebra\ntext");
    vscode.fs.stat.mockResolvedValue({ type: 1, size: bytes.byteLength });
    localRead.readLocalFilePrefix.mockResolvedValue({ bytes, truncated: false });

    await expect(readSupportedWorkspaceText(fileUri, new AbortController().signal)).resolves.toBe(
      "zebra\ntext",
    );
    await expect(
      assertSupportedWorkspaceText(
        fileUri,
        { getText: () => "zebra\ntext" },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    expect(vscode.fs.stat).toHaveBeenCalledTimes(4);
    expect(localRead.readLocalFilePrefix).toHaveBeenCalledWith(
      "C:/workspace/file.ts",
      262_144,
      expect.any(AbortSignal),
    );
  });

  it.each([
    { uri: { scheme: "untitled" }, reason: "non-file URI" },
    { stat: { type: 2, size: 1 }, reason: "directory target" },
    { stat: { type: 1, size: 262_145 }, reason: "oversized target" },
  ])("rejects an unsupported target before reading bytes ($reason)", async ({ uri, stat }) => {
    if (stat !== undefined) {
      vscode.fs.stat.mockResolvedValue(stat);
    }
    await expect(
      readSupportedWorkspaceText((uri ?? fileUri) as never, new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsupportedWorkspaceTextError);
    expect(localRead.readLocalFilePrefix).not.toHaveBeenCalled();
  });

  it.each([
    { bytes: Uint8Array.from([0xc3, 0x28]), reason: "malformed UTF-8" },
    { bytes: new TextEncoder().encode("a\0b"), reason: "NUL" },
    {
      bytes: new TextEncoder().encode(Array.from({ length: 2_001 }, () => "x").join("\n")),
      reason: "line bound",
    },
  ])("rejects unsupported raw text ($reason)", async ({ bytes }) => {
    vscode.fs.stat.mockResolvedValue({ type: 1, size: bytes.byteLength });
    localRead.readLocalFilePrefix.mockResolvedValue({ bytes, truncated: false });

    await expect(
      readSupportedWorkspaceText(fileUri, new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsupportedWorkspaceTextError);
  });

  it("rejects a file that grows beyond the prefix cap after stat", async () => {
    const bytes = new Uint8Array(262_144);
    vscode.fs.stat.mockResolvedValue({ type: 1, size: bytes.byteLength });
    localRead.readLocalFilePrefix.mockResolvedValue({ bytes, truncated: true });

    await expect(
      readSupportedWorkspaceText(fileUri, new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsupportedWorkspaceTextError);
  });

  it.each([
    {
      name: "scalar limit",
      text: "x".repeat(maxWorkspaceEditTextCharacters),
    },
    {
      name: "line limit",
      text: Array.from({ length: maxWorkspaceEditTextLines }, () => "x").join("\n"),
    },
    {
      name: "byte limit",
      text: "😀".repeat(maxWorkspaceEditTextBytes / 4),
    },
  ])("accepts text at the exact $name", async ({ text }) => {
    const bytes = new TextEncoder().encode(text);
    vscode.fs.stat.mockResolvedValue({ type: 1, size: bytes.byteLength });
    localRead.readLocalFilePrefix.mockResolvedValue({ bytes, truncated: false });

    await expect(readSupportedWorkspaceText(fileUri, new AbortController().signal)).resolves.toBe(
      text,
    );
  });

  it("rejects a file that grows between the bounded read and the post-read stat", async () => {
    const bytes = new TextEncoder().encode("bounded");
    vscode.fs.stat
      .mockResolvedValueOnce({ type: 1, size: bytes.byteLength, ctime: 1, mtime: 1 })
      .mockResolvedValueOnce({ type: 1, size: bytes.byteLength + 1, ctime: 1, mtime: 2 });
    localRead.readLocalFilePrefix.mockResolvedValue({ bytes, truncated: false });

    await expect(
      readSupportedWorkspaceText(fileUri, new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsupportedWorkspaceTextError);
  });

  it("rejects a short bounded read instead of constructing a partial file", async () => {
    const bytes = new TextEncoder().encode("short");
    vscode.fs.stat.mockResolvedValue({ type: 1, size: bytes.byteLength + 1 });
    localRead.readLocalFilePrefix.mockResolvedValue({ bytes, truncated: false });

    await expect(
      readSupportedWorkspaceText(fileUri, new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsupportedWorkspaceTextError);
    expect(vscode.fs.stat).toHaveBeenCalledOnce();
  });

  it("rejects a replacement race with unchanged size but changed file identity metadata", async () => {
    const bytes = new TextEncoder().encode("bounded");
    vscode.fs.stat
      .mockResolvedValueOnce({ type: 1, size: bytes.byteLength, ctime: 1, mtime: 1 })
      .mockResolvedValueOnce({ type: 1, size: bytes.byteLength, ctime: 2, mtime: 2 });
    localRead.readLocalFilePrefix.mockResolvedValue({ bytes, truncated: false });

    await expect(
      readSupportedWorkspaceText(fileUri, new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsupportedWorkspaceTextError);
  });

  it("maps stat and bounded-read failures to unsupported text", async () => {
    vscode.fs.stat.mockRejectedValueOnce(new Error("stat failed"));
    await expect(
      readSupportedWorkspaceText(fileUri, new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsupportedWorkspaceTextError);

    vscode.fs.stat.mockResolvedValueOnce({ type: 1, size: 1 });
    localRead.readLocalFilePrefix.mockRejectedValueOnce(new Error("read failed"));
    await expect(
      readSupportedWorkspaceText(fileUri, new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsupportedWorkspaceTextError);
  });

  it("rejects an opened document whose text is outside the shared bound", () => {
    expect(() => assertSupportedWorkspaceDocument({ getText: () => "a\0b" }, "a\0b")).toThrow(
      UnsupportedWorkspaceTextError,
    );
  });

  it("preserves cancellation while reading the target", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel validation");
    controller.abort(cancellation);

    await expect(readSupportedWorkspaceText(fileUri, controller.signal)).rejects.toBe(cancellation);
    expect(vscode.fs.stat).not.toHaveBeenCalled();
  });

  it("preserves cancellation after a bounded read", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel after read");
    const bytes = new TextEncoder().encode("bounded");
    vscode.fs.stat.mockResolvedValue({ type: 1, size: bytes.byteLength });
    localRead.readLocalFilePrefix.mockImplementation(async () => {
      controller.abort(cancellation);
      return { bytes, truncated: false };
    });

    await expect(readSupportedWorkspaceText(fileUri, controller.signal)).rejects.toBe(cancellation);
    expect(vscode.fs.stat).toHaveBeenCalledOnce();
  });
});
