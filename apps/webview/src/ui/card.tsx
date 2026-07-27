import type { HTMLAttributes, ReactNode } from "react";
import styles from "./card.module.css";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly variant?: "default" | "interactive" | "warning" | "error";
  readonly title?: ReactNode;
  readonly headerAction?: ReactNode;
  readonly children: ReactNode;
}

export function Card({
  variant = "default",
  title,
  headerAction,
  className,
  children,
  ...props
}: CardProps) {
  const classNames = [styles.card, styles[variant], className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} {...props}>
      {title || headerAction ? (
        <div className={styles.header}>
          {typeof title === "string" ? <h3 className={styles.title}>{title}</h3> : title}
          {headerAction}
        </div>
      ) : null}
      {children}
    </div>
  );
}
