import assert from "node:assert/strict";
import { test } from "node:test";

import { resolvePnpmCommand } from "./pnpm-command.mjs";

test("runs a JavaScript pnpm CLI through Node.js", () => {
  assert.deepEqual(
    resolvePnpmCommand(["test"], {
      npmExecPath: "C:\\tools\\pnpm.cjs",
      nodeExecutable: "C:\\node\\node.exe",
      platform: "win32",
    }),
    {
      executable: "C:\\node\\node.exe",
      args: ["C:\\tools\\pnpm.cjs", "test"],
    },
  );
});

test("runs the pnpm 12 Windows executable directly", () => {
  assert.deepEqual(
    resolvePnpmCommand(["build"], {
      npmExecPath: "C:\\tools\\pnpm.exe",
      nodeExecutable: "C:\\node\\node.exe",
      platform: "win32",
    }),
    {
      executable: "C:\\tools\\pnpm.exe",
      args: ["build"],
    },
  );
});

test("runs the pnpm 12 POSIX executable directly", () => {
  assert.deepEqual(
    resolvePnpmCommand(["typecheck"], {
      npmExecPath: "/opt/pnpm/pnpm",
      nodeExecutable: "/usr/bin/node",
      platform: "linux",
    }),
    {
      executable: "/opt/pnpm/pnpm",
      args: ["typecheck"],
    },
  );
});

test("falls back to the pnpm 12 executable name", () => {
  assert.deepEqual(
    resolvePnpmCommand(["check"], {
      npmExecPath: "",
      nodeExecutable: "C:\\node\\node.exe",
      platform: "win32",
    }),
    {
      executable: "pnpm.exe",
      args: ["check"],
    },
  );
});
