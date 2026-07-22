# Performance Baseline

This document records a diagnostic baseline for the Phase 1 desktop extension. The values are
observations from one controlled integration run, not release budgets or compatibility guarantees.

## Measurement points

- **Activation time** starts at entry to `activate()` and ends after lightweight registration and
  composition complete. It is measured with Node.js `performance.now()`.
- **First Agent view display time** uses the same activation start and ends on the first
  `resolveWebviewView()` callback. Later hide/show cycles are ignored.
- **Idle memory** is sampled immediately after activation with `process.memoryUsage.rss()`. RSS is
  the resident memory for the entire VS Code Extension Host process, so it includes VS Code and
  other loaded extension-host infrastructure rather than only CtrlZebra allocations.

All measurements are emitted to the CtrlZebra log through the structured logging contract. They do
not use timers, background polling, workspace content, heap snapshots, object data, or telemetry.

## Recorded baseline

Measured on 2026-07-22 during the repository Extension Host integration test:

| Environment | Activation | First Agent view display | Idle Extension Host RSS |
|---|---:|---:|---:|
| Windows x64, VS Code 1.125.0 | 7 ms | 136 ms | 183,836,672 bytes (175.32 MiB) |

The integration run used the bundled development extension and an isolated VS Code user-data
directory. A single run is intentionally reported without implying statistical confidence. Machine
load, VS Code version, installed extensions, caching, and OS memory accounting can materially change
the values. Repeat the same integration flow and compare multiple samples before treating a change
as a regression.

## Activation constraints

Activation registers the view, commands, protocol controller, and lazy dependency factories. The
model client is constructed only when a chat run selects a configured provider. Workspace search is
created only when a tool registry is requested for a selected workspace. Unit tests cover both lazy
boundaries, and the Extension Host integration run exercises activation and first view resolution
without model initialization or a workspace-wide scan.
