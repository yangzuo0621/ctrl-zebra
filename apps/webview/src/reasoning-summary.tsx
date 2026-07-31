import { useId, useState } from "react";

import type { DisplayReasoningBlock } from "./chat-store.js";
import styles from "./reasoning-summary.module.css";

interface ReasoningSummaryProps {
  readonly blocks: readonly DisplayReasoningBlock[];
  readonly runTruncated: boolean;
  readonly onToggle: (blockId: string) => void;
  readonly onAnnounce: (message: string) => void;
}

export function ReasoningSummary({
  blocks,
  runTruncated,
  onToggle,
  onAnnounce,
}: ReasoningSummaryProps) {
  const summaryId = useId();
  const [copyingBlockId, setCopyingBlockId] = useState<string>();

  if (blocks.length === 0) {
    return null;
  }

  const copyBlock = async (block: DisplayReasoningBlock) => {
    if (copyingBlockId !== undefined) {
      return;
    }
    setCopyingBlockId(block.blockId);
    try {
      await navigator.clipboard.writeText(block.content);
      onAnnounce("推理摘要已复制。");
    } catch {
      onAnnounce("无法复制推理摘要。");
    } finally {
      setCopyingBlockId(undefined);
    }
  };

  return (
    <section className={styles.summary} aria-label="推理摘要">
      <div className={styles.heading}>
        <h3 className={styles.title}>推理摘要</h3>
        <span className={styles.source}>模型提供</span>
      </div>

      <ol className={styles.blocks}>
        {blocks.map((block, index) => {
          const contentId = `${summaryId}-reasoning-${index + 1}`;
          const position = blocks.length > 1 ? ` ${index + 1}` : "";
          const action = block.expanded ? "折叠" : "展开";
          return (
            <li
              className={styles.block}
              key={block.blockId}
              aria-busy={block.state === "streaming"}
            >
              <div className={styles.blockHeader}>
                <button
                  type="button"
                  className={styles.disclosure}
                  aria-expanded={block.expanded}
                  aria-controls={contentId}
                  onClick={() => onToggle(block.blockId)}
                >
                  <span aria-hidden="true">{block.expanded ? "▾" : "▸"}</span>
                  {`${action}推理摘要${position}`}
                </button>
                <span className={styles.state}>{blockStateText(block)}</span>
              </div>

              {block.expanded ? (
                <div className={styles.contentPanel} id={contentId}>
                  <pre className={styles.content}>{block.content}</pre>
                  <button
                    type="button"
                    className={styles.copy}
                    disabled={copyingBlockId !== undefined}
                    onClick={() => copyBlock(block)}
                  >
                    {copyingBlockId === block.blockId ? "正在复制…" : "复制摘要"}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {runTruncated ? <p className={styles.notice}>部分推理摘要已因运行限制省略。</p> : null}
    </section>
  );
}

function blockStateText(block: DisplayReasoningBlock): string {
  const state =
    block.state === "streaming"
      ? "正在生成摘要"
      : block.state === "partial"
        ? "部分摘要"
        : "摘要已完成";
  return block.truncated ? `${state} · 内容已截断` : state;
}
