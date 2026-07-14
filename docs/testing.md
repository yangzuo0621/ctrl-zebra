# Testing Guidelines

This document defines the shared constraints for CtrlZebra automated tests. Tests must be fast, deterministic, isolated, and follow the same module boundaries as production code.

## Test Layers

- **Unit tests** verify one host-independent module or a small group of collaborators. They are the default test layer for `packages/*`. Core, Protocol, and policy tests must not start VS Code.
- **Component tests** verify Webview components through user-visible behavior. After React test infrastructure is introduced, use Testing Library and avoid assertions against component internals.
- **Adapter integration tests** verify translations between Provider, storage, or VS Code API adapters and internal contracts. Provider tests use recorded or hand-written SDK responses and never access a real model.
- **Extension integration tests** cover only VS Code API adapters, registrations, and lifecycle behavior. They run only after the corresponding roadmap task introduces the Extension Development Host.

Do not move to a more expensive test layer when a lower-level test can fully prove the behavior. Manual smoke tests do not replace applicable automated tests.

## Naming and Placement

- Name test files `*.test.ts` or `*.test.tsx` and place them in the tested package's `src/` tree.
- Describe observable behavior and conditions in test names instead of restating implementation details.
- The shared Vitest configuration discovers `packages/*/src/**/*.test.ts`. Later tasks that introduce application test infrastructure own the corresponding application test configuration.
- Do not permanently skip tests or commit a temporary skip without an owner, task or issue ID, reason, and removal condition.

## Fake and Mock Boundaries

- Prefer explicit behavioral Fakes for stable internal ports, such as fixed clocks, fixed ID generators, in-memory repositories, and collecting event sinks.
- Use Mocks only when a test must verify interactions at a host or third-party boundary, such as a model SDK, the VS Code API, or a process boundary.
- Do not mock the tested object's internal implementation, private methods, or pure data transformations. Assert through public behavior instead.
- Default tests must not access the network, real models, user credentials, or user machine state. Test doubles must supply third-party responses.

## Determinism and Isolation

- Fix or inject time, IDs, random values, and external input. Tests must not depend on execution order, wall-clock time, or the machine time zone.
- Each test owns and cleans up its mutable state, temporary resources, and test-double records. Do not share mutable global state across tests.
- Do not hide races with arbitrary delays or increased timeouts. Wait for observable signals from the module that owns each asynchronous state transition.
- Assertions must verify important behavior and boundaries. Do not replace important behavioral assertions with snapshots.

## Regression Tests

- When fixing a defect, first add the smallest regression test that fails before the fix, then implement the fix.
- A regression test records the triggering condition and expected external behavior without binding to incidental internal structure.
- In addition to the normal path, new logic must cover an important boundary and an expected failure path. Add more coverage in proportion to risk.

## Asynchronous Work and Cleanup

- Tests involving cancellation must verify the cancellation outcome, resource cleanup, and that no further deltas, tool calls, or other side effects occur after cancellation.
- Tests must await or explicitly cancel every Promise, timer, stream, listener, and child process they create. Unobserved asynchronous work is forbidden.
- Cleanup must be idempotent and run after success, failure, timeout, and cancellation. Failure, timeout, and cancellation must remain distinguishable outcomes.
- Tests must not leave open handles, temporary files, or state visible to later tests.
