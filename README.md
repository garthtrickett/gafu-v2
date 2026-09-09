# Gafu V2

Gafu V2 is a fresh implementation of Gafu: an AI-generated Japanese SRS that
prepares a learner for media they want to understand.

This repository now contains the complete Phase 0–6 implementation candidate:
local typed Cards and SRS, validated AI study material, series preparation and
readiness, local Watch/capture, audited V1 migration, and replacement recovery.

- [`V2.md`](V2.md) — product requirements and resolved product decisions;
- [`CONTEXT.md`](CONTEXT.md) — canonical domain language; and
- [`v2-impl.md`](v2-impl.md) — phased implementation plan and exit gates.

The replacement contract is documented in
[`phases/phase-6.md`](phases/phase-6.md). Implementation completion does not
itself complete the private-data cutover; follow
[`docs/cutover.md`](docs/cutover.md).

The current application remains in
[`garthtrickett/gafu`](https://github.com/garthtrickett/gafu) while V2 is built.
V1 code is reference material, not the starting architecture for this repo.

## Development

```bash
bun install
bun run check
bun test
bun run build
bun run test:browser
```

Run the local Gafu server and Vite client with `bun run dev`, then open
`http://127.0.0.1:4173`. Learner data is stored in `data/gafu-v2.sqlite` and can
be backed up from the Study screen. Study links to Prepare and Watch; the Phase
0 diagnostic remains available from the link in the app.

## Private Kaishi baseline

Kaishi deck content is not redistributed by this repository. If you have an
owner-approved compact Kaishi JSON string array, compile it locally into the
gitignored Known Word Bank manifest:

```bash
bun run kaishi:install -- \
  --source ../gafu/src/lib/client/stores/kaishiPool.json
```

The command refuses to overwrite an existing manifest. It uses Gafu's Japanese
analyzer to convert unambiguous single-token entries into the same normalized
lemma, reading, and part-of-speech identities used during preparation. Duplicate,
transparent, and multi-token deck rows are reported rather than guessed. Restart
Gafu after installation; it automatically reads
`data/kaishi-1.5k.local.json`. Set `GAFU_KAISHI_SEED_PATH` to use a different
private manifest, or to an empty value to disable local seed loading.

Build the browser and serve the production-style local app with:

```bash
bun run build
bun run start
```

For the private Railway deployment, use the parallel-service and persistent
volume runbook in [`docs/railway-deployment.md`](docs/railway-deployment.md).
The public server refuses to start without its private-access password and
volume-backed database/Kaishi paths.

## Migration and recovery

The one-way V1 bridge fetches through V1's authenticated API; it does not
require copying JSON through the browser. The bearer token is read from an
environment variable and is never written into the resulting snapshot.

```bash
bun run migration:v1:fetch -- --origin <v1-origin> --output <snapshot.json>
bun run migration:v1 -- --source <snapshot.json> --database <gafu.sqlite> --dry-run
bun run migration:v1 -- --source <snapshot.json> --database <gafu.sqlite> \
  --apply --import-key <permanent-operation-key>
bun run backup:inspect -- <backup.sqlite>
bun run backup:restore -- <backup.sqlite> <gafu.sqlite> --confirm-replace
bun run health -- <gafu.sqlite>
```

Use the exact safety and rollback sequence in the cutover runbook. V1 and
`jp-player` remain unarchived until owner acceptance is recorded.
