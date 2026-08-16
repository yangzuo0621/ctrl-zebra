import { z } from "zod";

import { maxTokenCount, tokenCountSchema } from "./usage.js";

/**
 * A Run budget is expressed only in tokens.  Provider prices and billing are intentionally absent:
 * an estimate is a local safety signal, while a Provider Usage value remains explicitly actual.
 */
export const runTokenBudgetConfigurationSchema = z
  .strictObject({
    maxTokens: tokenCountSchema,
    warningTokens: tokenCountSchema,
  })
  .superRefine((configuration, context) => {
    if (configuration.maxTokens < 1) {
      context.addIssue({
        code: "custom",
        path: ["maxTokens"],
        message: "A Run token limit must be positive.",
      });
    }
    if (configuration.warningTokens < 1) {
      context.addIssue({
        code: "custom",
        path: ["warningTokens"],
        message: "A Run token warning must be positive.",
      });
    }
    if (configuration.warningTokens > configuration.maxTokens) {
      context.addIssue({
        code: "custom",
        path: ["warningTokens"],
        message: "A Run token warning cannot exceed the Run token limit.",
      });
    }
  });

export type RunTokenBudgetConfiguration = z.infer<typeof runTokenBudgetConfigurationSchema>;

export const runTokenBudgetSourceSchema = z.enum(["estimate", "actual"]);
export type RunTokenBudgetSource = z.infer<typeof runTokenBudgetSourceSchema>;

export const runTokenBudgetStateSchema = z.enum(["warning", "exceeded"]);
export type RunTokenBudgetState = z.infer<typeof runTokenBudgetStateSchema>;

/** The bounded, user-visible state emitted when a Run reaches its warning or hard limit. */
export const runTokenBudgetSnapshotSchema = z
  .strictObject({
    state: runTokenBudgetStateSchema,
    source: runTokenBudgetSourceSchema,
    maxTokens: tokenCountSchema,
    warningTokens: tokenCountSchema,
    estimatedTokens: tokenCountSchema,
    actualTokens: tokenCountSchema.optional(),
    effectiveTokens: tokenCountSchema,
  })
  .superRefine((snapshot, context) => {
    if (snapshot.maxTokens < 1) {
      context.addIssue({
        code: "custom",
        path: ["maxTokens"],
        message: "A Run token limit must be positive.",
      });
    }
    if (snapshot.warningTokens < 1 || snapshot.warningTokens > snapshot.maxTokens) {
      context.addIssue({
        code: "custom",
        path: ["warningTokens"],
        message: "A Run token warning must be within the Run token limit.",
      });
    }
    if (snapshot.effectiveTokens > maxTokenCount) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTokens"],
        message: "A Run token projection exceeds the supported count.",
      });
    }
    const observedTokens = Math.max(snapshot.estimatedTokens, snapshot.actualTokens ?? 0);
    const boundedActualOverflow =
      snapshot.state === "exceeded" &&
      snapshot.source === "actual" &&
      snapshot.actualTokens === undefined &&
      snapshot.effectiveTokens === maxTokenCount;
    if (!boundedActualOverflow && snapshot.effectiveTokens !== observedTokens) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTokens"],
        message: "A Run token projection must equal the greatest observed count.",
      });
    }
    if (snapshot.state === "warning" && snapshot.effectiveTokens < snapshot.warningTokens) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "A warning snapshot must reach the configured warning threshold.",
      });
    }
    if (snapshot.state === "exceeded" && snapshot.effectiveTokens < snapshot.maxTokens) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "An exceeded snapshot must reach the configured Run token limit.",
      });
    }
  });

export type RunTokenBudgetSnapshot = z.infer<typeof runTokenBudgetSnapshotSchema>;

/** Additive alias used by callers that describe the same policy as a Run budget. */
export const runBudgetConfigurationSchema = runTokenBudgetConfigurationSchema;
export const runBudgetSnapshotSchema = runTokenBudgetSnapshotSchema;
export type RunBudgetConfiguration = RunTokenBudgetConfiguration;
export type RunBudgetSnapshot = RunTokenBudgetSnapshot;
