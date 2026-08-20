# Performance and resource baseline

T2208 establishes a repeatable diagnostic baseline for the desktop VS Code Extension. The benchmark
does not change product behavior, disable security checks, or omit slow paths. It uses a fresh VS Code
Extension Host for every measured sample and writes only ignored output under `.artifacts/`.

## Reproduction

Run the pinned benchmark from the repository root:

```text
pnpm benchmark:performance -- --runs 5 --warmups 1
```

The command builds the Webview and Extension bundles, runs the Extension Host integration suite with
benchmark mode explicitly enabled, executes the bounded session/search/MCP fixtures, and package-checks
a temporary VSIX through the existing selected-file and archive policies. The final report is
`.artifacts/performance/baseline.json`; per-sample JSON and the temporary VSIX are also ignored.
`--runs` accepts 1–20 and `--warmups` accepts 0–20. CI uses three measured samples and one warmup on
Ubuntu; platform-sensitive budgets are enforced only when the runner matches the evidence environment.

The output is JSON with schema version, exact source revision, Node/OS/architecture/VS Code versions,
fixture parameters, raw distributions (`count`, `min`, `p50`, `p95`, `max`), cardinalities, sizes,
thresholds, and the platform-comparison policy. It contains no workspace content, conversation,
credentials, MCP transcript, or authorization data.

## Fixed fixtures and measurement points

The versioned fixture definition is `scripts/performance-fixtures.json`. The benchmark generates a
temporary workspace with 8 directories × 24 text files × 12 lines (192 files and 192 expected
matches), a 20-turn session with 6 assistant deltas per turn (140 events and 40 restored messages),
and the existing deterministic local MCP Server with its modern protocol catalog (3 Tools, 2
Resources, and 2 Prompts). Every expected cardinality is asserted before a successful sample is
written. All temporary paths are bounded and removed after each sample.

- **Extension activation** starts at the existing `activate()` entry timing and ends after normal
  registration/composition. The existing `PerformanceBaselineRecorder` supplies the value.
- **Webview first usable** ends when the mounted React App sends the existing explicit
  `webview/ping` readiness handshake. The Extension records that signal after the view is bound;
  later displays do not replace the first sample.
- **Long-session restore** measures the existing `createSessionRecoveryActions().restore()` projection
  over the fixed session event stream.
- **Large-workspace search** measures the existing bounded `search_files` Tool through the production
  `WorkspaceScope`, `WorkspaceFileLister`, `WorkspaceFileReader`, and `WorkspaceSearchFiles` path,
  including canonicalization, containment validation, VS Code file listing, and bounded reads.
- **MCP connection/catalog loading** measures real stdio process startup, protocol negotiation, and
  Tools/Resources/Prompts catalog discovery through the existing controlled client and fixture.
- **Steady-state/peak memory** uses Extension Host RSS. Steady state is sampled after the ready Webview
  has been idle separately and before fixture operations. Peak is sampled continuously during the
  Webview, restore, search, and MCP operations, plus a benchmark-only sampler covering activation;
  it includes VS Code and other Extension Host overhead and is not an allocation profile.
- **Webview bundle size** is the combined byte size of `main.js` and `main.css` after the production
  Vite build.
- **VSIX size** is the compressed archive size after the existing selected-file and archive allowlist
  checks; the report also records the uncompressed payload size.

## Initial recorded distribution

Measured on 2026-08-20 at corrected benchmark revision `112cb6b792cdc095508cc187ea0c62275f3146a2`,
with 5 samples after 1 warmup: Windows x64, Node 24.19.0, VS Code 1.125.0.

| Metric | Min | p50 | p95 | Max |
|---|---:|---:|---:|---:|
| Extension activation | 4 ms | 5 ms | 6 ms | 6 ms |
| Webview first usable | 428 ms | 451 ms | 519 ms | 519 ms |
| Long-session restore | 4 ms | 5 ms | 9 ms | 9 ms |
| Large-workspace search | 333 ms | 365 ms | 378 ms | 378 ms |
| MCP connection/catalog loading | 104 ms | 107 ms | 162 ms | 162 ms |
| Steady-state Extension Host RSS | 244,436,992 B | 252,825,600 B | 256,360,448 B | 256,360,448 B |
| Peak Extension Host RSS | 310,284,288 B | 316,116,992 B | 319,578,112 B | 319,578,112 B |

Artifact sizes from the same build were 566,712 B for the Webview bundle, 4,764,124 B compressed
for the VSIX, and 8,548,719 B uncompressed. The existing packaging contract remains the hard 5 MiB
compressed and 10 MiB uncompressed ceiling.

## Regression thresholds and platform noise

The initial thresholds are evidence-based ceilings derived from the recorded p95 values: approximately
2× p95 for timings, approximately 1.2× p95 for RSS, and approximately 1.2× the observed Webview
bundle size. VSIX keeps the existing 5 MiB packaging ceiling rather than raising it. The resulting
initial checks are:

| Metric | Initial threshold | Enforcement |
|---|---:|---|
| Extension activation | 25 ms p95 | Matching evidence environment |
| Webview first usable | 1,100 ms p95 | Matching evidence environment |
| Long-session restore | 25 ms p95 | Matching evidence environment |
| Large-workspace search | 500 ms p95 | Matching evidence environment |
| MCP connection/catalog loading | 400 ms p95 | Matching evidence environment |
| Steady-state/peak RSS | 384 MiB p95 | Matching evidence environment |
| Webview bundle | 700,000 B | All CI environments |
| VSIX compressed size | 5 MiB | All CI environments |

Platform-sensitive thresholds are enforced only for the recorded OS, architecture, Node, VS Code,
fixture, and run mode. Other CI platforms still measure and retain the distributions and enforce
deterministic artifact limits; their runtime values are evidence for a future platform-specific
baseline, not grounds for silently weakening the Windows threshold. A failure prints the metric,
observed p95/size, limit, and the exact rerun command. Threshold changes require an independent
same-environment distribution and documented rationale; do not adjust a limit from one noisy sample.

The Extension Host RSS values intentionally include host overhead. Compare them only with the same
VS Code/Node/OS setup and fixture cardinalities. A platform or host-noise difference is identified by
the report environment and raw distribution before classifying a product regression.
