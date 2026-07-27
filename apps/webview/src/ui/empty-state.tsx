import type { HTMLAttributes, ReactNode } from "react";
import styles from "./empty-state.module.css";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  const classNames = [styles.emptyState, className].filter(Boolean).join(" ");

  return (
    <div className={classNames} {...props}>
      {typeof title === "string" ? <h4 className={styles.title}>{title}</h4> : title}
      {description ? (
        typeof description === "string" ? (
          <p className={styles.description}>{description}</p>
        ) : (
          description
        )
      ) : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
