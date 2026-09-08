# Phase 0 baselines

These measurements are observations, not budgets. They establish a reference
before the language-analysis and batching experiments add meaningful work.

## Patch 0.1 — executable skeleton

Measured locally on 2026-09-08 with Bun 1.4.2:

| Check | Result | Observed duration or size |
|---|---|---|
| `bun run check` | pass | under 1 second |
| `bun test` | 5 pass, 0 fail | 17 ms reported test time |
| `bun run build` | pass | 253 ms Vite build time |
| `bun run test:browser` | 1 pass, 0 fail | 5.5 seconds |
| production JavaScript | built | 9.11 kB / 4.08 kB gzip |
| production CSS | built | 0.67 kB / 0.39 kB gzip |

The local runner used Bun 1.4.2 because that is the installed runtime. CI also
exercises the locked dependencies with the repository's declared Bun version.
