import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDevelopmentLogger } from "../src/log.ts";
import {
  createV1Migration,
  initializeMigrationDestination,
} from "../src/migration/v1-migration.ts";

const argument = (name: string): string | null => {
  const index = Bun.argv.indexOf(name);
  return index < 0 ? null : (Bun.argv[index + 1] ?? null);
};
const source = argument("--source");
const database = argument("--database");
const apply = Bun.argv.includes("--apply");
const dryRun = Bun.argv.includes("--dry-run");
const importKey = argument("--import-key");
const reportPath = argument("--report");
if (
  source === null ||
  database === null ||
  apply === dryRun ||
  (apply && importKey === null)
) {
  console.error(
    "Usage: bun run migration:v1 --source <snapshot.json> --database <gafu.sqlite> (--dry-run | --apply --import-key <key>) [--report <report.json>]",
  );
  process.exit(1);
}

let bytes: Uint8Array;
try {
  bytes = new Uint8Array(readFileSync(resolve(source)));
} catch {
  console.error("V1 snapshot could not be read.");
  process.exit(1);
}
const clock = () => new Date();
const nextId = () => crypto.randomUUID();
const logger = createDevelopmentLogger((level, record) => {
  const fields = record.fields === undefined ? "" : ` ${JSON.stringify(record.fields)}`;
  console.error(`[${level}] ${record.event}${fields}`);
});
const migration = createV1Migration({
  clock,
  nextId,
  initializeDestination: (path) => initializeMigrationDestination(path, clock, nextId),
  logger,
});
const result = apply
  ? migration.apply({
      importKey: importKey ?? "",
      snapshotBytes: bytes,
      destinationPath: resolve(database),
    })
  : migration.inspect(bytes, resolve(database));
if (!result.ok) {
  console.error(`V1 migration failed: ${result.error.kind}`);
  process.exit(1);
}
console.info(
  `${result.value.applied ? "Applied" : "Dry run"}: ${result.value.counts.input} rows; ${result.value.counts.mapped} mapped, ${result.value.counts.merged} merged, ${result.value.counts.skipped} skipped, ${result.value.counts.quarantined} quarantined.`,
);
if (reportPath !== null) {
  try {
    writeFileSync(resolve(reportPath), `${JSON.stringify(result.value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    console.info(`Reconciliation report written: ${resolve(reportPath)}`);
  } catch {
    console.error(
      "The migration succeeded, but the requested report file was not written.",
    );
    process.exit(1);
  }
}
