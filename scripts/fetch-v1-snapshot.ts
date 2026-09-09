import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchV1Snapshot } from "../src/migration/fetch-v1-snapshot.ts";

const argument = (name: string): string | null => {
  const index = Bun.argv.indexOf(name);
  return index < 0 ? null : (Bun.argv[index + 1] ?? null);
};

const origin = argument("--origin");
const output = argument("--output");
if (origin === null || output === null) {
  console.error(
    "Usage: bun run migration:v1:fetch --origin <V1 URL> --output <snapshot.json>",
  );
  process.exit(1);
}

const result = await fetchV1Snapshot(
  origin,
  process.env["GAFU_V1_BEARER_TOKEN"] ?? "",
  { fetch, clock: () => new Date() },
);
if (!result.ok) {
  const detail = "detail" in result.error ? `: ${result.error.detail}` : "";
  console.error(`V1 snapshot failed: ${result.error.kind}${detail}`);
  process.exit(1);
}

const destination = resolve(output);
try {
  writeFileSync(destination, result.value, { flag: "wx", mode: 0o600 });
  console.info(`V1 snapshot written with owner-only permissions: ${destination}`);
} catch {
  console.error(
    "V1 snapshot was not written. Ensure the destination does not exist and is writable.",
  );
  process.exit(1);
}
