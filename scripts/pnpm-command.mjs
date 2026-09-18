import { extname } from "node:path";

const javaScriptExtensions = new Set([".cjs", ".js", ".mjs"]);

export function resolvePnpmCommand(
  args,
  {
    npmExecPath = process.env.npm_execpath,
    nodeExecutable = process.execPath,
    platform = process.platform,
  } = {},
) {
  const pnpmExecutable = npmExecPath?.trim();
  if (!pnpmExecutable) {
    return {
      executable: platform === "win32" ? "pnpm.exe" : "pnpm",
      args,
    };
  }

  if (javaScriptExtensions.has(extname(pnpmExecutable).toLowerCase())) {
    return {
      executable: nodeExecutable,
      args: [pnpmExecutable, ...args],
    };
  }

  return { executable: pnpmExecutable, args };
}
