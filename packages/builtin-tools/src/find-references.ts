import type { IdeLanguageServicePort, LanguageServiceInput } from "./language-service.js";
import {
  createLanguageLocationTool,
  type LanguageLocationOperation,
  languageLocationInputSchema,
} from "./language-service.js";

export const findReferencesToolName = "find_references" as const;
export const findReferencesToolDescription =
  "Find bounded references for a workspace document position.";

export type FindReferencesInput = LanguageServiceInput;
export const findReferencesInputSchema = languageLocationInputSchema;

export function createFindReferencesTool(port: IdeLanguageServicePort) {
  return createLanguageLocationTool(
    "references" satisfies LanguageLocationOperation,
    findReferencesToolName,
    findReferencesToolDescription,
    (service, input, signal) => service.findReferences(input, signal),
    port,
  );
}
