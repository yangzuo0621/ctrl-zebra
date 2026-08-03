import { ToolRegistry } from "@ctrl-zebra/core";

export function combineToolRegistries(...registries: readonly ToolRegistry[]): ToolRegistry {
  const combined = new ToolRegistry();
  for (const registry of registries) {
    for (const declaration of registry.declarations()) {
      const tool = registry.get(declaration.name);
      if (tool === undefined) {
        throw new Error("Tool Registry changed during composition.");
      }
      combined.register(tool);
    }
  }
  return combined;
}
