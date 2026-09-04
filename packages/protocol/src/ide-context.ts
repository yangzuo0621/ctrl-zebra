import { z } from "zod";

import { boundedTextSchema, utf8ByteLength, utf8BytesForCodePoint } from "./text-primitives.js";

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
export const maxIdeDiagnosticEntries = 256;
export const maxIdeDiagnosticAggregateCodePoints = 131_072;
export const maxIdeDiagnosticAggregateBytes = 524_288;
export const maxIdeDiagnosticMessageCodePoints = 4_096;
export const maxIdeDiagnosticMessageBytes = 16_384;
export const maxIdeDiagnosticLabelCodePoints = 1_024;
export const maxIdeDiagnosticLabelBytes = 4_096;
export const maxIdeLanguageLocationEntries = maxIdeDiagnosticEntries;
export const maxIdeSymbolEntries = maxIdeDiagnosticEntries;
export const maxIdeLanguageAggregateCodePoints = maxIdeDiagnosticAggregateCodePoints;
export const maxIdeLanguageAggregateBytes = maxIdeDiagnosticAggregateBytes;

export const ideDiagnosticSeverities = ["error", "warning", "information", "hint"] as const;

export type IdeDiagnosticSeverity = (typeof ideDiagnosticSeverities)[number];

export const ideLanguageLocationKinds = ["definition", "reference"] as const;

export type IdeLanguageLocationKind = (typeof ideLanguageLocationKinds)[number];

export const ideLanguageOperations = ["definition", "references"] as const;

export type IdeLanguageOperation = (typeof ideLanguageOperations)[number];

export const ideSymbolKinds = [
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enum-member",
  "struct",
  "event",
  "operator",
  "type-parameter",
  "unknown",
] as const;

export type IdeSymbolKind = (typeof ideSymbolKinds)[number];

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

export const ideRangeSchema = z
  .strictObject({
    start: idePositionSchema,
    end: idePositionSchema,
  })
  .superRefine((range, context) => {
    if (compareIdePositions(range.start, range.end) > 0) {
      context.addIssue({ code: "custom", message: "IDE ranges must not be reversed." });
    }
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

const ideDiagnosticSeveritySchema = z.enum(ideDiagnosticSeverities);
const ideDiagnosticMessageSchema = boundedTextSchema(
  maxIdeDiagnosticMessageCodePoints,
  maxIdeDiagnosticMessageBytes,
);
const ideDiagnosticLabelSchema = boundedTextSchema(
  maxIdeDiagnosticLabelCodePoints,
  maxIdeDiagnosticLabelBytes,
);

export const ideDiagnosticSchema = z.strictObject({
  source: ideSourceSchema,
  severity: ideDiagnosticSeveritySchema,
  message: ideDiagnosticMessageSchema,
  code: ideDiagnosticLabelSchema.optional(),
  origin: ideDiagnosticLabelSchema.optional(),
});

export const ideDiagnosticsResultSchema = z
  .strictObject({
    kind: z.literal("diagnostics"),
    source: ideSourceSchema,
    diagnostics: z.array(ideDiagnosticSchema).max(maxIdeDiagnosticEntries),
    stale: z.boolean(),
    truncated: z.boolean(),
    truncationReasons: z
      .array(ideTruncationReasonSchema)
      .min(1)
      .max(ideTruncationReasons.length)
      .optional(),
  })
  .superRefine((result, context) => {
    const reasons = result.truncationReasons;
    if (result.truncated && reasons === undefined) {
      context.addIssue({
        code: "custom",
        message: "A truncated diagnostic result must include reasons.",
      });
    }
    if (!result.truncated && reasons !== undefined) {
      context.addIssue({
        code: "custom",
        message: "An untruncated diagnostic result must omit truncation reasons.",
      });
    }
    if (reasons !== undefined && new Set(reasons).size !== reasons.length) {
      context.addIssue({
        code: "custom",
        message: "Diagnostic truncation reasons must be unique.",
      });
    }

    let codePoints = 0;
    let bytes = 0;
    for (const value of [
      result.source,
      ...result.diagnostics.map((diagnostic) => diagnostic.source),
    ]) {
      for (const text of sourceStrings(value)) {
        codePoints += [...text].length;
        bytes += utf8ByteLength(text);
      }
    }
    for (const diagnostic of result.diagnostics) {
      for (const text of [diagnostic.message, diagnostic.code, diagnostic.origin]) {
        if (text === undefined) continue;
        codePoints += [...text].length;
        bytes += utf8ByteLength(text);
      }
    }
    if (codePoints > maxIdeDiagnosticAggregateCodePoints) {
      context.addIssue({
        code: "custom",
        message: `Diagnostic output must not exceed ${maxIdeDiagnosticAggregateCodePoints} Unicode code points.`,
      });
    }
    if (bytes > maxIdeDiagnosticAggregateBytes) {
      context.addIssue({
        code: "custom",
        message: `Diagnostic output must not exceed ${maxIdeDiagnosticAggregateBytes} UTF-8 bytes.`,
      });
    }
  });

const ideLanguageLocationKindSchema = z.enum(ideLanguageLocationKinds);
const ideLanguageOperationSchema = z.enum(ideLanguageOperations);
const ideSymbolKindSchema = z.enum(ideSymbolKinds);
const ideSymbolLabelSchema = boundedTextSchema(
  maxIdeDiagnosticLabelCodePoints,
  maxIdeDiagnosticLabelBytes,
);

export const ideLanguageLocationSchema = z.strictObject({
  source: ideSourceSchema,
  range: ideRangeSchema,
  kind: ideLanguageLocationKindSchema,
});

export const ideLanguageLocationsResultSchema = z
  .strictObject({
    kind: z.literal("language-locations"),
    operation: ideLanguageOperationSchema,
    source: ideSourceSchema,
    locations: z.array(ideLanguageLocationSchema).max(maxIdeLanguageLocationEntries),
    stale: z.boolean(),
    truncated: z.boolean(),
    truncationReasons: z
      .array(ideTruncationReasonSchema)
      .min(1)
      .max(ideTruncationReasons.length)
      .optional(),
  })
  .superRefine((result, context) => {
    validateTruncationMetadata(result, context, "language location");

    let codePoints = 0;
    let bytes = 0;
    for (const source of [result.source, ...result.locations.map((location) => location.source)]) {
      for (const text of sourceStrings(source)) {
        codePoints += [...text].length;
        bytes += utf8ByteLength(text);
      }
    }
    if (codePoints > maxIdeLanguageAggregateCodePoints) {
      context.addIssue({
        code: "custom",
        message: `Language location output must not exceed ${maxIdeLanguageAggregateCodePoints} Unicode code points.`,
      });
    }
    if (bytes > maxIdeLanguageAggregateBytes) {
      context.addIssue({
        code: "custom",
        message: `Language location output must not exceed ${maxIdeLanguageAggregateBytes} UTF-8 bytes.`,
      });
    }
  });

export const ideSymbolSchema = z.strictObject({
  name: ideSymbolLabelSchema,
  kind: ideSymbolKindSchema,
  range: ideRangeSchema,
  containerName: ideSymbolLabelSchema.optional(),
  detail: ideSymbolLabelSchema.optional(),
  selectionRange: ideRangeSchema.optional(),
});

export const ideSymbolsResultSchema = z
  .strictObject({
    kind: z.literal("symbols"),
    source: ideSourceSchema,
    symbols: z.array(ideSymbolSchema).max(maxIdeSymbolEntries),
    stale: z.boolean(),
    truncated: z.boolean(),
    truncationReasons: z
      .array(ideTruncationReasonSchema)
      .min(1)
      .max(ideTruncationReasons.length)
      .optional(),
  })
  .superRefine((result, context) => {
    validateTruncationMetadata(result, context, "symbol");

    let codePoints = 0;
    let bytes = 0;
    for (const text of sourceStrings(result.source)) {
      codePoints += [...text].length;
      bytes += utf8ByteLength(text);
    }
    for (const symbol of result.symbols) {
      for (const text of [symbol.name, symbol.containerName, symbol.detail]) {
        if (text === undefined) continue;
        codePoints += [...text].length;
        bytes += utf8ByteLength(text);
      }
    }
    if (codePoints > maxIdeLanguageAggregateCodePoints) {
      context.addIssue({
        code: "custom",
        message: `Symbol output must not exceed ${maxIdeLanguageAggregateCodePoints} Unicode code points.`,
      });
    }
    if (bytes > maxIdeLanguageAggregateBytes) {
      context.addIssue({
        code: "custom",
        message: `Symbol output must not exceed ${maxIdeLanguageAggregateBytes} UTF-8 bytes.`,
      });
    }
  });

export const ideReadOnlyToolResultSchema = z.union([
  ideEditorContextResultSchema,
  ideDiagnosticsResultSchema,
  ideLanguageLocationsResultSchema,
  ideSymbolsResultSchema,
]);

export type IdeUriDto = z.infer<typeof ideUriSchema>;
export type IdePositionDto = z.infer<typeof idePositionSchema>;
export type IdeRangeDto = z.infer<typeof ideRangeSchema>;
export type IdeSourceDto = z.infer<typeof ideSourceSchema>;
export type IdeTextContextDto = z.infer<typeof ideTextContextSchema>;
export type IdeEditorContextResultDto = z.infer<typeof ideEditorContextResultSchema>;
export type IdeDiagnosticDto = z.infer<typeof ideDiagnosticSchema>;
export type IdeDiagnosticsResultDto = z.infer<typeof ideDiagnosticsResultSchema>;
export type IdeLanguageLocationDto = z.infer<typeof ideLanguageLocationSchema>;
export type IdeLanguageLocationsResultDto = z.infer<typeof ideLanguageLocationsResultSchema>;
export type IdeSymbolDto = z.infer<typeof ideSymbolSchema>;
export type IdeSymbolsResultDto = z.infer<typeof ideSymbolsResultSchema>;
export type IdeReadOnlyToolResultDto = z.infer<typeof ideReadOnlyToolResultSchema>;

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

function compareIdePositions(
  left: Pick<IdePositionDto, "line" | "character">,
  right: Pick<IdePositionDto, "line" | "character">,
): number {
  return left.line - right.line || left.character - right.character;
}

function sourceStrings(source: IdeSourceDto): readonly string[] {
  return [
    source.uri.scheme,
    source.uri.authority,
    source.uri.path,
    ...(source.languageId === undefined ? [] : [source.languageId]),
  ];
}

function validateTruncationMetadata(
  result: {
    readonly truncated: boolean;
    readonly truncationReasons?: readonly IdeTruncationReason[];
  },
  context: z.RefinementCtx,
  label: string,
): void {
  const reasons = result.truncationReasons;
  if (result.truncated && reasons === undefined) {
    context.addIssue({
      code: "custom",
      message: `A truncated ${label} result must include reasons.`,
    });
  }
  if (!result.truncated && reasons !== undefined) {
    context.addIssue({
      code: "custom",
      message: `An untruncated ${label} result must omit truncation reasons.`,
    });
  }
  if (reasons !== undefined && new Set(reasons).size !== reasons.length) {
    context.addIssue({
      code: "custom",
      message: `${label} truncation reasons must be unique.`,
    });
  }
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
