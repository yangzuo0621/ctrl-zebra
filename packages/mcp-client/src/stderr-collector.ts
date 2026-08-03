import { type McpStderrSnapshot, maxMcpStderrBytes } from "./contracts.js";

export class McpStderrCollector {
  private readonly bytes = new Uint8Array(maxMcpStderrBytes);
  private length = 0;
  private truncated = false;

  append(chunk: Uint8Array): void {
    const remaining = maxMcpStderrBytes - this.length;
    const accepted = Math.min(remaining, chunk.byteLength);

    if (accepted > 0) {
      this.bytes.set(chunk.subarray(0, accepted), this.length);
      this.length += accepted;
    }

    if (accepted < chunk.byteLength) {
      this.truncated = true;
    }
  }

  snapshot(): McpStderrSnapshot {
    return {
      text: new TextDecoder().decode(this.bytes.subarray(0, this.length)),
      truncated: this.truncated,
    };
  }
}
