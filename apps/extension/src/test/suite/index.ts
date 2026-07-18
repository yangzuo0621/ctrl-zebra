import { verifyExtensionActivation } from "./activation.test.js";
import { verifyAgentViewRegistration } from "./agent-view.test.js";
import { verifyOllamaReadonlyToolSmoke } from "./ollama-readonly-tool-smoke.test.js";
import { verifyReadonlyToolRegistration } from "./readonly-tool-registry.test.js";

export async function run(): Promise<void> {
  await verifyExtensionActivation();
  await verifyAgentViewRegistration();
  await verifyReadonlyToolRegistration();
  await verifyOllamaReadonlyToolSmoke();
}
