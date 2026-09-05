import { isApprovedExternalLink } from "@ctrl-zebra/protocol";
import MarkdownIt from "markdown-it";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import styles from "./markdown-message.module.css";
import { strings } from "./strings.js";
import { utf8BytesForCodePoint as utf8Width } from "./text-primitives.js";

export const maxMarkdownCodePoints = 262_144;
export const maxMarkdownUtf8Bytes = 1_048_576;

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
  typographer: false,
});

// Images would create remote resource requests from model output. They are deliberately
// excluded even though the parser itself is otherwise useful for normal Markdown links.
markdown.disable(["image"]);

interface MarkdownToken {
  readonly type: string;
  readonly tag: string;
  readonly hidden: boolean;
  readonly nesting: -1 | 0 | 1;
  readonly content: string;
  readonly info: string;
  readonly children: readonly MarkdownToken[] | null;
  attrGet(name: string): string | number | null;
}

interface MarkdownMessageProps {
  readonly content: string;
  readonly onOpenLink?: (href: string) => void;
}

interface BlockRoot {
  readonly kind: "root";
  readonly children: BlockNode[];
}

interface BlockElement {
  readonly kind: "element";
  readonly tokenType: string;
  readonly tag: string;
  readonly hidden: boolean;
  readonly token: MarkdownToken;
  readonly children: BlockNode[];
}

type BlockNode =
  | BlockElement
  | { readonly kind: "inline"; readonly tokens: readonly MarkdownToken[] }
  | { readonly kind: "code"; readonly language: string; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "break" }
  | { readonly kind: "hr" };

interface InlineContainer {
  readonly kind: "root" | "element";
  readonly tokenType?: string;
  readonly href?: string;
  readonly children: InlineNode[];
}

type InlineNode =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "break" }
  | {
      readonly kind: "element";
      readonly tokenType: string;
      readonly href?: string;
      readonly children: readonly InlineNode[];
    };

interface CodeBlockProps {
  readonly blockKey: string;
  readonly language: string;
  readonly text: string;
  readonly copied: boolean;
  readonly copyFailed: boolean;
  readonly onCopy: (text: string, blockKey: string) => void;
}

export function MarkdownMessage({ content, onOpenLink }: MarkdownMessageProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyFailedKey, setCopyFailedKey] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      for (const timer of timers.current) {
        clearTimeout(timer);
      }
      timers.current = [];
    },
    [],
  );

  const handleCopy = (text: string, blockKey: string) => {
    if (typeof navigator.clipboard?.writeText !== "function") {
      return;
    }

    void navigator.clipboard.writeText(text).then(
      () => {
        setCopiedKey(blockKey);
        setCopyFailedKey(null);
        timers.current.push(
          setTimeout(() => {
            setCopiedKey((current) => (current === blockKey ? null : current));
          }, 2_000),
        );
      },
      () => {
        setCopyFailedKey(blockKey);
        setCopiedKey(null);
        timers.current.push(
          setTimeout(() => {
            setCopyFailedKey((current) => (current === blockKey ? null : current));
          }, 2_000),
        );
      },
    );
  };

  const { tree, truncated } = useMemo(() => {
    const bounded = takeMarkdownPrefix(content);
    return { tree: buildBlockTree(markdown.parse(bounded.text, {})), truncated: bounded.truncated };
  }, [content]);

  return (
    <div className={styles.container}>
      {renderBlockNodes(tree, "block", onOpenLink, handleCopy, copiedKey, copyFailedKey)}
      {truncated ? <p className={styles.truncated}>{strings.markdown.truncated}</p> : null}
    </div>
  );
}

function renderBlockNodes(
  nodes: readonly BlockNode[],
  path: string,
  onOpenLink: ((href: string) => void) | undefined,
  onCopy: (text: string, blockKey: string) => void,
  copiedKey: string | null,
  copyFailedKey: string | null,
): ReactNode[] {
  return nodes.map((node, index) =>
    renderBlockNode(node, `${path}.${index}`, onOpenLink, onCopy, copiedKey, copyFailedKey),
  );
}

function renderBlockNode(
  node: BlockNode,
  key: string,
  onOpenLink: ((href: string) => void) | undefined,
  onCopy: (text: string, blockKey: string) => void,
  copiedKey: string | null,
  copyFailedKey: string | null,
): ReactNode {
  if (node.kind === "text") {
    return <span key={key}>{node.text}</span>;
  }
  if (node.kind === "break") {
    return <br key={key} />;
  }
  if (node.kind === "hr") {
    return <hr key={key} className={styles.hr} />;
  }
  if (node.kind === "code") {
    return (
      <CodeBlock
        key={key}
        blockKey={key}
        language={node.language}
        text={node.text}
        copied={copiedKey === key}
        copyFailed={copyFailedKey === key}
        onCopy={onCopy}
      />
    );
  }
  if (node.kind === "inline") {
    return (
      <span key={key}>
        {renderInlineNodes(buildInlineTree(node.tokens), `${key}.inline`, onOpenLink)}
      </span>
    );
  }
  if (node.hidden) {
    return (
      <span key={key}>
        {renderBlockNodes(node.children, key, onOpenLink, onCopy, copiedKey, copyFailedKey)}
      </span>
    );
  }

  const children = renderBlockNodes(
    node.children,
    key,
    onOpenLink,
    onCopy,
    copiedKey,
    copyFailedKey,
  );
  const tag = blockTag(node);
  if (tag === undefined) {
    return <span key={key}>{children}</span>;
  }
  if (tag === "ol") {
    const start = node.token.attrGet("start");
    const startNumber = start === null ? undefined : Number(start);
    return (
      <ol
        key={key}
        className={styles.list}
        start={Number.isInteger(startNumber) ? startNumber : undefined}
      >
        {children}
      </ol>
    );
  }
  if (tag === "table") {
    return (
      <div key={key} className={styles.tableWrapper}>
        <table className={styles.table}>{children}</table>
      </div>
    );
  }
  switch (tag) {
    case "p":
      return (
        <p key={key} className={styles.paragraph}>
          {children}
        </p>
      );
    case "blockquote":
      return (
        <blockquote key={key} className={styles.blockquote}>
          {children}
        </blockquote>
      );
    case "ul":
      return (
        <ul key={key} className={styles.list}>
          {children}
        </ul>
      );
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const Heading = tag;
      return (
        <Heading key={key} className={styles.heading}>
          {children}
        </Heading>
      );
    }
    case "li":
      return <li key={key}>{children}</li>;
    case "thead":
      return <thead key={key}>{children}</thead>;
    case "tbody":
      return <tbody key={key}>{children}</tbody>;
    case "tr":
      return <tr key={key}>{children}</tr>;
    case "th":
      return (
        <th key={key} style={tableCellStyle(node.token)}>
          {children}
        </th>
      );
    case "td":
      return (
        <td key={key} style={tableCellStyle(node.token)}>
          {children}
        </td>
      );
    default:
      return <span key={key}>{children}</span>;
  }
}

function blockTag(
  node: BlockElement,
):
  | "p"
  | "blockquote"
  | "ul"
  | "ol"
  | "li"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "table"
  | "thead"
  | "tbody"
  | "tr"
  | "th"
  | "td"
  | undefined {
  switch (node.tokenType) {
    case "paragraph_open":
      return "p";
    case "blockquote_open":
      return "blockquote";
    case "bullet_list_open":
      return "ul";
    case "ordered_list_open":
      return "ol";
    case "list_item_open":
      return "li";
    case "heading_open":
      return /^h[1-6]$/u.test(node.tag)
        ? (node.tag as "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
        : "h2";
    case "table_open":
      return "table";
    case "thead_open":
      return "thead";
    case "tbody_open":
      return "tbody";
    case "tr_open":
      return "tr";
    case "th_open":
      return "th";
    case "td_open":
      return "td";
    default:
      return undefined;
  }
}

/**
 * markdown-it only ever emits exactly `text-align:left|right|center` for a `th`/`td`'s column
 * alignment (there is no raw-HTML/attribute injection path here — `html: false` is set above).
 * Still, the value is matched against a fixed allowlist rather than passed through as arbitrary
 * CSS text.
 */
function tableCellStyle(token: MarkdownToken): CSSProperties | undefined {
  const style = token.attrGet("style");
  const alignment =
    typeof style === "string" ? /^text-align:(left|right|center)$/u.exec(style)?.[1] : undefined;
  return alignment === undefined
    ? undefined
    : { textAlign: alignment as CSSProperties["textAlign"] };
}

function renderInlineNodes(
  nodes: readonly InlineNode[],
  path: string,
  onOpenLink: ((href: string) => void) | undefined,
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${path}.${index}`;
    if (node.kind === "text") {
      return <span key={key}>{node.text}</span>;
    }
    if (node.kind === "code") {
      return (
        <code key={key} className={styles.inlineCode}>
          {node.text}
        </code>
      );
    }
    if (node.kind === "break") {
      return <br key={key} />;
    }

    const children = renderInlineNodes(node.children, `${key}.children`, onOpenLink);
    switch (node.tokenType) {
      case "strong":
        return <strong key={key}>{children}</strong>;
      case "em":
        return <em key={key}>{children}</em>;
      case "del":
        return <del key={key}>{children}</del>;
      case "link": {
        const href = node.href;
        return (
          <a
            key={key}
            className={styles.link}
            href={href}
            onAuxClick={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              if (href !== undefined) {
                onOpenLink?.(href);
              }
            }}
          >
            {children}
          </a>
        );
      }
      default:
        return <span key={key}>{children}</span>;
    }
  });
}

function buildBlockTree(tokens: readonly MarkdownToken[]): readonly BlockNode[] {
  const root: BlockRoot = { kind: "root", children: [] };
  const stack: Array<BlockRoot | BlockElement> = [root];
  const append = (node: BlockNode) => {
    stack[stack.length - 1]?.children.push(node);
  };

  for (const token of tokens) {
    if (token.type === "inline") {
      append({ kind: "inline", tokens: token.children ?? [] });
      continue;
    }
    if (token.type === "fence" || token.type === "code_block") {
      append({
        kind: "code",
        language: readCodeLanguage(token.info),
        text: token.content,
      });
      continue;
    }
    if (token.nesting === 1) {
      const node: BlockElement = {
        kind: "element",
        tokenType: token.type,
        tag: token.tag,
        hidden: token.hidden,
        token,
        children: [],
      };
      append(node);
      stack.push(node);
      continue;
    }
    if (token.nesting === -1) {
      if (stack.length > 1) {
        stack.pop();
      } else if (token.content.length > 0) {
        append({ kind: "text", text: token.content });
      }
      continue;
    }
    if (token.type === "softbreak" || token.type === "hardbreak") {
      append({ kind: "break" });
      continue;
    }
    if (token.type === "hr") {
      append({ kind: "hr" });
      continue;
    }
    if (token.content.length > 0) {
      append({ kind: "text", text: token.content });
    }
  }

  return root.children;
}

function buildInlineTree(tokens: readonly MarkdownToken[]): readonly InlineNode[] {
  const root: InlineContainer = { kind: "root", children: [] };
  const stack: InlineContainer[] = [root];
  const append = (node: InlineNode) => {
    stack[stack.length - 1]?.children.push(node);
  };

  for (const token of tokens) {
    if (token.type === "text" || token.type === "html_inline") {
      if (token.content.length > 0) append({ kind: "text", text: token.content });
      continue;
    }
    if (token.type === "code_inline") {
      append({ kind: "code", text: token.content });
      continue;
    }
    if (token.type === "softbreak" || token.type === "hardbreak") {
      append({ kind: "break" });
      continue;
    }
    if (token.type === "image") {
      append({ kind: "text", text: token.content });
      continue;
    }
    if (token.nesting === 1) {
      if (
        token.type !== "strong_open" &&
        token.type !== "em_open" &&
        token.type !== "s_open" &&
        token.type !== "link_open"
      ) {
        if (token.content.length > 0) append({ kind: "text", text: token.content });
        continue;
      }
      const href = token.type === "link_open" ? readStringAttribute(token, "href") : undefined;
      stack.push({
        kind: "element",
        tokenType:
          token.type === "strong_open"
            ? "strong"
            : token.type === "em_open"
              ? "em"
              : token.type === "s_open"
                ? "del"
                : href !== undefined && isApprovedExternalLink(href)
                  ? "link"
                  : "unsafe-link",
        href: href !== undefined && isApprovedExternalLink(href) ? href : undefined,
        children: [],
      });
      continue;
    }
    if (token.nesting === -1) {
      if (stack.length <= 1) continue;
      const node = stack.pop();
      if (node !== undefined && node.kind === "element") {
        append({
          kind: "element",
          tokenType: node.tokenType ?? "unsupported",
          href: node.href,
          children: node.children,
        });
      }
      continue;
    }
    if (token.content.length > 0) append({ kind: "text", text: token.content });
  }

  while (stack.length > 1) {
    const node = stack.pop();
    if (node !== undefined && node.kind === "element") {
      append({
        kind: "element",
        tokenType: node.tokenType ?? "unsupported",
        href: node.href,
        children: node.children,
      });
    }
  }

  return root.children;
}

function readStringAttribute(token: MarkdownToken, name: string): string | undefined {
  const value = token.attrGet(name);
  return typeof value === "string" ? value : undefined;
}

function readCodeLanguage(info: string): string {
  const language = info.trim().split(/\s+/u, 1)[0] ?? "";
  return language.length > 64 ? language.slice(0, 64) : language;
}

function takeMarkdownPrefix(content: string): {
  readonly text: string;
  readonly truncated: boolean;
} {
  let codePoints = 0;
  let utf8Bytes = 0;
  let end = 0;

  for (const codePoint of content) {
    const bytes = utf8Width(codePoint.codePointAt(0) ?? 0);
    if (codePoints >= maxMarkdownCodePoints || utf8Bytes + bytes > maxMarkdownUtf8Bytes) {
      return { text: content.slice(0, end), truncated: true };
    }
    codePoints += 1;
    utf8Bytes += bytes;
    end += codePoint.length;
  }

  return { text: content, truncated: false };
}

function CodeBlock({ blockKey, language, text, copied, copyFailed, onCopy }: CodeBlockProps) {
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{language || strings.markdown.code}</span>
        <button type="button" className={styles.copyButton} onClick={() => onCopy(text, blockKey)}>
          {copyFailed
            ? strings.markdown.copyFailed
            : copied
              ? strings.markdown.copied
              : strings.markdown.copy}
        </button>
      </div>
      <pre className={styles.pre}>
        <code>{text}</code>
      </pre>
    </div>
  );
}
