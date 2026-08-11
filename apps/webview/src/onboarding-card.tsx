import type {
  ProviderAction,
  ProviderActionMessage,
  ProviderStatusMessage,
} from "@ctrl-zebra/protocol";
import { useEffect, useRef } from "react";

import styles from "./onboarding-card.module.css";
import type { PendingProviderAction } from "./onboarding-store.js";
import { strings } from "./strings.js";
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
  const fallbackOutcomeRequestId = useRef<string | undefined>(undefined);
  const providerLabel =
    status === undefined
      ? strings.onboarding.provider
      : strings.onboarding.providerLabels[status.provider];
  const missingItems = [
    ...(status?.apiKeyConfigured === false ? [strings.onboarding.missing.apiKey] : []),
    ...(status?.modelConfigured === false ? [strings.onboarding.missing.model] : []),
  ];

  useEffect(() => {
    if (actionOutcome === undefined) {
      return;
    }
    const trigger = actionButtonRefs.current[actionOutcome.action];
    const isNewOutcome = actionOutcome.requestId !== lastOutcomeRequestId.current;
    if (isNewOutcome) {
      lastOutcomeRequestId.current = actionOutcome.requestId;
      if (trigger?.isConnected) {
        trigger.focus();
      } else {
        headingRef.current?.focus();
      }
      return;
    }
    if (
      actionOutcome.action === "save-key" &&
      status?.apiKeyConfigured === true &&
      fallbackOutcomeRequestId.current !== actionOutcome.requestId
    ) {
      fallbackOutcomeRequestId.current = actionOutcome.requestId;
      headingRef.current?.focus();
    } else if (trigger?.isConnected) {
      trigger.focus();
    }
  }, [actionOutcome, status]);

  const handleAction = (action: ProviderAction, event: React.MouseEvent<HTMLButtonElement>) => {
    if (onAction(action)) {
      actionButtonRefs.current[action] = event.currentTarget;
    }
  };

  const setupDescription =
    status === undefined
      ? strings.onboarding.checking
      : missingItems.length === 0
        ? strings.onboarding.ready(providerLabel)
        : strings.onboarding.finishSetup(missingItems.join(" and "));

  return (
    <div className={styles.container}>
      <EmptyState
        className={styles.emptyState}
        title={
          <h2 ref={headingRef} className={styles.title} tabIndex={-1}>
            {strings.onboarding.welcome}
          </h2>
        }
        description={strings.onboarding.description}
        action={
          <>
            <section className={styles.providerStatus} aria-labelledby="provider-setup-title">
              <h3 id="provider-setup-title">{strings.onboarding.setup(providerLabel)}</h3>
              <p>{setupDescription}</p>
              {status === undefined ? null : (
                <ul>
                  <li>
                    {status.apiKeyConfigured
                      ? strings.onboarding.apiKeySaved
                      : strings.onboarding.apiKeyNotSaved}
                  </li>
                  <li>
                    {status.modelConfigured
                      ? strings.onboarding.modelSelected
                      : strings.onboarding.modelNotSelected}
                  </li>
                </ul>
              )}
              <fieldset className={styles.providerActions}>
                <legend className={styles.srOnly}>{strings.onboarding.actionsLegend}</legend>
                {(Object.keys(strings.onboarding.actionLabels) as ProviderAction[])
                  .filter((action) => action !== "save-key" || status?.apiKeyConfigured === false)
                  .map((action) => (
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
                        ? `${strings.onboarding.actionLabels[action]}…`
                        : strings.onboarding.actionLabels[action]}
                    </Button>
                  ))}
              </fieldset>
              <p className={styles.srOnly} aria-live="polite">
                {announcement}
              </p>
              {actionOutcome?.status === "failed" ? (
                <p className={styles.error} role="alert">
                  {strings.onboarding.failureMessages[actionOutcome.code]}
                </p>
              ) : null}
            </section>
            <fieldset className={styles.examples} aria-label={strings.onboarding.sampleTasks}>
              {strings.onboarding.examples.map((prompt) => (
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
