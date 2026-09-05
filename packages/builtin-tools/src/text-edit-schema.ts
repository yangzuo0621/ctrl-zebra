import { z } from "zod";

/**
 * Shared by propose_file_edit and propose_workspace_edit's model-facing schemas -- both tools'
 * hand-written JSON Schema literals declared this exact shape for a text position (down to the
 * description strings), byte-for-byte duplicated between the two files before this migration.
 *
 * `z.number().int().min(0)` (no explicit `.max()`) makes `z.toJSONSchema()` add a
 * `"maximum": 9007199254740991` (`Number.MAX_SAFE_INTEGER`) that neither original hand-written
 * literal advertised. Accepted as a deliberate, benign schema enhancement -- the parser already
 * only ever accepted safe integers -- the same call made for read_file's startLine/endLine in
 * tranche 1 (see read-file.ts and its test).
 */
export const textPositionSchema = z
  .strictObject({
    line: z.number().int().min(0).describe("Zero-based line number."),
    character: z.number().int().min(0).describe("Zero-based UTF-16 character offset."),
  })
  .describe("A zero-based text position.");

/** Also shared verbatim between propose_file_edit and propose_workspace_edit. */
export const textRangeSchema = z
  .strictObject({ start: textPositionSchema, end: textPositionSchema })
  .describe("A zero-based half-open text range.");
