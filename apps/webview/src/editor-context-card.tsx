import { type StoreApi, useStore } from "zustand";

import styles from "./editor-context-card.module.css";
import type { EditorContextState } from "./editor-context-store.js";
import { strings } from "./strings.js";
import { Button } from "./ui/button.js";

interface EditorContextCardProps {
  readonly store: StoreApi<EditorContextState>;
}

export function EditorContextCard({ store }: EditorContextCardProps) {
  const card = useStore(store, (state) => state.card);
  const announcement = useStore(store, (state) => state.announcement);
  const acceptStale = useStore(store, (state) => state.useStale);
  if (card === undefined) return null;
  const source = card.context.source;
  const range =
    source.range === undefined
      ? ""
      : `${source.range.start.line + 1}:${source.range.start.character + 1}–${source.range.end.line + 1}:${source.range.end.character + 1}`;
  return (
    <section className={styles.card} aria-label={strings.editorContext.cardLabel}>
      <div className={styles.heading}>
        <span>{strings.editorContext.heading}</span>
        <span>
          {card.status === "stale"
            ? strings.editorContext.staleLabel
            : strings.editorContext.readyLabel}
        </span>
      </div>
      <dl className={styles.details}>
        <div>
          <dt>{strings.editorContext.path}</dt>
          <dd>{source.uri.path}</dd>
        </div>
        {source.languageId === undefined ? null : (
          <div>
            <dt>{strings.editorContext.language}</dt>
            <dd>{source.languageId}</dd>
          </div>
        )}
        {range.length === 0 ? null : (
          <div>
            <dt>{strings.editorContext.range}</dt>
            <dd>{range}</dd>
          </div>
        )}
        <div>
          <dt>{strings.editorContext.truncated}</dt>
          <dd>{source.truncated ? "yes" : "no"}</dd>
        </div>
      </dl>
      {announcement.length === 0 ? null : (
        <p className={styles.status} role="status" aria-live="polite">
          {announcement}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={() => store.getState().refresh()}>
          {strings.editorContext.refresh}
        </Button>
        {card.status === "stale" && !card.staleAccepted ? (
          <Button variant="secondary" size="sm" onClick={acceptStale}>
            {strings.editorContext.useStale}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => store.getState().remove()}>
          {strings.editorContext.remove}
        </Button>
      </div>
    </section>
  );
}
