import {
  type IdePositionDto,
  type IdeRangeDto,
  type IdeTruncationReason,
  ideTruncationReasons,
  maxIdePositionCharacter,
  maxIdePositionLine,
} from "@ctrl-zebra/protocol";

export interface IdeSourceUriLike {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
}

export interface IdeTextProjection {
  readonly text: string;
  readonly truncated: boolean;
  readonly reasons: readonly IdeTruncationReason[];
}

export class IdeSourceProjectionError extends Error {
  constructor() {
    super("The IDE source projection is invalid.");
    this.name = "IdeSourceProjectionError";
  }
}

function comparePositions(left: IdePositionDto, right: IdePositionDto): number {
  return left.line - right.line || left.character - right.character;
}

function compareOptionalRanges(
  left: IdeRangeDto | undefined,
  right: IdeRangeDto | undefined,
): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return comparePositions(left.start, right.start) || comparePositions(left.end, right.end);
}

function compareOptionalStrings(left: string | undefined, right: string | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return compareStrings(left, right);
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index] ?? 0;
    const rightPoint = rightPoints[index] ?? 0;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
  }
  return leftPoints.length - rightPoints.length;
}

function isPosition(value: unknown): value is IdePositionDto {
  return (
    isRecord(value) &&
    typeof value.line === "number" &&
    typeof value.character === "number" &&
    Number.isSafeInteger(value.line) &&
    Number.isSafeInteger(value.character) &&
    value.line >= 0 &&
    value.line <= maxIdePositionLine &&
    value.character >= 0 &&
    value.character <= maxIdePositionCharacter
  );
}

function validateDocumentPosition(
  lineCount: number,
  lineText: unknown,
  position: IdePositionDto,
): void {
  if (!Number.isSafeInteger(lineCount) || lineCount <= position.line) {
    throw new IdeSourceProjectionError();
  }
  if (
    typeof lineText !== "string" ||
    position.character > lineText.length ||
    isInsideSurrogate(lineText, position.character)
  ) {
    throw new IdeSourceProjectionError();
  }
}

function isInsideSurrogate(line: string, character: number): boolean {
  if (character <= 0 || character >= line.length) return false;
  const previous = line.charCodeAt(character - 1);
  const next = line.charCodeAt(character);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function readCodePoint(
  value: string,
  index: number,
): { readonly value: number; readonly width: 1 | 2 } {
  const codeUnit = value.charCodeAt(index);
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    if (!(next >= 0xdc00 && next <= 0xdfff)) throw new IdeSourceProjectionError();
    return { value: value.codePointAt(index) ?? 0, width: 2 };
  }
  if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) throw new IdeSourceProjectionError();
  return { value: codeUnit, width: 1 };
}

function utf8BytesForCodePoint(codePoint: number): number {
  return codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
}

function countCodePoints(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; ) {
    index += readCodePoint(value, index).width;
    count += 1;
  }
  return count;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; ) {
    const point = readCodePoint(value, index);
    index += point.width;
    bytes += utf8BytesForCodePoint(point.value);
  }
  return bytes;
}

function takeBoundedText(value: string, maxCodePoints: number, maxBytes: number): IdeTextProjection {
  const output: string[] = [];
  const reasons = new Set<IdeTruncationReason>();
  let codePoints = 0;
  let bytes = 0;
  let retained = true;
  for (let index = 0; index < value.length; ) {
    const point = readCodePoint(value, index);
    if (retained) {
      const candidateBytes = utf8BytesForCodePoint(point.value);
      if (codePoints + 1 > maxCodePoints) reasons.add("code-points");
      if (bytes + candidateBytes > maxBytes) reasons.add("utf8-bytes");
      if (reasons.size > 0) {
        retained = false;
      } else {
        output.push(value.slice(index, index + point.width));
        codePoints += 1;
        bytes += candidateBytes;
      }
    }
    index += point.width;
  }
  return { text: output.join(""), truncated: reasons.size > 0, reasons: orderedReasons(reasons) };
}

function boundedRequired(value: string, maxCodePoints: number, maxBytes: number): string {
  const projection = takeBoundedText(value, maxCodePoints, maxBytes);
  if (projection.truncated || projection.text.length === 0) throw new IdeSourceProjectionError();
  return projection.text;
}

function isBoundedWellFormedUnicode(
  value: string,
  maxCodePoints: number,
  maxBytes: number,
): boolean {
  let codePoints = 0;
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    let codePoint: number;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      codePoint = ((codeUnit - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
      index += 1;
    } else {
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
      codePoint = codeUnit;
    }
    codePoints += 1;
    bytes += utf8BytesForCodePoint(codePoint);
    if (codePoints > maxCodePoints || bytes > maxBytes) return false;
  }
  return true;
}

function sameUri(left: IdeSourceUriLike, right: IdeSourceUriLike): boolean {
  return (
    left.scheme.toLocaleLowerCase("en-US") === right.scheme.toLocaleLowerCase("en-US") &&
    left.authority.toLocaleLowerCase("en-US") === right.authority.toLocaleLowerCase("en-US") &&
    left.path === right.path &&
    left.query === right.query &&
    left.fragment === right.fragment
  );
}

function toWorkspaceRelativePath(root: IdeSourceUriLike, target: IdeSourceUriLike): string {
  const rootSegments = pathSegments(root.path);
  const targetSegments = pathSegments(target.path);
  if (
    targetSegments.length <= rootSegments.length ||
    !sameIdentityPart(root.scheme, target.scheme) ||
    !sameIdentityPart(root.authority, target.authority)
  ) {
    throw new IdeSourceProjectionError();
  }
  for (let index = 0; index < rootSegments.length; index += 1) {
    if (!sameIdentityPart(rootSegments[index] ?? "", targetSegments[index] ?? "")) {
      throw new IdeSourceProjectionError();
    }
  }
  const relative = targetSegments.slice(rootSegments.length).join("/");
  if (relative.length === 0) throw new IdeSourceProjectionError();
  return relative;
}

function pathSegments(path: string): readonly string[] {
  if (!path.startsWith("/") || path.includes("\\")) throw new IdeSourceProjectionError();
  if (path === "/") return [];
  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new IdeSourceProjectionError();
  }
  return segments;
}

function sameIdentityPart(left: string, right: string): boolean {
  return left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}

function orderedReasons(reasons: Iterable<IdeTruncationReason>): readonly IdeTruncationReason[] {
  const set = new Set(reasons);
  return ideTruncationReasons.filter((reason) => set.has(reason));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const ideSourceProjector = {
  boundedRequired,
  compareOptionalRanges,
  compareOptionalStrings,
  comparePositions,
  compareStrings,
  countCodePoints,
  isBoundedWellFormedUnicode,
  isHighSurrogate,
  isInsideSurrogate,
  isPosition,
  orderedReasons,
  readCodePoint,
  sameUri,
  takeBoundedText,
  toWorkspaceRelativePath,
  utf8ByteLength,
  utf8BytesForCodePoint,
  validateDocumentPosition,
};
