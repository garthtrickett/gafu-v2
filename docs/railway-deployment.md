# Private Railway deployment

This runbook deploys Gafu V2 beside the existing V1 service. Do not replace
`https://gafu-production.up.railway.app/` until the V2 service has passed the
real-data acceptance gate in [`cutover.md`](cutover.md).

## 1. Create the parallel service

In the Railway project that currently hosts V1, create a second service from
`garthtrickett/gafu-v2`. Railway detects the repository's `Dockerfile`; keep the
service at exactly one replica because SQLite permits one authoritative writer.

Attach a persistent volume at `/data`. Configure the deployment health-check
path as `/healthz`, then add these service variables:

```text
GAFU_PUBLIC_DEPLOYMENT=1
GAFU_DATABASE_PATH=/data/gafu-v2.sqlite
GAFU_KAISHI_SEED_PATH=/data/kaishi-1.5k.local.json
GAFU_ACCESS_PASSWORD=<a private password of at least 16 bytes>
GAFU_OPENAI_MODEL=gpt-5.6-luna
OPENAI_API_KEY=<the server-held provider key>
```

Railway supplies `PORT` and `RAILWAY_VOLUME_MOUNT_PATH`; do not override them.
If the image cannot write the root-owned volume, set `RAILWAY_RUN_UID=0` on the
service. Serverless sleep is incompatible with enabled server preparation; never configure multiple replicas
or overlapping deployments against this SQLite volume.

The service deliberately refuses to start if its database or Kaishi path is
outside the attached volume, if the Kaishi manifest is missing, or if the
private password is too short. The OpenAI key is optional at startup, but a
missing key disables real generation until it is entered in the application.

## 2. Build the private cutover database locally

Take the final snapshot from the deployed V1 origin, not a development clone:

```zsh
export GAFU_V1_BEARER_TOKEN
read -rs "GAFU_V1_BEARER_TOKEN?Production V1 bearer token: "
echo

bun run migration:v1:fetch -- \
  --origin https://gafu-production.up.railway.app \
  --output ./v1-production-cutover-snapshot.json

unset GAFU_V1_BEARER_TOKEN
```

Keep the snapshot and all reports outside source control. Dry-run, inspect every
disposition, and apply to a new explicit database. Imported Cards keep the
states the migration assigns — earned progress stays in rotation, and nothing
enters `known` afterwards.

Start Gafu once against that database and the private Kaishi manifest so the
baseline is materialized, stop it, then require both commands to pass:

```bash
bun run backup:inspect -- ./data/gafu-v2-production.sqlite
bun run health -- ./data/gafu-v2-production.sqlite
```

Do not upload a database that was open during copying or that fails either
inspection.

## 3. Seed the stopped volume

The repository's guarded `Railway Production Cutover` workflow automates this
section for the provisioned owner deployment. It first reproduces the accepted
V1 reconciliation, builds and verifies both private files on an ephemeral
runner, and only then changes Railway. Because Railway volume-file access needs
a running deployment, the workflow briefly enables `GAFU_BOOTSTRAP_ONLY=1`.
That mode serves `GET /healthz` but returns `503` for every document and API;
it never opens the database or seed. The workflow uploads exactly two files,
sets bootstrap mode back to `0`, waits for a healthy real deployment, creates a
separate V2 domain, and verifies private login and counts. V1 is read-only
throughout and retains its existing domain.

The workflow requires the `RAILWAY_TOKEN`, `GAFU_V1_BEARER_TOKEN`,
`GAFU_ACCESS_PASSWORD`, and `OPENAI_API_KEY` secrets in the GitHub `production`
environment. Its confirmation text is `STAGE_GAFU_V2_WITH_PRIVATE_DATA`. The V1
token is used only to read a fresh snapshot; private snapshots, reports, the
SQLite database, and the Kaishi manifest remain in the ephemeral runner and are
never uploaded as GitHub artifacts.

Before the first successful V2 start, stop its active deployment or leave the
initial failed deployment stopped. Target the exact Railway project,
environment, service, and volume; do not rely on an unrelated CLI link.

From the V2 checkout, explicitly link and verify the target first:

```bash
railway link \
  --project <gafu-project-id> \
  --environment production \
  --service <v2-service-id>
railway status
```

Stop if `railway status` does not name the Gafu project and V2 service.

Railway's volume-file commands can upload the two private files without putting
them in Git:

```bash
railway volume files --volume <v2-volume-id> upload \
  ./data/gafu-v2-production.sqlite /gafu-v2.sqlite

railway volume files --volume <v2-volume-id> upload \
  ./data/kaishi-1.5k.local.json /kaishi-1.5k.local.json

railway volume files --volume <v2-volume-id> list /
```

List the volume afterward and confirm that both files exist. Do not print or
commit their contents. Start or redeploy the V2 service only after both uploads
finish.

## 4. Verify before routing production traffic

Generate a temporary Railway domain for V2 and verify:

- `/healthz` returns `200` without learner content;
- `/` redirects to `/login` when signed out;
- the configured password creates a secure session;
- Study reports the expected imported and known counts plus the Kaishi baseline;
- Prepare can call the configured provider;
- Watch can load local media and capture a word; and
- a downloaded SQLite backup passes inspection and opens in a restore rehearsal.

Keep V1 unchanged and avoid reviewing in both products during this acceptance
period. Only after the complete owner gate passes should the Railway public
domain be reassigned or a stable custom domain be routed to V2. Retain V1 as a
stopped or maintenance-only rollback service until the rollback window closes.

## Operational rules

- A deploy or restart signs the learner out; it does not erase the volume.
- Changing `GAFU_ACCESS_PASSWORD` invalidates new logins after redeploy; existing
  in-memory sessions disappear with that redeploy.
- Replacing `/data/gafu-v2.sqlite` requires the V2 process to be stopped.
- Download and inspect a backup before every manual database replacement.
- Never place the access password, OpenAI key, snapshot, reports, SQLite file, or
  Kaishi manifest in Git or deployment logs.

## Server preparation of due study material

The app has three **Automatic sentence preparation** modes: `off`, `whileOpen`
(the existing background-tab behavior), and explicitly selected `server`.
An upgrade maps the previous checkbox to `off` or `whileOpen`; it never opts a
learner into server spending. All modes share one durable execution lane. Batch
progress GETs and preparation-status GETs only read SQLite.

For `server`, disable Railway serverless sleeping/scale-to-zero and keep exactly
one replica with the existing exclusive database lock. The app cannot generate
while its server is asleep. Set `GAFU_AUTOMATIC_PREPARATION_DISABLED=1` to stop new
automatic generation and speech dispatches. Already accepted requests can still
finish and incur cost; manual study remains available.

Set a non-secret `GAFU_PROVIDER_CONFIGURATION_ID` and change it whenever changing
provider credentials. Saved provider jobs are bound to the provider, model,
prompt version and this configuration ID. A mismatch requires authenticated
recovery; never copy credentials into SQLite or logs to identify a configuration.
Authentication failures pause the provider lane. Rate limits use Retry-After;
resume does not bypass an unexpired rate-limit delay.

After deployment, verify `/healthz` plus the authenticated
`GET /api/study/preparation-status`. With automatic mode still off/whileOpen,
rehearse the migrated backup on isolated storage using fake providers, then
explicitly select server mode. The worker only prepares admitted Cards due now;
it never consumes the daily new-Card allowance. Admission remains an explicit
Study action. Text becomes ready independently of optional speech.

### Restoring or replacing the volume database

`bun run backup:restore` durably creates
`<databasePath>.preparation-paused` **before** replacing SQLite. Bootstrap-only
startup creates the same marker before an external upload. Keep this file beside
the database; it is intentionally outside the SQLite backup. Do not remove it
as backup clutter. Ordinary restarts without a marker resume identified work.

For raw offline volume replacement, stop the app, acquire its database lock,
create and fsync that marker and its directory **before** copying the database,
then restart. A raw copy without the marker cannot be detected reliably.
Use the authenticated **Reconcile and resume preparation** control after checking
provider configuration and saved requests. Unknown dispatch outcomes stay
blocked; recovery requires an explicit acknowledgement of possible duplicate
cost. A known ID is retrieved before any request can be repurchased. Never
reset the original 15-minute deadline to hide an old accepted job.
