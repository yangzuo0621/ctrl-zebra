import { verifyExtensionActivation } from "./activation.test.js";

export async function run(): Promise<void> {
  await verifyExtensionActivation();
}
