import type {
  ProviderAction,
  ProviderActionMessage,
  ProviderStatusMessage,
} from "@ctrl-zebra/protocol";
import { useEffect, useRef } from "react";

import styles from "./onboarding-card.module.css";
import type { PendingProviderAction } from "./onboarding-store.js";
import { Button } from "./ui/button.js";
import { EmptyState } from "./ui/empty-state.js";

interface OnboardingCardProps {
  readonly onSelectPrompt: (prompt: string) => void;
  readonly status?: ProviderStatusMessage;
  readonly pendingAction?: PendingProviderAction;
  readonly actionOutcome?: ProviderActionMessage;
  readonly announcement: string;
  readonly onAction: (action: ProviderAction) => boolean;
}

const EXAMPLE_PROMPTS = [
  "Explain workspace structure",
  "Analyze codebase for lint issues",
  "Summarize key modules and entry points",
] as const;

const providerLabels = {
  openai: "OpenAI",
  gemini: "Gemini",
  "openai-compatible": "OpenAI-Compatible",
} as const;

const actionLabels = {
  "save-key": "Save or replace API key",
  "select-model": "Select model",
  "open-settings": "Open Provider settings",
} as const satisfies Record<ProviderAction, string>;

const failureMessages = {
  configuration: "Check the Provider settings and try again.",
  storage: "The Provider setting could not be saved. Try again.",
  unavailable: "Model discovery is unavailable. Try again or enter a model ID manually.",
  internal: "The Provider action failed unexpectedly. Try again.",
} as const;

export function OnboardingCard({
  onSelectPrompt,
  status,
  pendingAction,
  actionOutcome,
  announcement,
  onAction,
}: OnboardingCardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const actionButtonRefs = useRef<Partial<Record<ProviderAction, HTMLButtonElement | null>>>({});
  const lastOutcomeRequestId = useRef<string | undefined>(undefined);
  const providerLabel = status === undefined ? "Provider" : providerLabels[status.provider];
  const missingItems = [
    ...(status?.apiKeyConfigured === false ? ["API key"] : []),
    ...(status?.modelConfigured === false ? ["model"] : []),
  ];

  useEffect(() => {
    if (actionOutcome === undefined || actionOutcome.requestId === lastOutcomeRequestId.current) {
      return;
    }
    lastOutcomeRequestId.current = actionOutcome.requestId;
    const trigger = actionButtonRefs.current[actionOutcome.action];
    if (trigger?.isConnected) {
      trigger.focus();
    } else {
      headingRef.current?.focus();
    }
  }, [actionOutcome]);

  const handleAction = (action: ProviderAction, event: React.MouseEvent<HTMLButtonElement>) => {
    if (onAction(action)) {
      actionButtonRefs.current[action] = event.currentTarget;
    }
  };

  const setupDescription =
    status === undefined
      ? "Checking the saved Provider setup…"
      : missingItems.length === 0
        ? `${providerLabel} is ready for a chat.`
        : `Finish ${missingItems.join(" and ")} setup to start a chat.`;

  return (
    <div className={styles.container}>
      <EmptyState
        title={
          <h2 ref={headingRef} className={styles.title} tabIndex={-1}>
            Welcome to CtrlZebra
          </h2>
        }
        description="Ask a question or select a sample task below to get started."
        action={
          <>
            <section className={styles.providerStatus} aria-labelledby="provider-setup-title">
              <h3 id="provider-setup-title">{providerLabel} setup</h3>
              <p>{setupDescription}</p>
              {status === undefined ? null : (
                <ul>
                  <li>{status.apiKeyConfigured ? "API key saved." : "API key not saved."}</li>
                  <li>{status.modelConfigured ? "Model selected." : "Model not selected."}</li>
                </ul>
              )}
              <fieldset className={styles.providerActions}>
                <legend className={styles.srOnly}>Provider actions</legend>
                {(Object.keys(actionLabels) as ProviderAction[]).map((action) => (
                  <Button
                    key={action}
                    className={styles.providerAction}
                    variant={action === "open-settings" ? "secondary" : "primary"}
                    size="sm"
                    disabled={status === undefined || pendingAction !== undefined}
                    aria-busy={pendingAction?.action === action}
                    onClick={(event) => handleAction(action, event)}
                  >
                    {pendingAction?.action === action
                      ? `${actionLabels[action]}…`
                      : actionLabels[action]}
                  </Button>
                ))}
              </fieldset>
              <p className={styles.srOnly} aria-live="polite">
                {announcement}
              </p>
              {actionOutcome?.status === "failed" ? (
                <p className={styles.error} role="alert">
                  {failureMessages[actionOutcome.code]}
                </p>
              ) : null}
            </section>
            <fieldset className={styles.examples} aria-label="Sample tasks">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className={styles.promptButton}
                  onClick={() => onSelectPrompt(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </fieldset>
          </>
        }
      />
    </div>
  );
}
