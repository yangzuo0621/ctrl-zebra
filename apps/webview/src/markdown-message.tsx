import { useState } from "react";
import styles from "./markdown-message.module.css";
import { strings } from "./strings.js";

interface MarkdownMessageProps {
  readonly content: string;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (text: string, index: number) => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  // Safe parsing of markdown subset without raw HTML execution
  const blocks = parseMarkdown(content);

  return (
    <div className={styles.container}>
      {blocks.map((block, i) => {
        const key = `block-${i}`;
        if (block.type === "code") {
          return (
            <div key={key} className={styles.codeBlock}>
              <div className={styles.codeHeader}>
                <span>{block.lang || strings.markdown.code}</span>
                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={() => handleCopy(block.text, i)}
                >
                  {copiedIndex === i ? strings.markdown.copied : strings.markdown.copy}
                </button>
              </div>
              <pre className={styles.pre}>
                <code>{block.text}</code>
              </pre>
            </div>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={key} className={styles.list}>
              {block.items.map((item, itemIdx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static list item
                <li key={`item-${itemIdx}`}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={key} className={styles.paragraph}>
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "list"; items: string[] };

function parseMarkdown(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];

  let inCode = false;
  let codeLang = "";
  let codeBuffer: string[] = [];
  let paragraphBuffer: string[] = [];
  let listBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      blocks.push({ type: "paragraph", text: paragraphBuffer.join("\n") });
      paragraphBuffer = [];
    }
  };

  const flushList = () => {
    if (listBuffer.length > 0) {
      blocks.push({ type: "list", items: listBuffer });
      listBuffer = [];
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        blocks.push({
          type: "code",
          lang: codeLang,
          text: codeBuffer.join("\n"),
        });
        codeBuffer = [];
        inCode = false;
        codeLang = "";
      } else {
        flushParagraph();
        flushList();
        inCode = true;
        codeLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
      flushParagraph();
      listBuffer.push(line.trim().slice(2));
      continue;
    }

    if (listBuffer.length > 0) {
      flushList();
    }

    if (line.trim().length === 0) {
      flushParagraph();
    } else {
      paragraphBuffer.push(line);
    }
  }

  if (inCode) {
    blocks.push({ type: "code", lang: codeLang, text: codeBuffer.join("\n") });
  } else {
    flushParagraph();
    flushList();
  }

  return blocks;
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: static inline code part
        <code key={`code-${index}`} className={styles.inlineCode}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
