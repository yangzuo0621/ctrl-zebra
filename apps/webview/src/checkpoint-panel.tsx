import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import styles from "./checkpoint-panel.module.css";
import type { CheckpointState } from "./checkpoint-store.js";
import { strings } from "./strings.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";

export function CheckpointPanel({ store }: { readonly store: StoreApi<CheckpointState> }) {
  const checkpoints = useStore(store, (state) => state.checkpoints);
  const selected = useStore(store, (state) => state.selectedCheckpointId);
  const status = useStore(store, (state) => state.status);
  const message = useStore(store, (state) => state.message);
  const selectedCheckpoint = checkpoints.find(({ id }) => id === selected);
  const statusMessage = message ?? (status === "loading" ? strings.checkpoint.loading : undefined);

  return (
    <section className={styles.panel} aria-labelledby="checkpoints-title">
      <div className={styles.panelHeader}>
        <h2 id="checkpoints-title">{strings.checkpoint.heading}</h2>
        {status === "restoring" ? (
          <Badge variant="info">{strings.checkpoint.restoring}</Badge>
        ) : selectedCheckpoint ? (
          <Badge variant="default">
            {strings.checkpoint.fileCount(selectedCheckpoint.files.length)}
          </Badge>
        ) : null}
      </div>

      <div className={styles.controls}>
        <select
          aria-label={strings.checkpoint.label}
          value={selected ?? ""}
          onChange={(event) => store.getState().select(event.target.value)}
          disabled={checkpoints.length === 0 || status === "restoring"}
        >
          {checkpoints.length === 0 ? (
            <option value="">{strings.checkpoint.noCheckpoints}</option>
          ) : null}
          {checkpoints.map((checkpoint) => (
            <option key={checkpoint.id} value={checkpoint.id}>
              {new Date(checkpoint.createdAt).toLocaleString()} —{" "}
              {strings.checkpoint.fileCount(checkpoint.files.length)}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => store.getState().load()}
          disabled={status === "restoring"}
        >
          {strings.checkpoint.refresh}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => store.getState().restoreSelected()}
          disabled={selected === undefined || status === "restoring"}
        >
          {strings.checkpoint.restore}
        </Button>
      </div>
      {selectedCheckpoint === undefined ? null : (
        <ul className={styles.targets} aria-label={strings.checkpoint.targetsLabel}>
          {selectedCheckpoint.files.map((file) => (
            <li key={file.uri}>{file.uri}</li>
          ))}
        </ul>
      )}
      {statusMessage === undefined ? null : (
        <p className={styles.status} role="status" aria-live="polite">
          {statusMessage}
        </p>
      )}
    </section>
  );
}
