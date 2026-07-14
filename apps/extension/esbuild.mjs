import { build } from "esbuild";

const sharedOptions = {
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  logLevel: "info",
  platform: "node",
  sourcemap: true,
  target: "node22",
};

await Promise.all([
  build({
    ...sharedOptions,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.cjs",
  }),
  build({
    ...sharedOptions,
    entryPoints: ["src/test/suite/index.ts"],
    outfile: "dist/test/suite/index.cjs",
  }),
]);
