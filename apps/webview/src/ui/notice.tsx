import type { HTMLAttributes, ReactNode } from "react";
import styles from "./notice.module.css";

export interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
  readonly variant?: "info" | "warning" | "error";
  readonly title?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

export function Notice({
  variant = "info",
  title,
  action,
  className,
  children,
  role = variant === "error" ? "alert" : "status",
  ...props
}: NoticeProps) {
  const classNames = [styles.notice, styles[variant], className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} role={role} {...props}>
      {title || action ? (
        <div className={styles.header}>
          {typeof title === "string" ? <strong className={styles.title}>{title}</strong> : title}
          {action}
        </div>
      ) : null}
      <div>{children}</div>
    </div>
  );
}
