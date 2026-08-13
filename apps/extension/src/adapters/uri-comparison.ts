export interface UriIdentityLike {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
}

export function sameIdentityPart(left: string, right: string): boolean {
  return left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}

export function sameUri(left: UriIdentityLike, right: UriIdentityLike): boolean {
  return (
    sameIdentityPart(left.scheme, right.scheme) &&
    sameIdentityPart(left.authority, right.authority) &&
    left.path === right.path &&
    left.query === right.query &&
    left.fragment === right.fragment
  );
}
