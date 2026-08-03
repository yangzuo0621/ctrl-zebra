import { createHash } from "node:crypto";

import type { ToolName } from "@ctrl-zebra/core";

export function createMcpRegistryName(serverId: string, mcpToolName: string): ToolName {
  const hash = createHash("sha256")
    .update(serverId, "utf8")
    .update(new Uint8Array([0]))
    .update(mcpToolName, "utf8")
    .digest("hex")
    .slice(0, 12);
  const slug = mcpToolName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 47);

  return `mcp_${slug === "" ? "tool" : slug}_${hash}`;
}
