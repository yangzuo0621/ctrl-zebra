import type { Uri } from "vscode";

export interface TestUriParts {
  readonly scheme?: string;
  readonly authority?: string;
  readonly path?: string;
  readonly query?: string;
  readonly fragment?: string;
}

export function createTestUri(path: string, scheme?: string): Uri;
export function createTestUri(parts: TestUriParts): Uri;
export function createTestUri(pathOrParts: string | TestUriParts, scheme = "file"): Uri {
  const parts = typeof pathOrParts === "string" ? { path: pathOrParts, scheme } : pathOrParts;
  return new TestUri(parts);
}

class TestUri implements Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  constructor(parts: TestUriParts) {
    this.scheme = parts.scheme ?? "file";
    this.authority = parts.authority ?? "";
    this.path = parts.path ?? "/";
    this.query = parts.query ?? "";
    this.fragment = parts.fragment ?? "";
  }

  get fsPath(): string {
    return this.path;
  }

  with(change: TestUriParts): Uri {
    return new TestUri({
      scheme: change.scheme ?? this.scheme,
      authority: change.authority ?? this.authority,
      path: change.path ?? this.path,
      query: change.query ?? this.query,
      fragment: change.fragment ?? this.fragment,
    });
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }

  toJSON(): TestUriParts {
    return {
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    };
  }
}
