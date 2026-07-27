import type { HTMLAttributes, ReactNode } from "react";
import styles from "./badge.module.css";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly variant?: "default" | "info" | "success" | "warning" | "error";
  readonly children: ReactNode;
}

export function Badge({
  variant = "default",
  className,
  children,
  ...props
}: BadgeProps) {
  const classNames = [styles.badge, styles[variant], className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classNames} {...props}>
      {children}
    </span>
  );
}
