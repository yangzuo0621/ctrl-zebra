import { type StoreApi, useStore } from "zustand";

import styles from "./app.module.css";
import { strings } from "./strings.js";
import { Button } from "./ui/button.js";
import type { WorkspaceFileReferenceState } from "./workspace-file-reference-store.js";

interface WorkspaceFileReferenceCardProps {
  readonly store: StoreApi<WorkspaceFileReferenceState>;
}

export function WorkspaceFileReferenceCard({ store }: WorkspaceFileReferenceCardProps) {
  const cards = useStore(store, (state) => state.cards);
  const readPending = useStore(store, (state) => state.readPending);
  const acceptStale = useStore(store, (state) => state.useStale);
  if (cards.length === 0) return null;

  return (
    <section className={styles.workspaceFiles} aria-label={strings.workspaceFiles.heading}>
      {cards.map((card) => {
        const source = card.reference.context.source;
        const stale = source.stale;
        return (
          <article
            className={styles.workspaceFileCard}
            key={card.reference.referenceId}
            aria-label={strings.workspaceFiles.cardLabel}
          >
            <div className={styles.workspaceFileHeading}>
              <span>{source.uri.path}</span>
              <span>{stale ? strings.workspaceFiles.stale : strings.workspaceFiles.ready}</span>
            </div>
            <dl className={styles.workspaceFileDetails}>
              <div>
                <dt>{strings.workspaceFiles.source}</dt>
                <dd>{source.uri.path}</dd>
              </div>
              <div>
                <dt>{strings.workspaceFiles.truncated}</dt>
                <dd>{source.truncated ? "yes" : "no"}</dd>
              </div>
            </dl>
            <div className={styles.actions}>
              <Button
                variant="secondary"
                size="sm"
                disabled={readPending}
                onClick={() => store.getState().refresh(card.reference.referenceId)}
              >
                {strings.workspaceFiles.refresh}
              </Button>
              {stale && !card.staleAccepted ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => acceptStale(card.reference.referenceId)}
                >
                  {strings.workspaceFiles.useStale}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => store.getState().remove(card.reference.referenceId)}
              >
                {strings.workspaceFiles.remove}
              </Button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
