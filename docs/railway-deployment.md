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
service. Keep serverless sleep optional, but never configure multiple replicas
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
disposition, apply to a new explicit database, and perform any owner-approved
one-off learner-state correction while the database is offline. Start Gafu once
against that database and the private Kaishi manifest so the baseline is
materialized, stop it, then require both commands to pass:

```bash
bun run backup:inspect -- ./data/gafu-v2-production.sqlite
bun run health -- ./data/gafu-v2-production.sqlite
```

Do not upload a database that was open during copying or that fails either
inspection.

## 3. Seed the stopped volume

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
