import { verifyExtensionActivation } from "./activation.test.js";
import { verifyAgentViewRegistration } from "./agent-view.test.js";
import { verifyDiffPresenter } from "./diff-presenter.test.js";
import { verifyOllamaReadonlyToolSmoke } from "./ollama-readonly-tool-smoke.test.js";
import { verifyReadonlyToolRegistration } from "./readonly-tool-registry.test.js";

export async function run(): Promise<void> {
  await verifyExtensionActivation();
  await verifyAgentViewRegistration();
  await verifyDiffPresenter();
  await verifyReadonlyToolRegistration();
  await verifyOllamaReadonlyToolSmoke();
}
