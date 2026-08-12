import { z } from "zod";

export const maxIdeUriSchemeCodePoints = 32;
export const maxIdeUriSchemeBytes = 128;
export const maxIdeUriAuthorityCodePoints = 9;
export const maxIdeUriAuthorityBytes = 32;
export const maxIdeUriPathCodePoints = 4_096;
export const maxIdeUriPathBytes = 16_384;
export const maxIdeLanguageIdCodePoints = 128;
export const maxIdeLanguageIdBytes = 512;
export const maxIdeTextCodePoints = 65_536;
export const maxIdeTextLines = 2_000;
export const maxIdeTextBytes = 262_144;
export const maxIdePositionLine = maxIdeTextLines - 1;
export const maxIdePositionCharacter = 131_072;

export const ideTruncationReasons = [
  "code-points",
  "utf8-bytes",
  "lines",
  "entries",
  "tokens",
  "out-of-workspace",
] as const;

export type IdeTruncationReason = (typeof ideTruncationReasons)[number];

const ideTruncationReasonSchema = z.enum(ideTruncationReasons);
const ideUriSchemeSchema = boundedTextSchema(maxIdeUriSchemeCodePoints, maxIdeUriSchemeBytes).min(
  1,
);
const ideUriPathSchema = boundedTextSchema(maxIdeUriPathCodePoints, maxIdeUriPathBytes)
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("?") &&
      !value.includes("#") &&
      !/(?:^|\/)\.{1,2}(?:\/|$)/u.test(value),
    "IDE URI paths must be canonical workspace-relative paths.",
  );
const ideLanguageIdSchema = boundedTextSchema(maxIdeLanguageIdCodePoints, maxIdeLanguageIdBytes);

export const ideUriSchema = z.strictObject({
  scheme: ideUriSchemeSchema,
  authority: z.enum(["", "workspace"]),
  path: ideUriPathSchema,
});

export const idePositionSchema = z.strictObject({
  line: z.number().int().min(0).max(maxIdePositionLine),
  character: z.number().int().min(0).max(maxIdePositionCharacter),
});

export const ideRangeSchema = z.strictObject({
  start: idePositionSchema,
  end: idePositionSchema,
});

export const ideSourceSchema = z
  .strictObject({
    uri: ideUriSchema,
    range: ideRangeSchema.optional(),
    languageId: ideLanguageIdSchema.optional(),
    documentVersion: z.number().int().nonnegative().safe().optional(),
    stale: z.boolean(),
    truncated: z.boolean(),
    truncationReasons: z
      .array(ideTruncationReasonSchema)
      .min(1)
      .max(ideTruncationReasons.length)
      .optional(),
  })
  .superRefine((source, context) => {
    const reasons = source.truncationReasons;
    if (source.truncated && reasons === undefined) {
      context.addIssue({ code: "custom", message: "A truncated IDE source must include reasons." });
    }
    if (!source.truncated && reasons !== undefined) {
      context.addIssue({
        code: "custom",
        message: "An untruncated IDE source must omit truncation reasons.",
      });
    }
    if (reasons !== undefined && new Set(reasons).size !== reasons.length) {
      context.addIssue({ code: "custom", message: "IDE truncation reasons must be unique." });
    }
  });

export const ideTextContextSchema = z.strictObject({
  source: ideSourceSchema,
  text: boundedTextSchema(maxIdeTextCodePoints, maxIdeTextBytes).refine(
    hasAtMostIdeTextLines,
    `Text must not exceed ${maxIdeTextLines} logical lines.`,
  ),
});

export const ideEditorContextResultSchema = z.strictObject({
  kind: z.literal("editor-context"),
  context: ideTextContextSchema,
});

export type IdeUriDto = z.infer<typeof ideUriSchema>;
export type IdePositionDto = z.infer<typeof idePositionSchema>;
export type IdeRangeDto = z.infer<typeof ideRangeSchema>;
export type IdeSourceDto = z.infer<typeof ideSourceSchema>;
export type IdeTextContextDto = z.infer<typeof ideTextContextSchema>;
export type IdeEditorContextResultDto = z.infer<typeof ideEditorContextResultSchema>;

export interface IdeTextPrefix {
  readonly text: string;
  readonly truncated: boolean;
  readonly truncationReasons: readonly IdeTruncationReason[];
}

/**
 * Incrementally projects IDE text while retaining only the bounded prefix.
 * Chunks may split a CRLF delimiter; the collector defers a trailing CR until
 * the next chunk so delimiter accounting remains atomic.
 */
export class IdeTextPrefixCollector {
  readonly #output: string[] = [];
  readonly #reasons = new Set<IdeTruncationReason>();
  #codePoints = 0;
  #bytes = 0;
  #lines = 1;
  #retained = true;
  #pendingCr = false;
  #finished = false;

  /** True once a hard text budget has been reached and later chunks cannot be retained. */
  get limitReached(): boolean {
    return !this.#retained;
  }

  add(value: string): void {
    if (this.#finished) {
      throw new Error("IDE text prefix collector is already finished.");
    }

    for (let index = 0; index < value.length; ) {
      const codePoint = readCodePoint(value, index);
      const nextIndex = index + codePoint.width;
      if (this.#pendingCr) {
        this.#pendingCr = false;
        if (codePoint.value === 0x0a) {
          this.#accept("\r\n", 2, 2, true);
          index = nextIndex;
          continue;
        }
        this.#accept("\r", 1, 1, true);
      }

      if (codePoint.value === 0x0d) {
        this.#pendingCr = true;
      } else {
        this.#accept(
          value.slice(index, nextIndex),
          1,
          utf8BytesForCodePoint(codePoint.value),
          codePoint.value === 0x0a,
        );
      }
      index = nextIndex;
    }
  }

  finish(): IdeTextPrefix {
    if (!this.#finished) {
      this.#finished = true;
      if (this.#pendingCr) {
        this.#pendingCr = false;
        this.#accept("\r", 1, 1, true);
      }
    }
    const truncationReasons = ideTruncationReasons.filter((reason) => this.#reasons.has(reason));
    return {
      text: this.#output.join(""),
      truncated: truncationReasons.length > 0,
      truncationReasons,
    };
  }

  #accept(
    value: string,
    candidateCodePoints: number,
    candidateBytes: number,
    createsLine: boolean,
  ): void {
    if (!this.#retained) return;

    const candidateReasons: IdeTruncationReason[] = [];
    if (this.#codePoints + candidateCodePoints > maxIdeTextCodePoints) {
      candidateReasons.push("code-points");
    }
    if (this.#bytes + candidateBytes > maxIdeTextBytes) {
      candidateReasons.push("utf8-bytes");
    }
    if (createsLine && this.#lines >= maxIdeTextLines) {
      candidateReasons.push("lines");
    }
    if (candidateReasons.length > 0) {
      this.#retained = false;
      for (const reason of candidateReasons) this.#reasons.add(reason);
      return;
    }

    this.#output.push(value);
    this.#codePoints += candidateCodePoints;
    this.#bytes += candidateBytes;
    if (createsLine) this.#lines += 1;
  }
}

/**
 * Produces the bounded editor-text prefix without retaining a dangling CR from a CRLF delimiter.
 * The input is already owned by VS Code; this pass keeps the protocol projection bounded.
 */
export function takeIdeTextPrefix(value: string): IdeTextPrefix {
  const collector = new IdeTextPrefixCollector();
  collector.add(value);
  return collector.finish();
}

function boundedTextSchema(maxCodePoints: number, maxBytes: number) {
  return z
    .string()
    .refine(isWellFormedUnicode, "Text must contain well-formed Unicode.")
    .refine(
      (value) => [...value].length <= maxCodePoints,
      `Text must not exceed ${maxCodePoints} Unicode code points.`,
    )
    .refine(
      (value) => utf8ByteLength(value) <= maxBytes,
      `Text must not exceed ${maxBytes} UTF-8 bytes.`,
    );
}

function readCodePoint(
  value: string,
  index: number,
): { readonly value: number; readonly width: 1 | 2 } {
  const codeUnit = value.charCodeAt(index);
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    if (!(next >= 0xdc00 && next <= 0xdfff)) {
      throw new TypeError("IDE text must contain well-formed Unicode.");
    }
    return { value: value.codePointAt(index) ?? 0, width: 2 };
  }
  if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
    throw new TypeError("IDE text must contain well-formed Unicode.");
  }
  return { value: codeUnit, width: 1 };
}

function isWellFormedUnicode(value: string): boolean {
  try {
    for (let index = 0; index < value.length; ) {
      index += readCodePoint(value, index).width;
    }
    return true;
  } catch {
    return false;
  }
}

function hasAtMostIdeTextLines(value: string): boolean {
  let lines = 1;
  for (let index = 0; index < value.length; ) {
    const codePoint = readCodePoint(value, index);
    const nextIndex = index + codePoint.width;
    if (codePoint.value === 0x0d && value.charCodeAt(nextIndex) === 0x0a) {
      index = nextIndex + 1;
      lines += 1;
    } else {
      index = nextIndex;
      if (codePoint.value === 0x0d || codePoint.value === 0x0a) lines += 1;
    }
    if (lines > maxIdeTextLines) return false;
  }
  return true;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    bytes += utf8BytesForCodePoint(character.codePointAt(0) ?? 0);
  }
  return bytes;
}

function utf8BytesForCodePoint(codePoint: number): number {
  return codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
}
