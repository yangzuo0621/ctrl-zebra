import type { PreparedToolApproval, TextEditPlan } from "@ctrl-zebra/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestUri as uri } from "../test/support/test-uri.js";
import { WorkspaceEditConflictError } from "./workspace-edit-applier.js";

const vscode = vi.hoisted(() => ({
  Uri: { parse: vi.fn() },
  workspace: { fs: { stat: vi.fn() } },
}));
const fileSystemErrors = vi.hoisted(() => ({ isVscodeFileNotFound: vi.fn() }));
const boundedRead = vi.hoisted(() => {
  class UnsupportedWorkspaceTextError extends Error {}
  return { readSupportedWorkspaceText: vi.fn(), UnsupportedWorkspaceTextError };
});
const diff = vi.hoisted(() => ({
  presenter: {
    present: vi.fn(async () => undefined),
    presentTextPair: vi.fn(async () => undefined),
    dispose: vi.fn(),
  },
  create: vi.fn(),
}));
const appliers = vi.hoisted(() => ({
  workspaceEdit: vi.fn(),
  fileCreate: vi.fn(),
  fileDelete: vi.fn(),
  fileRename: vi.fn(),
}));

vi.mock("vscode", () => vscode);
vi.mock("./vscode-file-system-error.js", () => fileSystemErrors);
vi.mock("./vscode-propose-file-edit-workspace.js", () => boundedRead);
vi.mock("./create-vscode-diff-presenter.js", () => ({
  createVsCodeDiffPresenter: diff.create,
}));
vi.mock("./create-vscode-workspace-edit-applier.js", () => ({
  createVsCodeWorkspaceEditApplier: appliers.workspaceEdit,
}));
vi.mock("./create-vscode-file-create-applier.js", () => ({
  createVsCodeFileCreateApplier: appliers.fileCreate,
}));
vi.mock("./create-vscode-file-delete-applier.js", () => ({
  createVsCodeFileDeleteApplier: appliers.fileDelete,
}));
vi.mock("./create-vscode-file-rename-applier.js", () => ({
  createVsCodeFileRenameApplier: appliers.fileRename,
}));

import { createVsCodeFileMutationApprovalWorkflows } from "./create-vscode-file-mutation-approval-workflows.js";

const root = uri("/workspace");
const target = uri("/workspace/src/file.ts");
const plan = {
  uri: target.toString(),
  originalRevision: { kind: "document_version", value: 3 },
  edits: [
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      newText: "zebra",
    },
  ],
} satisfies TextEditPlan;
const prepared = {
  sessionId: "session-1",
  runId: "run-1",
  call: {
    id: "call-1",
    name: "propose_file_edit",
    input: { path: "src/file.ts", edits: [] },
  },
  risk: "write",
  prepared: { output: plan, truncated: false },
} satisfies PreparedToolApproval;
const lifecyclePlans = {
  workspaceEdit: {
    operation: "edit",
    files: [
      {
        path: "src/file.ts",
        uri: target.toString(),
        originalRevision: { kind: "document_version", value: 3 },
        edits: plan.edits,
      },
      {
        path: "src/other.ts",
        uri: "file:///workspace/src/other.ts",
        originalRevision: { kind: "document_version", value: 1 },
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            newText: "other",
          },
        ],
      },
    ],
  },
  create: {
    operation: "create",
    path: "new.txt",
    uri: "file:///workspace/new.txt",
    content: "zebra\n",
    afterHash: "a".repeat(64),
  },
  delete: {
    operation: "delete",
    path: "old.txt",
    uri: "file:///workspace/old.txt",
    beforeContent: "zebra\n",
    beforeHash: "a".repeat(64),
  },
  rename: {
    operation: "rename",
    sourcePath: "old.txt",
    targetPath: "new.txt",
    sourceUri: "file:///workspace/old.txt",
    targetUri: "file:///workspace/new.txt",
    beforeContent: "zebra\n",
    beforeHash: "a".repeat(64),
  },
} as const;

describe("createVsCodeFileMutationApprovalWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscode.Uri.parse.mockImplementation((value: string) => uri(value.slice("file://".length)));
    vscode.workspace.fs.stat.mockRejectedValue(new Error("not found"));
    fileSystemErrors.isVscodeFileNotFound.mockReturnValue(true);
    boundedRead.readSupportedWorkspaceText.mockResolvedValue("zebra\n");
    diff.create.mockReturnValue(diff.presenter);
  });

  it("keeps activation lazy and transfers durable apply wiring to the workflow", async () => {
    const checkpointStore = { create: vi.fn(async () => undefined) };
    const selectCheckpointStore = vi.fn(async () => checkpointStore);
    const apply = vi.fn(async (_plan, _ownership, signal: AbortSignal) => {
      const createCheckpoint = appliers.workspaceEdit.mock.calls.at(-1)?.[1] as (
        checkpoint: never,
        signal: AbortSignal,
      ) => Promise<void>;
      await createCheckpoint({} as never, signal);
    });
    appliers.workspaceEdit.mockImplementation(() => ({ apply }));
    let nextId = 0;
    const composition = createVsCodeFileMutationApprovalWorkflows({
      getSelectedRoot: () => root,
      canonicalize: async (value) => value,
      selectCheckpointStore: selectCheckpointStore as never,
      hashText: (text) => text,
      createId: () => `id-${++nextId}`,
      now: () => new Date("2026-09-02T00:00:00.000Z"),
      reportError: vi.fn(),
      workspaceTrust: { isTrusted: () => true, requireTrusted() {} },
    });

    expect(composition.diffPresenter).toBe(diff.presenter);
    expect(selectCheckpointStore).not.toHaveBeenCalled();
    expect(appliers.workspaceEdit).not.toHaveBeenCalled();
    const operation = await composition.fileEdits.create(prepared, new AbortController().signal);
    const decision = operation.requestDecision(new AbortController().signal);
    composition.fileEdits.showDiff(operation.request.id);
    await vi.waitFor(() =>
      expect(diff.presenter.present).toHaveBeenCalledWith(plan, expect.any(AbortSignal)),
    );
    expect(selectCheckpointStore).not.toHaveBeenCalled();

    composition.fileEdits.decide(operation.request.id, "approved");
    await decision;
    await expect(operation.consume(new AbortController().signal)).resolves.toEqual({
      outcome: "approved",
    });
    expect(selectCheckpointStore).toHaveBeenCalledOnce();
    expect(checkpointStore.create).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(
      plan,
      { sessionId: "session-1", runId: "run-1" },
      expect.any(AbortSignal),
    );
  });

  it("preserves conflict mapping at the feature composition boundary", async () => {
    appliers.workspaceEdit.mockReturnValue({
      apply: vi.fn(async () => {
        throw new WorkspaceEditConflictError();
      }),
    });
    const composition = createVsCodeFileMutationApprovalWorkflows({
      getSelectedRoot: () => root,
      canonicalize: async (value) => value,
      selectCheckpointStore: async () => ({ create: vi.fn() }) as never,
      hashText: (text) => text,
      createId: () => "approval-1",
      now: () => new Date("2026-09-02T00:00:00.000Z"),
      reportError: vi.fn(),
      workspaceTrust: { isTrusted: () => true, requireTrusted() {} },
    });
    const operation = await composition.fileEdits.create(prepared, new AbortController().signal);
    const decision = operation.requestDecision(new AbortController().signal);
    composition.fileEdits.decide(operation.request.id, "approved");
    await decision;

    await expect(operation.consume(new AbortController().signal)).resolves.toEqual({
      outcome: "conflict",
      message: "The approved file changed before its edits could be applied.",
    });
  });

  it("wires each lifecycle mutation through one lazy feature boundary", async () => {
    for (const factory of Object.values(appliers)) {
      factory.mockReturnValue({ apply: vi.fn(async () => undefined) });
    }
    let nextId = 0;
    const composition = createVsCodeFileMutationApprovalWorkflows({
      getSelectedRoot: () => root,
      canonicalize: async (value) => value,
      selectCheckpointStore: async () => ({ create: vi.fn() }) as never,
      hashText: () => "a".repeat(64),
      createId: () => `approval-${++nextId}`,
      now: () => new Date("2026-09-02T00:00:00.000Z"),
      reportError: vi.fn(),
      workspaceTrust: { isTrusted: () => true, requireTrusted() {} },
    });
    const cases = [
      {
        workflow: composition.workspaceEdits,
        name: "propose_workspace_edit",
        plan: lifecyclePlans.workspaceEdit,
      },
      {
        workflow: composition.fileCreates,
        name: "propose_file_create",
        plan: lifecyclePlans.create,
      },
      {
        workflow: composition.fileDeletes,
        name: "propose_file_delete",
        plan: lifecyclePlans.delete,
      },
      {
        workflow: composition.fileRenames,
        name: "propose_file_rename",
        plan: lifecyclePlans.rename,
      },
    ] as const;

    for (const candidate of cases) {
      const operation = await candidate.workflow.create(
        {
          sessionId: "session-1",
          runId: "run-1",
          call: { id: `call-${candidate.name}`, name: candidate.name, input: {} },
          risk: "write",
          prepared: { output: candidate.plan, truncated: false },
        },
        new AbortController().signal,
      );
      const decision = operation.requestDecision(new AbortController().signal);
      candidate.workflow.showDiff(operation.request.id);
      candidate.workflow.decide(operation.request.id, "approved");
      await decision;
      await expect(operation.consume(new AbortController().signal)).resolves.toMatchObject({
        outcome: "applied",
      });
    }

    await vi.waitFor(() => expect(diff.presenter.presentTextPair).toHaveBeenCalled());
    expect(appliers.workspaceEdit).toHaveBeenCalled();
    expect(appliers.fileCreate).toHaveBeenCalledOnce();
    expect(appliers.fileDelete).toHaveBeenCalledOnce();
    expect(appliers.fileRename).toHaveBeenCalledOnce();
  });
});
