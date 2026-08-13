import { checkpointHashSchema, maxApprovalUriCharacters } from "@ctrl-zebra/protocol";

import { hasExactKeys, isRecord } from "./record-validation.js";

/** The immutable host-bound plan prepared for a proposed new text file. */
export interface FileCreatePlan {
  readonly operation: "create";
  readonly path: string;
  readonly uri: string;
  readonly content: string;
  readonly afterHash: string;
}

export class InvalidFileCreatePlanError extends Error {
  constructor() {
    super("Invalid file create plan.");
    this.name = "InvalidFileCreatePlanError";
  }
}

export function parseFileCreatePlan(value: unknown): FileCreatePlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["operation", "path", "uri", "content", "afterHash"]) ||
    value.operation !== "create" ||
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    value.path.length > 4_096 ||
    typeof value.uri !== "string" ||
    value.uri.length === 0 ||
    value.uri.length > maxApprovalUriCharacters ||
    typeof value.content !== "string" ||
    !checkpointHashSchema.safeParse(value.afterHash).success
  ) {
    throw new InvalidFileCreatePlanError();
  }

  const path = value.path as string;
  const uri = value.uri as string;
  const content = value.content as string;
  const afterHash = value.afterHash as string;
  return {
    operation: "create",
    path,
    uri,
    content,
    afterHash,
  };
}
