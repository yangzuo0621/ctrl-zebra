import { type StoreApi, useStore } from "zustand";

import styles from "./diagnostic-export-panel.module.css";
import type { DiagnosticsExportState } from "./diagnostic-export-store.js";
import { strings } from "./strings.js";
import { Button } from "./ui/button.js";

interface DiagnosticsExportPanelProps {
  readonly store: StoreApi<DiagnosticsExportState>;
}

export function DiagnosticsExportPanel({ store }: DiagnosticsExportPanelProps) {
  const state = useStore(store);
  const documentText = state.content ?? "";
  const isBusy = state.status === "preparing" || state.status === "exporting";

  return (
    <section className={styles.panel} aria-labelledby="diagnostics-export-title">
      <div className={styles.headingRow}>
        <h2 id="diagnostics-export-title">{strings.diagnosticsExport.heading}</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => store.getState().start()}
          disabled={isBusy || state.status === "ready"}
        >
          {state.status === "preparing"
            ? strings.diagnosticsExport.preparing
            : strings.diagnosticsExport.open}
        </Button>
      </div>

      {state.status === "ready" && state.document !== undefined ? (
        <div className={styles.preview} aria-live="polite">
          <p className={styles.notice}>{strings.diagnosticsExport.previewNotice}</p>
          <p className={styles.target}>
            <strong>{strings.diagnosticsExport.target}:</strong> {state.target}
          </p>
          <section className={styles.content} aria-label={strings.diagnosticsExport.contentLabel}>
            <pre>{documentText}</pre>
          </section>
          <div className={styles.actions}>
            <Button size="sm" onClick={() => store.getState().confirm()}>
              {strings.diagnosticsExport.confirm}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => store.getState().cancel()}>
              {strings.diagnosticsExport.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      {state.status === "exporting" ? (
        <p className={styles.status} role="status">
          {strings.diagnosticsExport.exporting}
        </p>
      ) : null}
      {state.message !== undefined && state.status !== "ready" ? (
        <p className={styles.status} role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
