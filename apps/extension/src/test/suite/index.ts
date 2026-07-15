import { verifyExtensionActivation } from "./activation.test.js";
import { verifyAgentViewRegistration } from "./agent-view.test.js";

export async function run(): Promise<void> {
  await verifyExtensionActivation();
  await verifyAgentViewRegistration();
}
