# Gafu V2 agent guide

Read `V2.md`, `CONTEXT.md`, and `v2-impl.md` before changing product behavior.
During implementation, follow the active detailed phase document in patch order
and keep each patch independently reviewable.

## Architecture

- Prefer deep modules with narrow, behavior-oriented interfaces.
- Use the local `Result<T, E>` for expected failures and exhaustively handle
  each module-owned error union at its recovery or presentation boundary.
- Create ambient dependencies in the composition root and inject nondeterminism.
- Do not add Effect, a dependency-injection framework, generic repository layer,
  router, or state framework.
- Do not create catch-all `services`, `utils`, `common`, or `managers` folders.
- Treat V1 and `jp-player` code as read-only behavioral evidence until the
  repository license and reuse implications are resolved.

## Required checks

```bash
bun run check
bun test
bun run build
bun run test:browser
```

Never commit credentials, subtitle bodies from copyrighted media, generated
private content, build output, or test reports.
