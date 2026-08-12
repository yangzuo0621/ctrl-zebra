import type { IdeLanguageServicePort, ListSymbolsInput } from "./language-service.js";
import { createListSymbolsTool, listSymbolsInputSchema } from "./language-service.js";

export const listSymbolsToolName = "list_symbols" as const;
export const listSymbolsToolDescription = "List bounded symbols for one workspace document.";

export type { ListSymbolsInput };
export { listSymbolsInputSchema };

export function createListSymbolsBuiltinTool(port: IdeLanguageServicePort) {
  return createListSymbolsTool(port);
}

export { createListSymbolsTool } from "./language-service.js";
