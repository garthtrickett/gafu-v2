# V1 to V2 cutover and rollback

This runbook keeps V1 authoritative until the learner has inspected and accepted
the V2 reconciliation. It never writes to V1. Do not archive V1 or `jp-player`
until every owner gate at the end of this document is recorded.

## Before beginning

1. Update and test both applications, then keep V1 available but do not add new
   reviews after taking the snapshot.
2. Stop Gafu V2 before applying an import or replacing its database.
3. Identify the explicit V2 database path. The default is
   `data/gafu-v2.sqlite`.
4. Ensure there is enough free disk for the current database, the incoming
   database, a temporary copy, and one pre-restore safety copy.
5. In the logged-in V1 browser tab, obtain the current value of the `jwt`
   local-storage item. Treat it as a password and do not put it on a command
   line, in a report, or in source control.

## 1. Capture a credential-free snapshot

From the Gafu V2 repository root, read the bearer token without echoing it or
placing it in shell history:

```bash
read -rsp "V1 bearer token: " GAFU_V1_BEARER_TOKEN
export GAFU_V1_BEARER_TOKEN
bun run migration:v1:fetch -- \
  --origin http://127.0.0.1:3005 \
  --output ./v1-cutover-snapshot.json
unset GAFU_V1_BEARER_TOKEN
```

Use the actual HTTPS V1 origin outside a loopback development installation.
The fetcher performs V1's sync-epoch handshake and writes a new owner-readable
file. It refuses insecure non-loopback HTTP, existing output files, rejected
authentication, credential fields, malformed responses, and oversized input.
The snapshot contains the selected learner's catalogue/progress projection and
preferences, but no bearer token, password, provider key, media, or generated
exercise bodies.

Keep this file private. It contains learning metadata even though it contains
no credential.

## 2. Dry-run and reconcile every row

Dry-run does not create or mutate the destination database:

```bash
bun run migration:v1 -- \
  --source ./v1-cutover-snapshot.json \
  --database ./data/gafu-v2.sqlite \
  --dry-run \
  --report ./v1-cutover-dry-run.json
```

Review the report before apply. Its invariant is:

```text
input = mapped + merged + skipped + quarantined
```

In particular, inspect every `quarantined` reason. Learning-stage V1 Grammar
Cards have no formation in the V1 sync contract, so they remain suspended for
an edit. Malformed vocabulary identity or schedules are not guessed. Known V1
items may become support-ready; no V2 Review Event is fabricated.

If an existing V2 database is present, V2 known/suspended state and native V2
review history win over weaker imported progress. A spelling match alone never
merges vocabulary senses.

## 3. Preserve the current V2 database

If V2 already contains data, download its SQLite backup in the Study screen and
inspect the downloaded file:

```bash
bun run backup:inspect -- ./gafu-v2-before-cutover.sqlite
```

Keep it outside the repository. A valid complete backup reports Study schema 6,
Preparation schema 1, Learning Material schema 1, `integrity: ok`, and
`foreignKeys: ok`.

## 4. Apply exactly once

With the V2 server stopped, choose one permanent operation key and retain it
with the report:

```bash
bun run migration:v1 -- \
  --source ./v1-cutover-snapshot.json \
  --database ./data/gafu-v2.sqlite \
  --apply \
  --import-key v1-owner-cutover-2026-09 \
  --report ./v1-cutover-applied.json
```

Retry the same bytes with the same key after an uncertain terminal failure. An
exact retry returns the stored receipt without another write. The same key with
different bytes is rejected. Apply commits Cards, identity claims, learner
state, approximate V1 schedules, preferences, audit rows, and quarantine rows
in one SQLite transaction.

Start V2 once so all current module schemas are present, stop it again, then run:

```bash
bun run health -- ./data/gafu-v2.sqlite
```

The health output contains schema/integrity status and counts only. A pending,
paused, failed, or uncertain Preparation operation produces `attention` and
should be reconciled before cutover acceptance.

## 5. Parallel acceptance period

For at least one representative multi-day Preparation Plan:

- keep V1 available read-only as the rollback product;
- compare the dry-run and applied count/reason totals;
- inspect every quarantine and repair any suspended imported Grammar Card before
  it enters Study;
- verify representative known, active, staged, and suspended Cards by hand;
- prepare one real Subtitle Set, start its plan, study across multiple local
  days, and confirm episode readiness changes only after actual Study progress;
- watch an episode and capture a missed vocabulary word with the configured
  shortcut; and
- confirm New Cards per Day is shared by manual, plan, capture, and migration
  staging sources.

Do not review independently in both products during this period. V2 has no
dual-write or two-way-sync contract.

## 6. Prove backup replacement before acceptance

Download a fresh V2 backup after the representative journey and inspect it.
With the V2 server stopped, restore it into a clean rehearsal destination:

```bash
bun run backup:inspect -- ./gafu-v2-acceptance.sqlite
bun run backup:restore -- \
  ./gafu-v2-acceptance.sqlite \
  ./data/gafu-v2-restore-rehearsal.sqlite \
  --confirm-replace
bun run health -- ./data/gafu-v2-restore-rehearsal.sqlite
```

Then start V2 against the rehearsal path and verify Card counts, preferences,
Preparation Plans, readiness, subtitle-set metadata, capture evidence, and the
legacy-import audit. Provider credentials are intentionally absent and must be
entered again.

## Rollback

If V2 is not accepted, stop it and return to untouched V1. V1 was never mutated
by this procedure. To replace a bad V2 database with a previously inspected V2
backup:

```bash
bun run backup:restore -- \
  ./gafu-v2-before-cutover.sqlite \
  ./data/gafu-v2.sqlite \
  --confirm-replace
```

Replacement refuses an unconfirmed operation, source/destination alias,
symlink, non-SQLite source, unsupported schema, integrity/foreign-key failure,
or live WAL/SHM sidecar. When the destination exists it first creates an
owner-readable, timestamped `.pre-restore-…sqlite` safety copy and returns its
path in the receipt. Retain that copy until the restored application is
verified.

## Owner release gate

Record the following in an issue or release note. Until all boxes are checked,
the implementation may be complete but replacement is not:

- [ ] A real private V1 snapshot reconciled every row and was applied exactly once.
- [ ] The owner accepted every mapped, merged, skipped, and quarantined result.
- [ ] A real multi-day prepare → study → watch → capture journey passed.
- [ ] A resulting full V2 backup restored and reopened successfully.
- [ ] Rollback to untouched V1 and the pre-restore safety-copy path were understood.
- [ ] The repository licence, private Kaishi installation, sense authority,
      grammar envelope, and paid-provider smoke gates were resolved or explicitly
      accepted as limits.
- [ ] The owner approved V1 maintenance-only status and `jp-player` archival.
