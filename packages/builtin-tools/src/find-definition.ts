import type { IdeLanguageServicePort, LanguageServiceInput } from "./language-service.js";
import {
  createLanguageLocationTool,
  type LanguageLocationOperation,
  languageLocationInputSchema,
} from "./language-service.js";

export const findDefinitionToolName = "find_definition" as const;
export const findDefinitionToolDescription =
  "Find bounded definitions for a workspace document position.";

export type FindDefinitionInput = LanguageServiceInput;
export const findDefinitionInputSchema = languageLocationInputSchema;

export function createFindDefinitionTool(port: IdeLanguageServicePort) {
  return createLanguageLocationTool(
    "definition" satisfies LanguageLocationOperation,
    findDefinitionToolName,
    findDefinitionToolDescription,
    (service, input, signal) => service.findDefinition(input, signal),
    port,
  );
}
