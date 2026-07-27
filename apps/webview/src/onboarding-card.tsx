import styles from "./onboarding-card.module.css";
import { EmptyState } from "./ui/empty-state.js";

interface OnboardingCardProps {
  readonly onSelectPrompt: (prompt: string) => void;
}

const EXAMPLE_PROMPTS = [
  "Explain workspace structure",
  "Analyze codebase for lint issues",
  "Summarize key modules and entry points",
] as const;

export function OnboardingCard({ onSelectPrompt }: OnboardingCardProps) {
  return (
    <div className={styles.container}>
      <EmptyState
        title="Welcome to CtrlZebra"
        description="Ask a question or select a sample task below to get started."
        action={
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
        }
      />
    </div>
  );
}
