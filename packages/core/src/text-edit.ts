import {
  type ApprovalResourceRevision,
  approvalResourceRevisionSchema,
  maxApprovalUriCharacters,
} from "@ctrl-zebra/protocol";

export interface TextPosition {
  readonly line: number;
  readonly character: number;
}

export interface TextRange {
  readonly start: TextPosition;
  readonly end: TextPosition;
}

export interface TextEdit {
  readonly range: TextRange;
  readonly newText: string;
}

export interface TextEditPlan {
  readonly uri: string;
  readonly originalRevision: ApprovalResourceRevision;
  readonly edits: readonly TextEdit[];
}

export class InvalidTextEditPlanError extends Error {
  constructor() {
    super("Invalid text edit plan.");
    this.name = "InvalidTextEditPlanError";
  }
}

export class OverlappingTextEditsError extends Error {
  constructor() {
    super("Text edit ranges must not overlap or share a start position.");
    this.name = "OverlappingTextEditsError";
  }
}

export function parseTextEditPlan(value: unknown): TextEditPlan {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["uri", "originalRevision", "edits"]) ||
    typeof value.uri !== "string" ||
    value.uri.length === 0 ||
    value.uri.length > maxApprovalUriCharacters ||
    !Array.isArray(value.edits) ||
    value.edits.length === 0
  ) {
    throw new InvalidTextEditPlanError();
  }

  const revision = approvalResourceRevisionSchema.safeParse(value.originalRevision);
  if (!revision.success) {
    throw new InvalidTextEditPlanError();
  }

  const edits = value.edits.map(parseTextEdit).sort(compareTextEdits);
  for (let index = 1; index < edits.length; index += 1) {
    const previous = edits[index - 1];
    const current = edits[index];
    if (
      previous === undefined ||
      current === undefined ||
      comparePositions(current.range.start, previous.range.end) < 0 ||
      comparePositions(current.range.start, previous.range.start) === 0
    ) {
      throw new OverlappingTextEditsError();
    }
  }

  return {
    uri: value.uri,
    originalRevision: revision.data,
    edits,
  };
}

function parseTextEdit(value: unknown): TextEdit {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["range", "newText"]) ||
    typeof value.newText !== "string" ||
    !isRecord(value.range) ||
    !hasOnlyKeys(value.range, ["start", "end"])
  ) {
    throw new InvalidTextEditPlanError();
  }

  const start = parseTextPosition(value.range.start);
  const end = parseTextPosition(value.range.end);
  if (comparePositions(start, end) > 0) {
    throw new InvalidTextEditPlanError();
  }

  return {
    range: { start, end },
    newText: value.newText,
  };
}

function parseTextPosition(value: unknown): TextPosition {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["line", "character"]) ||
    !isNonnegativeSafeInteger(value.line) ||
    !isNonnegativeSafeInteger(value.character)
  ) {
    throw new InvalidTextEditPlanError();
  }

  return {
    line: value.line,
    character: value.character,
  };
}

function compareTextEdits(left: TextEdit, right: TextEdit): number {
  return (
    comparePositions(left.range.start, right.range.start) ||
    comparePositions(left.range.end, right.range.end)
  );
}

function comparePositions(left: TextPosition, right: TextPosition): number {
  return left.line - right.line || left.character - right.character;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasOnlyKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).every((key) => keys.includes(key)) &&
    Object.keys(value).length === keys.length
  );
}
