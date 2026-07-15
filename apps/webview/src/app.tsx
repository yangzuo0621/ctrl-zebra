import styles from "./app.module.css";

export function App() {
  return (
    <main className={styles.shell} aria-labelledby="agent-view-title">
      <div className={styles.mark} aria-hidden="true">
        CZ
      </div>
      <div>
        <h1 className={styles.title} id="agent-view-title">
          CtrlZebra
        </h1>
        <p className={styles.description}>Your workspace agent is ready.</p>
      </div>
    </main>
  );
}
