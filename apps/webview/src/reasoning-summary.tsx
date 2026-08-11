import { useId, useState } from "react";

import type { DisplayReasoningBlock } from "./chat-store.js";
import styles from "./reasoning-summary.module.css";
import { formatReasoningBlockState, strings } from "./strings.js";

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
      onAnnounce(strings.reasoning.copied);
    } catch {
      onAnnounce(strings.reasoning.copyFailed);
    } finally {
      setCopyingBlockId(undefined);
    }
  };

  return (
    <section className={styles.summary} aria-label={strings.reasoning.regionLabel}>
      <div className={styles.heading}>
        <h3 className={styles.title}>{strings.reasoning.title}</h3>
        <span className={styles.source}>{strings.reasoning.providedBy}</span>
      </div>

      <ol className={styles.blocks}>
        {blocks.map((block, index) => {
          const contentId = `${summaryId}-reasoning-${index + 1}`;
          const position = blocks.length > 1 ? ` ${index + 1}` : "";
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
                  {strings.reasoning.toggle(block.expanded, position)}
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
                    {copyingBlockId === block.blockId
                      ? strings.reasoning.copying
                      : strings.reasoning.copy}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {runTruncated ? <p className={styles.notice}>{strings.reasoning.truncated}</p> : null}
    </section>
  );
}

function blockStateText(block: DisplayReasoningBlock): string {
  return formatReasoningBlockState(block.state, block.truncated);
}
